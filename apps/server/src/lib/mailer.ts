import { env } from "./env.js";
import { logger } from "./logger.js";

const BREVO_API = "https://api.brevo.com/v3/smtp/email";

/** Send a transactional email via the Brevo API.
 * Attachments with a `cid` become inline images (referenced as cid:X in the HTML).
 * If BREVO_API_KEY is not set, the email is skipped with a warning -- email is
 * non-blocking so a missing key should never crash a booking or payment flow. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; content: Buffer; cid?: string }[]
): Promise<{ messageId: string | null; previewUrl: null }> {
  if (!env.brevo.apiKey || !env.brevo.from) {
    logger.warn({ to, subject }, "Brevo not configured (BREVO_API_KEY / BREVO_FROM missing) -- email skipped");
    return { messageId: null, previewUrl: null };
  }

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

  const res = await fetch(BREVO_API, {
    method: "POST",
    headers: { "api-key": env.brevo.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo API ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { messageId?: string };
  logger.info({ to, subject, messageId: data.messageId }, "Email sent via Brevo");
  return { messageId: data.messageId ?? null, previewUrl: null };
}
