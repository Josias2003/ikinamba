import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/mailer.js";
import { logger } from "../lib/logger.js";

export type NotificationTemplate =
  | "APPOINTMENT_CONFIRMATION"
  | "APPOINTMENT_REMINDER"
  | "APPOINTMENT_CANCELLED"
  | "CHECKED_IN"
  | "SERVICE_STARTED"
  | "SERVICE_READY"
  | "PAYMENT_RECEIPT"
  | "PAYMENT_REFUND"
  | "JOB_ASSIGNED"
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

/** Notifies a staff member (not a Customer) when assigned to a job -- a parallel path to
 * notifyCustomer since technicians are Users, not Customers, and the NotificationLog's
 * customerId is nullable specifically to support this case. */
export async function notifyTechnician(technicianId: string, queueEntryId: string) {
  const [technician, entry] = await Promise.all([
    prisma.user.findUnique({ where: { id: technicianId } }),
    prisma.queueEntry.findUnique({
      where: { id: queueEntryId },
      include: { vehicle: true, serviceJob: { include: { items: true } } },
    }),
  ]);
  if (!technician || !entry) return;

  const { subject, html } = templates.jobAssigned(
    technician.name ?? technician.email,
    entry.vehicle,
    entry.serviceJob?.items.map((i) => ({ name: i.name, price: i.price })) ?? []
  );

  let status = "SENT";
  let meta: Record<string, unknown> = {};
  try {
    const result = await sendEmail(technician.email, subject, html);
    meta = { previewUrl: result.previewUrl };
  } catch (err) {
    status = "FAILED";
    logger.error({ err }, "Failed to send technician assignment email");
  }

  await prisma.notificationLog.create({
    data: { customerId: null, channel: "EMAIL", template: "JOB_ASSIGNED", subject, body: html, status, meta: JSON.stringify(meta) },
  });
}

interface VehicleDesc { make: string; model: string; plate: string }
interface PricedItem { name: string; price: number }

/** Shared header/footer every template renders through, instead of each one being a
 * standalone one-off paragraph -- gives every email the same business identity and a
 * real footer instead of stopping mid-thought after one sentence. */
function emailLayout(bodyHtml: string): string {
  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e3e8ea;">
  <div style="background:#1ea696; padding:20px 24px;">
    <div style="color:#ffffff; font-size:20px; font-weight:bold;">New Class Car Wash</div>
    <div style="color:#e8fbf8; font-size:12px; margin-top:2px;">Vehicle Service &amp; Car Wash &middot; Gisimenti, Kigali, Rwanda</div>
  </div>
  <div style="padding:24px; color:#161c1f; font-size:14px; line-height:1.65;">
    ${bodyHtml}
  </div>
  <div style="padding:16px 24px; border-top:1px solid #e3e8ea; color:#8a9499; font-size:11px; line-height:1.5;">
    New Class Car Wash &middot; Gisimenti, Kigali, Rwanda<br/>
    This is an automated message from the IKINAMBA system -- please don't reply directly to this email.
  </div>
</div>`.trim();
}

function vehicleLine(v: VehicleDesc) {
  return `${v.make} ${v.model} (plate ${v.plate})`;
}

function serviceListHtml(items: PricedItem[]) {
  if (!items.length) return "";
  const rows = items.map((i) => `<li>${i.name} &mdash; RWF ${i.price.toLocaleString()}</li>`).join("");
  return `<ul style="margin:10px 0; padding-left:20px;">${rows}</ul>`;
}

export const templates = {
  appointmentConfirmation: (name: string, when: string, trackingLink: string, vehicle: VehicleDesc, items: PricedItem[]) => ({
    subject: "Your IKINAMBA appointment is confirmed",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>Your appointment at New Class Car Wash is <strong>confirmed</strong> for <strong>${when}</strong>.</p>
      <p><strong>Vehicle:</strong> ${vehicleLine(vehicle)}</p>
      <p><strong>Services booked:</strong></p>
      ${serviceListHtml(items)}
      <p>Please arrive a few minutes before your slot. Keep this QR code on hand -- show it at check-in, and you can scan or open it anytime to follow your vehicle's progress live: <a href="${trackingLink}">${trackingLink}</a></p>
      <img src="cid:qrcode" width="160" height="160" alt="Tracking QR code" />
      <p>Need to change anything? Contact us or visit us in person -- we're happy to help.</p>
    `),
  }),
  appointmentReminder: (name: string, when: string, vehicle: VehicleDesc) => ({
    subject: "Reminder: your appointment is coming up",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>This is a friendly reminder that your appointment for <strong>${vehicleLine(vehicle)}</strong> is scheduled for <strong>${when}</strong> -- about 24 hours from now.</p>
      <p>If your plans have changed, please let us know so we can free up the slot for another customer. Otherwise, we look forward to seeing you!</p>
    `),
  }),
  checkedIn: (name: string, vehicle: VehicleDesc, trackingLink: string) => ({
    subject: "You're checked in -- track your service live",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>Your vehicle, <strong>${vehicleLine(vehicle)}</strong>, has been checked in and is now in our queue.</p>
      <p>You'll get another email the moment work starts, and again when it's ready for pickup. In the meantime, follow live progress here any time: <a href="${trackingLink}">${trackingLink}</a></p>
      <img src="cid:qrcode" width="160" height="160" alt="Tracking QR code" />
    `),
  }),
  serviceStarted: (name: string, vehicle: VehicleDesc, items: PricedItem[]) => ({
    subject: "Your vehicle service has started",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>We've started work on your vehicle, <strong>${vehicleLine(vehicle)}</strong>.</p>
      <p><strong>In progress:</strong></p>
      ${serviceListHtml(items)}
      <p>You can follow live progress on your tracking page at any time, and we'll notify you again as soon as it's ready.</p>
    `),
  }),
  serviceReady: (name: string, vehicle: VehicleDesc) => ({
    subject: "Your vehicle is ready for pickup",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>Great news -- your vehicle, <strong>${vehicleLine(vehicle)}</strong>, is <strong>ready for pickup</strong>.</p>
      <p>Please visit us at New Class Car Wash, Gisimenti, Kigali, to collect your vehicle. Show your tracking QR code at the front desk if asked.</p>
      <p>Thank you for choosing New Class Car Wash -- we hope to see you again soon!</p>
    `),
  }),
  paymentReceipt: (name: string, total: number, items: PricedItem[]) => ({
    subject: "Payment receipt -- New Class Car Wash",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>We've received your payment in full. Here's your receipt:</p>
      ${serviceListHtml(items)}
      <p><strong>Total paid: RWF ${total.toLocaleString()}</strong></p>
      <p>Loyalty points for this visit have already been credited to your account -- check your balance next time you log in or ask our front desk.</p>
      <p>Thank you for your business!</p>
    `),
  }),
  paymentRefund: (name: string, amount: number, reason: string) => ({
    subject: "Refund recorded -- New Class Car Wash",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>We've recorded a refund of <strong>RWF ${amount.toLocaleString()}</strong> on your invoice.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>If the payment was made through a mobile-money or card provider, the time it takes to appear on your side depends on that provider's processing rules.</p>
    `),
  }),
  maintenanceDue: (name: string, plate: string, dueDate: string) => ({
    subject: "Maintenance reminder -- New Class Car Wash",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>Our records show your vehicle (plate ${plate}) is due for routine maintenance around <strong>${dueDate}</strong>.</p>
      <p>Staying on schedule helps catch small issues before they become expensive ones. You can book a slot online any time, or just walk in.</p>
    `),
  }),
  winBack: (name: string) => ({
    subject: "We miss you at New Class Car Wash!",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>It's been a while since your last visit, and we'd love to see you again. Come back for a wash or full detail and enjoy a small loyalty bonus on your next invoice as a thank-you for returning.</p>
      <p>Book online or just stop by -- we're ready whenever you are.</p>
    `),
  }),
  appointmentCancelled: (name: string, when: string, vehicle: VehicleDesc, reason: string) => ({
    subject: "Your appointment has been cancelled",
    html: emailLayout(`
      <p>Hi ${name},</p>
      <p>Your appointment for <strong>${vehicleLine(vehicle)}</strong> scheduled on <strong>${when}</strong> has been <strong>cancelled</strong>.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>If this was a mistake or you'd like to rebook, you're welcome to book a new slot online any time.</p>
    `),
  }),
  jobAssigned: (technicianName: string, vehicle: VehicleDesc, items: PricedItem[]) => ({
    subject: "You've been assigned a new job",
    html: emailLayout(`
      <p>Hi ${technicianName},</p>
      <p>You've been assigned to work on <strong>${vehicleLine(vehicle)}</strong>.</p>
      <p><strong>Requested services:</strong></p>
      ${serviceListHtml(items)}
      <p>Check the Queue &amp; Bays board for the bay assignment and full details.</p>
    `),
  }),
};
