import { prisma } from "../lib/prisma.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { emitQueueBoardUpdate, emitTrackingUpdate } from "../lib/socket.js";
import { notifyCustomer, notifyTechnician, templates } from "./notifications.service.js";
import { newTrackingToken, trackingUrl, qrAttachment } from "../lib/tracking.js";

const LOYALTY_PRIORITY: Record<string, number> = { GOLD: 2, SILVER: 1, BRONZE: 0 };

async function fullQueueEntry(id: string) {
  return prisma.queueEntry.findUniqueOrThrow({
    where: { id },
    include: { customer: true, vehicle: true, bay: true, serviceJob: { include: { items: true, technician: true } } },
  });
}

/** Adds a vehicle to the live queue -- either from a checked-in appointment or directly as a walk-in.
 * Both paths converge here, which is what resolves the appointment-vs-walk-in capacity conflict:
 * once a vehicle is physically present, it's just a QueueEntry ordered by check-in time + priority. */
export async function checkIn(opts: { customerId: string; vehicleId: string; appointmentId?: string }) {
  const customer = await prisma.customer.findUnique({ where: { id: opts.customerId } });
  if (!customer) throw notFound("Customer not found");

  // An online booking already carries a trackingToken from confirmation time -- reuse it so the
  // QR the customer received at booking keeps working after they arrive, instead of going stale.
  let trackingToken = newTrackingToken();
  if (opts.appointmentId) {
    const appt = await prisma.appointment.findUnique({ where: { id: opts.appointmentId } });
    if (!appt) throw notFound("Appointment not found");
    if (appt.status !== "CONFIRMED") throw conflict("Appointment is not in a check-in-able state");
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: "COMPLETED" } });
    trackingToken = appt.trackingToken ?? trackingToken;
  }

  const entry = await prisma.queueEntry.create({
    data: {
      customerId: opts.customerId,
      vehicleId: opts.vehicleId,
      appointmentId: opts.appointmentId,
      createdVia: opts.appointmentId ? "APPOINTMENT" : "WALK_IN",
      priority: (LOYALTY_PRIORITY[customer.loyaltyTier] ?? 0) + (opts.appointmentId ? 1 : 0),
      trackingToken,
    },
  });

  const full = await fullQueueEntry(entry.id);
  const { subject, html } = templates.checkedIn(full.customer.name, full.vehicle, trackingUrl(trackingToken));
  await notifyCustomer({
    customerId: full.customerId,
    template: "CHECKED_IN",
    subject,
    html,
    attachments: [await qrAttachment(trackingToken)],
  });

  emitQueueBoardUpdate();
  return full;
}

/** Assigns the next-priority waiting entry to a free bay. Ordering: priority desc, then checkedInAt asc (FIFO within the same priority tier). */
export async function assignNextToBay(bayId: string) {
  const bay = await prisma.bay.findUnique({ where: { id: bayId } });
  if (!bay) throw notFound("Bay not found");
  if (bay.status !== "IDLE") throw conflict("Bay is not idle");

  const next = await prisma.queueEntry.findFirst({
    where: { status: "WAITING" },
    orderBy: [{ priority: "desc" }, { checkedInAt: "asc" }],
  });
  if (!next) throw conflict("No vehicles waiting");

  // Carry over whatever the customer requested at booking time, so staff aren't left guessing
  // what to add once the vehicle reaches a bay -- this was previously dropped on the floor.
  const requestedItems = next.appointmentId
    ? await prisma.appointmentServiceItem.findMany({
        where: { appointmentId: next.appointmentId },
        include: { catalogItem: true },
      })
    : [];

  await prisma.$transaction([
    prisma.queueEntry.update({
      where: { id: next.id },
      data: { status: "IN_SERVICE", bayId, startedAt: new Date() },
    }),
    prisma.bay.update({ where: { id: bayId }, data: { status: "OCCUPIED" } }),
    prisma.serviceJob.create({
      data: {
        queueEntryId: next.id,
        items: {
          create: requestedItems.map((ri) => ({
            catalogItemId: ri.catalogItemId,
            name: ri.catalogItem.name,
            price: ri.catalogItem.basePrice,
          })),
        },
      },
    }),
  ]);

  const entry = await fullQueueEntry(next.id);
  const { subject, html } = templates.serviceStarted(entry.customer.name, entry.vehicle, entry.serviceJob?.items ?? []);
  await notifyCustomer({ customerId: entry.customerId, template: "SERVICE_STARTED", subject, html });

  emitQueueBoardUpdate();
  emitTrackingUpdate(entry.trackingToken, { status: entry.status });
  return entry;
}

export async function setTechnician(queueEntryId: string, technicianId: string) {
  const entry = await prisma.queueEntry.findUnique({ where: { id: queueEntryId }, include: { serviceJob: true } });
  if (!entry?.serviceJob) throw notFound("Service job not found for this queue entry");
  await prisma.serviceJob.update({ where: { id: entry.serviceJob.id }, data: { technicianId } });
  emitQueueBoardUpdate();
  await notifyTechnician(technicianId, queueEntryId);
}

export async function addServiceItems(queueEntryId: string, catalogItemIds: string[]) {
  const entry = await prisma.queueEntry.findUnique({ where: { id: queueEntryId }, include: { serviceJob: true } });
  if (!entry?.serviceJob) throw notFound("Service job not found for this queue entry");

  const catalogItems = await prisma.serviceCatalogItem.findMany({ where: { id: { in: catalogItemIds } } });
  await prisma.serviceJobItem.createMany({
    data: catalogItems.map((c) => ({
      serviceJobId: entry.serviceJob!.id,
      catalogItemId: c.id,
      name: c.name,
      price: c.basePrice,
    })),
  });
  emitQueueBoardUpdate();
  return fullQueueEntry(queueEntryId);
}

export async function moveToQualityCheck(queueEntryId: string) {
  const entry = await prisma.queueEntry.update({
    where: { id: queueEntryId },
    data: { status: "QUALITY_CHECK", qcAt: new Date() },
    include: { customer: true, vehicle: true },
  });
  emitQueueBoardUpdate();
  emitTrackingUpdate(entry.trackingToken, { status: entry.status });
  return entry;
}

/** Mandatory QC sign-off: a technician/manager must sign before the job can be marked READY,
 * directly addressing the AS-IS finding that quality checks were "skipped when business is busy." */
export async function signQualityCheck(queueEntryId: string, signedById: string) {
  const entry = await prisma.queueEntry.findUnique({ where: { id: queueEntryId }, include: { serviceJob: true, bay: true } });
  if (!entry?.serviceJob) throw notFound("Service job not found");
  if (entry.status !== "QUALITY_CHECK") throw badRequest("Entry is not awaiting quality check");

  await prisma.$transaction([
    prisma.serviceJob.update({
      where: { id: entry.serviceJob.id },
      data: { qcSignedById: signedById, qcSignedAt: new Date() },
    }),
    prisma.queueEntry.update({ where: { id: queueEntryId }, data: { status: "READY" } }),
    ...(entry.bayId ? [prisma.bay.update({ where: { id: entry.bayId }, data: { status: "IDLE" } })] : []),
  ]);

  const full = await fullQueueEntry(queueEntryId);
  const { subject, html } = templates.serviceReady(full.customer.name, full.vehicle);
  await notifyCustomer({ customerId: full.customerId, template: "SERVICE_READY", subject, html });

  emitQueueBoardUpdate();
  emitTrackingUpdate(full.trackingToken, { status: full.status });
  return full;
}

/** Vehicle pickup/release is a finance checkpoint, not just a quality one -- a vehicle
 * already cleared QC can still be sitting on an unpaid or partially-paid invoice, and
 * releasing it then means New Class Car Wash has no further leverage to collect. Blocks
 * release until billing is settled, regardless of whether the release is triggered by the
 * QR scan-to-pickup flow or the plain Complete button -- both call this same function. */
export async function completeAndReleaseBay(queueEntryId: string) {
  const existing = await prisma.queueEntry.findUnique({ where: { id: queueEntryId }, include: { invoice: true } });
  if (!existing) throw notFound("Queue entry not found");
  if (!existing.invoice) {
    throw conflict("This vehicle has no invoice yet -- generate and pay the invoice in Billing before releasing it.");
  }
  if (existing.invoice.status !== "PAID") {
    throw conflict(
      `This vehicle's invoice is not fully paid (status: ${existing.invoice.status}) -- settle payment in Billing before releasing it.`
    );
  }

  const entry = await prisma.queueEntry.update({
    where: { id: queueEntryId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  emitQueueBoardUpdate();
  emitTrackingUpdate(entry.trackingToken, { status: entry.status });
  return entry;
}

/** Resolves a scanned tracking QR back to its queue entry for staff actions (e.g. scan-to-pickup) --
 * the public /track/:token endpoint deliberately omits the internal id, so staff need this instead. */
export async function findByTrackingToken(token: string) {
  const entry = await prisma.queueEntry.findUnique({ where: { trackingToken: token } });
  if (!entry) throw notFound("Tracking link not found");
  return fullQueueEntry(entry.id);
}

export async function getBoard() {
  const [bays, waiting] = await Promise.all([
    prisma.bay.findMany({
      include: {
        queueEntries: {
          where: { status: { in: ["IN_SERVICE", "QUALITY_CHECK"] } },
          include: { customer: true, vehicle: true, serviceJob: { include: { items: true, technician: true } } },
        },
      },
    }),
    prisma.queueEntry.findMany({
      where: { status: "WAITING" },
      orderBy: [{ priority: "desc" }, { checkedInAt: "asc" }],
      include: { customer: true, vehicle: true },
    }),
  ]);
  return { bays, waiting };
}
