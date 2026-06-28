import { prisma } from "../lib/prisma.js";
import { conflict, badRequest } from "../lib/errors.js";
import { notifyCustomer, templates } from "./notifications.service.js";
import { newTrackingToken, trackingUrl, qrAttachment } from "../lib/tracking.js";

const SLOT_MINUTES = 30;

export interface PublicBookingInput {
  customerId?: string;
  customer?: { name: string; phone: string; email?: string };
  vehicleId?: string;
  vehicle?: { make: string; model: string; year: number; plate: string; color?: string };
  scheduledAt: Date;
  serviceItemIds: string[];
  notes?: string;
  source: "ONLINE" | "PHONE" | "WALK_IN";
}

/** Creates a customer (if new), vehicle (if new), and appointment, then sends the
 * confirmation email with tracking QR -- shared by the public booking form
 * (POST /appointments) and the chatbot's book_appointment tool, so both paths create a
 * booking the exact same way instead of duplicating this logic. Caller must have already
 * checked assertSlotAvailable(). */
export async function createPublicBooking(input: PublicBookingInput) {
  let customerId = input.customerId;
  if (!customerId && input.customer) {
    const customer = await prisma.customer.create({ data: input.customer });
    customerId = customer.id;
  }
  if (!customerId) throw badRequest("customerId or customer is required");

  let vehicleId = input.vehicleId;
  if (!vehicleId && input.vehicle) {
    const vehicle = await prisma.vehicle.create({ data: { ...input.vehicle, customerId } });
    vehicleId = vehicle.id;
  }
  if (!vehicleId) throw badRequest("vehicleId or vehicle is required");

  const appointment = await prisma.appointment.create({
    data: {
      customerId,
      vehicleId,
      scheduledAt: input.scheduledAt,
      notes: input.notes,
      source: input.source,
      trackingToken: newTrackingToken(),
      serviceItems: { create: input.serviceItemIds.map((id) => ({ catalogItemId: id })) },
    },
    include: { customer: true, vehicle: true, serviceItems: { include: { catalogItem: true } } },
  });

  const { subject, html } = templates.appointmentConfirmation(
    appointment.customer.name,
    input.scheduledAt.toLocaleString(),
    trackingUrl(appointment.trackingToken!)
  );
  await notifyCustomer({
    customerId,
    template: "APPOINTMENT_CONFIRMATION",
    subject,
    html,
    attachments: [await qrAttachment(appointment.trackingToken!)],
  });

  return appointment;
}

/** Checks how many bays are already committed (via CONFIRMED appointments) for the slot
 * containing `scheduledAt`, preventing overbooking beyond physical bay capacity. */
export async function checkSlotCapacity(scheduledAt: Date, excludeAppointmentId?: string) {
  const bayCount = await prisma.bay.count();
  const slotStart = new Date(scheduledAt);
  slotStart.setMinutes(Math.floor(slotStart.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES, 0, 0);
  const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60_000);

  const existing = await prisma.appointment.count({
    where: {
      status: "CONFIRMED",
      scheduledAt: { gte: slotStart, lt: slotEnd },
      id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
    },
  });

  return { bayCount, booked: existing, available: existing < bayCount, slotStart, slotEnd };
}

export async function getAvailability(date: Date) {
  const bayCount = await prisma.bay.count();
  const dayStart = new Date(date);
  dayStart.setHours(8, 0, 0, 0); // business hours 08:00-18:00
  const dayEnd = new Date(date);
  dayEnd.setHours(18, 0, 0, 0);

  const slots: { start: string; bookedCount: number; available: boolean }[] = [];
  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += SLOT_MINUTES * 60_000) {
    const slotStart = new Date(t);
    const slotEnd = new Date(t + SLOT_MINUTES * 60_000);
    const bookedCount = await prisma.appointment.count({
      where: { status: "CONFIRMED", scheduledAt: { gte: slotStart, lt: slotEnd } },
    });
    slots.push({ start: slotStart.toISOString(), bookedCount, available: bookedCount < bayCount });
  }
  return slots;
}

export async function assertSlotAvailable(scheduledAt: Date, excludeAppointmentId?: string) {
  const capacity = await checkSlotCapacity(scheduledAt, excludeAppointmentId);
  if (!capacity.available) {
    throw conflict("That time slot is fully booked. Please choose another time or join the waitlist.");
  }
}
