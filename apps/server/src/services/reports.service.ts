import { prisma } from "../lib/prisma.js";

export interface DateRange {
  since: Date;
  until: Date;
}

/** Default to the trailing 30 days when the caller (route) didn't resolve an explicit
 * range from query params -- preserves today's behavior for anyone hitting these
 * endpoints with no range arguments at all. */
export function defaultRange(): DateRange {
  return { since: new Date(Date.now() - 30 * 86_400_000), until: new Date() };
}

export async function getDashboardMetrics({ since, until }: DateRange) {
  const [invoices, queueEntries, jobItems, bays] = await Promise.all([
    prisma.invoice.findMany({
      where: { createdAt: { gte: since, lte: until }, status: { in: ["PAID", "PARTIALLY_PAID"] } },
      include: {
        customer: true,
        items: true,
        payments: true,
        queueEntry: { include: { vehicle: true, serviceJob: { include: { technician: true } } } },
      },
    }),
    prisma.queueEntry.findMany({
      where: { checkedInAt: { gte: since, lte: until } },
      include: { customer: true, vehicle: true, serviceJob: { include: { technician: true, items: true } }, invoice: true },
    }),
    prisma.serviceJobItem.findMany({
      where: { serviceJob: { queueEntry: { checkedInAt: { gte: since, lte: until } } } },
      include: { catalogItem: true },
    }),
    prisma.bay.findMany(),
  ]);

  const revenueByDay: Record<string, number> = {};
  for (const inv of invoices) {
    const day = inv.createdAt.toISOString().slice(0, 10);
    revenueByDay[day] = (revenueByDay[day] || 0) + inv.total;
  }

  const popularityByService: Record<string, number> = {};
  for (const item of jobItems) {
    popularityByService[item.catalogItem.name] = (popularityByService[item.catalogItem.name] || 0) + item.qty;
  }

  const byHour: Record<number, number> = {};
  for (const entry of queueEntries) {
    const hour = entry.checkedInAt.getHours();
    byHour[hour] = (byHour[hour] || 0) + 1;
  }

  const staffCounts: Record<string, number> = {};
  for (const entry of queueEntries) {
    const tech = entry.serviceJob?.technician?.email;
    if (tech) staffCounts[tech] = (staffCounts[tech] || 0) + 1;
  }

  const completed = queueEntries.filter((e) => e.completedAt && e.startedAt);
  const avgServiceMinutes = completed.length
    ? completed.reduce((sum, e) => sum + (e.completedAt!.getTime() - e.startedAt!.getTime()) / 60_000, 0) / completed.length
    : 0;

  return {
    revenueByDay: Object.entries(revenueByDay).map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date)),
    servicePopularity: Object.entries(popularityByService).map(([name, count]) => ({ name, count })),
    peakHours: Object.entries(byHour).map(([hour, count]) => ({ hour: Number(hour), count })).sort((a, b) => a.hour - b.hour),
    staffProductivity: Object.entries(staffCounts).map(([email, count]) => ({ email, count })),
    bayCount: bays.length,
    vehiclesServiced: queueEntries.length,
    totalRevenue: invoices.reduce((s, i) => s + i.total, 0),
    avgServiceMinutes: Math.round(avgServiceMinutes),
    revenueDetails: invoices.map((invoice) => ({
      id: invoice.id,
      date: invoice.createdAt,
      customer: invoice.customer.name,
      vehicle: invoice.queueEntry?.vehicle
        ? `${invoice.queueEntry.vehicle.make} ${invoice.queueEntry.vehicle.model} (${invoice.queueEntry.vehicle.plate})`
        : "Booking payment",
      total: invoice.total,
      status: invoice.status,
      services: invoice.items.map((item) => item.description),
      payments: invoice.payments.map((payment) => ({ method: payment.method, amount: payment.amount, status: payment.status })),
    })),
    vehicleDetails: queueEntries.map((entry) => ({
      id: entry.id,
      checkedInAt: entry.checkedInAt,
      completedAt: entry.completedAt,
      customer: entry.customer.name,
      vehicle: `${entry.vehicle.make} ${entry.vehicle.model}`,
      plate: entry.vehicle.plate,
      status: entry.status,
      technician: entry.serviceJob?.technician?.email ?? null,
      services: entry.serviceJob?.items.map((item) => item.name) ?? [],
      invoiceStatus: entry.invoice?.status ?? null,
    })),
  };
}

export async function getCustomerRetention() {
  const customers = await prisma.customer.findMany({ include: { queueEntries: { select: { checkedInAt: true } } } });
  const returning = customers.filter((c) => c.queueEntries.length > 1).length;
  const oneTime = customers.filter((c) => c.queueEntries.length === 1).length;
  return { returning, oneTime, total: customers.length };
}

/** CASHIER's own financial activity. Invoice/Payment rows don't carry a "who processed
 * this" column, so this is derived from the audit trail (CREATE+Invoice, PAYMENT actions
 * already record userId + the payment amount/method in metadata) rather than needing a
 * new schema field -- the audit log already is the record of who did what. */
export async function getCashierReport(userId: string, { since, until }: DateRange) {
  const entries = await prisma.auditLog.findMany({
    where: { userId, createdAt: { gte: since, lte: until }, action: { in: ["CREATE", "PAYMENT"] }, entity: "Invoice" },
    orderBy: { createdAt: "desc" },
  });
  const invoiceIds = [...new Set(entries.map((e) => e.entityId).filter((id): id is string => Boolean(id)))];
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        include: { customer: true, payments: true, items: true, queueEntry: { include: { vehicle: true } } },
      })
    : [];
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

  let invoicesCreated = 0;
  let totalCollected = 0;
  const byMethod: Record<string, number> = {};
  const invoiceRows = [];
  const paymentRows = [];
  for (const e of entries) {
    const invoice = e.entityId ? invoicesById.get(e.entityId) : null;
    if (e.action === "CREATE") {
      invoicesCreated++;
      if (invoice) {
        invoiceRows.push({
          id: invoice.id,
          createdAt: invoice.createdAt,
          customer: invoice.customer.name,
          vehicle: invoice.queueEntry?.vehicle
            ? `${invoice.queueEntry.vehicle.make} ${invoice.queueEntry.vehicle.model} (${invoice.queueEntry.vehicle.plate})`
            : "Booking payment",
          total: invoice.total,
          status: invoice.status,
          services: invoice.items.map((item) => item.description),
        });
      }
    }
    if (e.action === "PAYMENT") {
      const meta = JSON.parse(e.metadata || "{}");
      if (meta.success) {
        totalCollected += meta.amount ?? 0;
        byMethod[meta.method] = (byMethod[meta.method] || 0) + (meta.amount ?? 0);
        paymentRows.push({
          invoiceId: e.entityId,
          paidAt: e.createdAt,
          customer: invoice?.customer.name ?? "Unknown",
          method: meta.method ?? "UNKNOWN",
          amount: meta.amount ?? 0,
          status: "SUCCESS",
        });
      }
    }
  }
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    invoicesCreated,
    totalCollected,
    paymentsByMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })),
    invoices: invoiceRows,
    payments: paymentRows,
  };
}

/** RECEPTIONIST's own check-in activity -- same reasoning as the cashier report, derived
 * from the audit trail rather than a new "booked by" column on Appointment (most
 * appointments are self-service public bookings with no staff involved at all). */
export async function getReceptionistReport(userId: string, { since, until }: DateRange) {
  const entries = await prisma.auditLog.findMany({
    where: { userId, createdAt: { gte: since, lte: until }, action: { in: ["CHECK_IN", "WALK_IN_CHECK_IN"] } },
    orderBy: { createdAt: "desc" },
  });
  const queueEntryIds = [...new Set(entries.map((e) => e.entityId).filter((id): id is string => Boolean(id)))];
  const queueEntries = queueEntryIds.length
    ? await prisma.queueEntry.findMany({
        where: { id: { in: queueEntryIds } },
        include: { customer: true, vehicle: true, appointment: true },
      })
    : [];
  const queueEntriesById = new Map(queueEntries.map((entry) => [entry.id, entry]));

  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    appointmentCheckIns: entries.filter((e) => e.action === "CHECK_IN").length,
    walkInCheckIns: entries.filter((e) => e.action === "WALK_IN_CHECK_IN").length,
    checkIns: entries.map((entry) => {
      const queueEntry = entry.entityId ? queueEntriesById.get(entry.entityId) : null;
      return {
        id: entry.entityId,
        checkedInAt: entry.createdAt,
        source: entry.action === "CHECK_IN" ? "APPOINTMENT" : "WALK_IN",
        customer: queueEntry?.customer.name ?? "Unknown",
        vehicle: queueEntry?.vehicle ? `${queueEntry.vehicle.make} ${queueEntry.vehicle.model}` : "Unknown",
        plate: queueEntry?.vehicle.plate ?? "",
        status: queueEntry?.status ?? "UNKNOWN",
        appointmentTime: queueEntry?.appointment?.scheduledAt ?? null,
      };
    }),
  };
}

/** TECHNICIAN's own performance -- this one IS directly attributable via the schema
 * (ServiceJob.technicianId / qcSignedById), so it's queried relationally rather than via
 * the audit log. Answers "who provided service / how do we manage their performance". */
export async function getTechnicianReport(userId: string, { since, until }: DateRange) {
  const jobs = await prisma.serviceJob.findMany({
    where: { technicianId: userId, queueEntry: { checkedInAt: { gte: since, lte: until } } },
    include: {
      items: true,
      queueEntry: { include: { customer: true, vehicle: true, invoice: true } },
    },
  });
  const qcJobs = await prisma.serviceJob.findMany({
    where: { qcSignedById: userId, qcSignedAt: { gte: since, lte: until } },
    include: { queueEntry: { include: { customer: true, vehicle: true } } },
    orderBy: { qcSignedAt: "desc" },
  });

  const completed = jobs.filter((j) => j.queueEntry.completedAt && j.queueEntry.startedAt);
  const avgServiceMinutes = completed.length
    ? completed.reduce((sum, j) => sum + (j.queueEntry.completedAt!.getTime() - j.queueEntry.startedAt!.getTime()) / 60_000, 0) / completed.length
    : 0;

  // "How much did this technician bring in" -- the revenue tied to the invoices generated
  // from jobs they worked on, same attribution chain (ServiceJob -> QueueEntry -> Invoice)
  // used for jobsCompleted above, just one hop further.
  const queueEntryIds = jobs.map((j) => j.queueEntryId);
  const invoices = queueEntryIds.length
    ? await prisma.invoice.findMany({
        where: { queueEntryId: { in: queueEntryIds }, status: { in: ["PAID", "PARTIALLY_PAID"] } },
        select: { total: true },
      })
    : [];
  const revenueGenerated = invoices.reduce((sum, inv) => sum + inv.total, 0);

  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    jobsAssigned: jobs.length,
    jobsCompleted: completed.length,
    avgServiceMinutes: Math.round(avgServiceMinutes),
    qcSignOffs: qcJobs.length,
    revenueGenerated,
    jobs: jobs.map((job) => ({
      id: job.id,
      queueEntryId: job.queueEntryId,
      customer: job.queueEntry.customer.name,
      vehicle: `${job.queueEntry.vehicle.make} ${job.queueEntry.vehicle.model}`,
      plate: job.queueEntry.vehicle.plate,
      status: job.queueEntry.status,
      checkedInAt: job.queueEntry.checkedInAt,
      startedAt: job.queueEntry.startedAt,
      completedAt: job.queueEntry.completedAt,
      durationMinutes:
        job.queueEntry.startedAt && job.queueEntry.completedAt
          ? Math.round((job.queueEntry.completedAt.getTime() - job.queueEntry.startedAt.getTime()) / 60_000)
          : null,
      services: job.items.map((item) => item.name),
      invoiceTotal: job.queueEntry.invoice?.total ?? null,
      invoiceStatus: job.queueEntry.invoice?.status ?? null,
    })),
    qcSignOffDetails: qcJobs.map((job) => ({
      id: job.id,
      signedAt: job.qcSignedAt,
      customer: job.queueEntry.customer.name,
      vehicle: `${job.queueEntry.vehicle.make} ${job.queueEntry.vehicle.model}`,
      plate: job.queueEntry.vehicle.plate,
      status: job.queueEntry.status,
    })),
  };
}
