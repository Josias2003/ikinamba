import { prisma } from "../lib/prisma.js";
import { notifyCustomer, templates } from "../services/notifications.service.js";
import { logger } from "../lib/logger.js";

/** Reminds customers whose appointment starts in 24-25 hours (run every 15 min so each appointment is caught once). */
export async function sendAppointmentReminders() {
  const windowStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const windowEnd = new Date(Date.now() + 25 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: { status: "CONFIRMED", scheduledAt: { gte: windowStart, lte: windowEnd } },
    include: { customer: true, vehicle: true },
  });

  for (const appt of appointments) {
    const { subject, html } = templates.appointmentReminder(appt.customer.name, appt.scheduledAt.toLocaleString(), appt.vehicle);
    await notifyCustomer({ customerId: appt.customerId, template: "APPOINTMENT_REMINDER", subject, html });
  }

  if (appointments.length) logger.info(`Sent ${appointments.length} appointment reminder(s)`);
}
