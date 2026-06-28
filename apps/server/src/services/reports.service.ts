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
    prisma.invoice.findMany({ where: { createdAt: { gte: since, lte: until }, status: { in: ["PAID", "PARTIALLY_PAID"] } } }),
    prisma.queueEntry.findMany({
      where: { checkedInAt: { gte: since, lte: until } },
      include: { serviceJob: { include: { technician: true } } },
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
  });

  let invoicesCreated = 0;
  let totalCollected = 0;
  const byMethod: Record<string, number> = {};
  for (const e of entries) {
    if (e.action === "CREATE") invoicesCreated++;
    if (e.action === "PAYMENT") {
      const meta = JSON.parse(e.metadata || "{}");
      if (meta.success) {
        totalCollected += meta.amount ?? 0;
        byMethod[meta.method] = (byMethod[meta.method] || 0) + (meta.amount ?? 0);
      }
    }
  }
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    invoicesCreated,
    totalCollected,
    paymentsByMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })),
  };
}

/** RECEPTIONIST's own check-in activity -- same reasoning as the cashier report, derived
 * from the audit trail rather than a new "booked by" column on Appointment (most
 * appointments are self-service public bookings with no staff involved at all). */
export async function getReceptionistReport(userId: string, { since, until }: DateRange) {
  const entries = await prisma.auditLog.findMany({
    where: { userId, createdAt: { gte: since, lte: until }, action: { in: ["CHECK_IN", "WALK_IN_CHECK_IN"] } },
  });
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    appointmentCheckIns: entries.filter((e) => e.action === "CHECK_IN").length,
    walkInCheckIns: entries.filter((e) => e.action === "WALK_IN_CHECK_IN").length,
  };
}

/** TECHNICIAN's own performance -- this one IS directly attributable via the schema
 * (ServiceJob.technicianId / qcSignedById), so it's queried relationally rather than via
 * the audit log. Answers "who provided service / how do we manage their performance". */
export async function getTechnicianReport(userId: string, { since, until }: DateRange) {
  const jobs = await prisma.serviceJob.findMany({
    where: { technicianId: userId, queueEntry: { checkedInAt: { gte: since, lte: until } } },
    include: { queueEntry: true },
  });
  const qcSigned = await prisma.serviceJob.count({ where: { qcSignedById: userId, qcSignedAt: { gte: since, lte: until } } });

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
    qcSignOffs: qcSigned,
    revenueGenerated,
  };
}
