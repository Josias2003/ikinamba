import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";
import { logger } from "./logger.js";

let transporterPromise: Promise<Transporter> | undefined;

async function buildTransporter(): Promise<Transporter> {
  if (env.smtp.host) {
    return nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  // No SMTP configured -- spin up a disposable Ethereal test inbox so the
  // notification flow is fully demoable with zero setup.
  const testAccount = await nodemailer.createTestAccount();
  logger.warn(
    `No SMTP_HOST configured -- using Ethereal test inbox. Login: ${testAccount.user} / ${testAccount.pass}`
  );
  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
}

export function getTransporter() {
  if (!transporterPromise) transporterPromise = buildTransporter();
  return transporterPromise;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; content: Buffer; cid?: string }[]
) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({ from: env.smtp.from, to, subject, html, attachments });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) logger.info(`Email preview (Ethereal): ${previewUrl}`);
  return { messageId: info.messageId, previewUrl: previewUrl || null };
}
