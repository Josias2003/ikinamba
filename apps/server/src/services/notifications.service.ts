import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/mailer.js";
import { logger } from "../lib/logger.js";

export type NotificationTemplate =
  | "APPOINTMENT_CONFIRMATION"
  | "APPOINTMENT_REMINDER"
  | "CHECKED_IN"
  | "SERVICE_STARTED"
  | "SERVICE_READY"
  | "PAYMENT_RECEIPT"
  | "MAINTENANCE_DUE"
  | "WIN_BACK"
  | "PROMOTIONAL"
  | "FEEDBACK_REQUEST";

interface NotifyOptions {
  customerId: string;
  template: NotificationTemplate;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer; cid?: string }[];
}

/** Sends an email (or simulates it) and always writes a NotificationLog row, win-back/feedback/reminder flows all funnel through here so delivery is auditable. */
export async function notifyCustomer({ customerId, template, subject, html, attachments }: NotifyOptions) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new Error(`Customer ${customerId} not found`);

  let status = "SENT";
  let meta: Record<string, unknown> = {};

  if (customer.email) {
    try {
      const result = await sendEmail(customer.email, subject, html, attachments);
      meta = { previewUrl: result.previewUrl };
    } catch (err) {
      status = "FAILED";
      logger.error({ err }, "Failed to send notification email");
    }
  } else {
    status = "QUEUED";
    meta = { reason: "No email on file -- logged as in-app notification only" };
  }

  return prisma.notificationLog.create({
    data: {
      customerId,
      channel: "EMAIL",
      template,
      subject,
      body: html,
      status,
      meta: JSON.stringify(meta),
    },
  });
}

export const templates = {
  appointmentConfirmation: (name: string, when: string, trackingLink: string) => ({
    subject: "Your IKINAMBA appointment is confirmed",
    html: `<p>Hi ${name},</p><p>Your appointment at New Class Car Wash is confirmed for <strong>${when}</strong>.</p><p>Keep this QR code -- show it at check-in and use it to follow live progress: <a href="${trackingLink}">${trackingLink}</a></p><img src="cid:qrcode" width="160" height="160" alt="Tracking QR code" />`,
  }),
  appointmentReminder: (name: string, when: string) => ({
    subject: "Reminder: your appointment is coming up",
    html: `<p>Hi ${name},</p><p>Friendly reminder: your appointment is scheduled for <strong>${when}</strong>.</p>`,
  }),
  checkedIn: (name: string, plate: string, trackingLink: string) => ({
    subject: "You're checked in -- track your service live",
    html: `<p>Hi ${name},</p><p>Your vehicle (${plate}) has been checked in. Follow live progress here: <a href="${trackingLink}">${trackingLink}</a></p><img src="cid:qrcode" width="160" height="160" alt="Tracking QR code" />`,
  }),
  serviceStarted: (name: string, plate: string) => ({
    subject: "Your vehicle service has started",
    html: `<p>Hi ${name},</p><p>We've started work on your vehicle (${plate}). You can follow live progress on your tracking page.</p>`,
  }),
  serviceReady: (name: string, plate: string) => ({
    subject: "Your vehicle is ready for pickup",
    html: `<p>Hi ${name},</p><p>Your vehicle (${plate}) is ready for pickup. Thank you for choosing New Class Car Wash!</p>`,
  }),
  paymentReceipt: (name: string, total: number) => ({
    subject: "Payment receipt",
    html: `<p>Hi ${name},</p><p>We've received your payment of <strong>RWF ${total.toLocaleString()}</strong>. Thank you!</p>`,
  }),
  maintenanceDue: (name: string, plate: string, dueDate: string) => ({
    subject: "Maintenance reminder",
    html: `<p>Hi ${name},</p><p>Your vehicle (${plate}) is due for service around <strong>${dueDate}</strong>. Book online anytime.</p>`,
  }),
  winBack: (name: string) => ({
    subject: "We miss you at New Class Car Wash!",
    html: `<p>Hi ${name},</p><p>It's been a while -- come back for a wash and enjoy a loyalty bonus on your next visit.</p>`,
  }),
};
