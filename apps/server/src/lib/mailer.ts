import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// SMTP transport (nodemailer) -- primary when SMTP_HOST is configured.
// ---------------------------------------------------------------------------

let transporterPromise: Promise<Transporter> | undefined;

async function buildTransporter(): Promise<Transporter> {
  if (env.smtp.host) {
    logger.info(`Mailer: using SMTP (${env.smtp.host}:${env.smtp.port})`);
    return nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  // No SMTP and no Brevo -- spin up a disposable Ethereal test inbox.
  const testAccount = await nodemailer.createTestAccount();
  logger.warn("Mailer: no SMTP_HOST set -- using Ethereal test inbox. Preview URLs will appear in logs.");
  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
}

function getTransporter() {
  if (!transporterPromise) transporterPromise = buildTransporter();
  return transporterPromise;
}

// ---------------------------------------------------------------------------
// Brevo HTTP API -- fallback when SMTP_HOST is not set but BREVO_API_KEY is.
// ---------------------------------------------------------------------------

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

async function sendViaBrevo(
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; content: Buffer; cid?: string }[]
): Promise<{ messageId: string | null; previewUrl: null }> {
  const body: Record<string, unknown> = {
    sender: { name: env.brevo.senderName, email: env.brevo.from },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (attachments?.length) {
    body.attachment = attachments.map((a) => ({
      name: a.filename,
      content: a.content.toString("base64"),
      ...(a.cid ? { contentId: a.cid } : {}),
    }));
  }
  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: { "api-key": env.brevo.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brevo API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { messageId?: string };
  logger.info({ to, subject, messageId: data.messageId }, "Email sent via Brevo API");
  return { messageId: data.messageId ?? null, previewUrl: null };
}

// ---------------------------------------------------------------------------
// Public sendEmail -- SMTP first, Brevo API second, Ethereal last.
// ---------------------------------------------------------------------------

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; content: Buffer; cid?: string }[]
): Promise<{ messageId: string | null; previewUrl: string | null }> {
  // Brevo API fallback (no SMTP configured but API key present)
  if (!env.smtp.host && env.brevo.apiKey && env.brevo.from) {
    return sendViaBrevo(to, subject, html, attachments);
  }

  // SMTP via nodemailer (or Ethereal if neither SMTP nor Brevo is set)
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
    attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content, cid: a.cid })),
  });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) logger.info(`Email preview (Ethereal): ${previewUrl}`);
  return { messageId: info.messageId, previewUrl: previewUrl || null };
}
