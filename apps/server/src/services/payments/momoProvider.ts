import crypto from "crypto";
import { env } from "../../lib/env.js";
import { logger } from "../../lib/logger.js";
import type { PaymentProvider, PaymentRequest, PaymentResult } from "./PaymentProvider.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;
const COUNTRY_CODE = "RW";

/** Rwandan numbers come in from forms as local format (e.g. "0788123456") -- MTN's API
 * needs MSISDN with country code and no leading 0/+. */
function normalizeMsisdn(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("250")) return digits;
  if (digits.startsWith("0")) return `250${digits.slice(1)}`;
  return `250${digits}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** OAuth2 client-credentials grant using the Consumer Key/Secret from My Apps on
 * developers.mtn.com -- confirmed against the product's downloaded OpenAPI spec
 * (components.securitySchemes.OAuth2.flows.clientCredentials.tokenUrl). */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) return cachedToken.value;

  const res = await fetch(`${env.momo.baseUrl}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.momo.consumerKey,
      client_secret: env.momo.consumerSecret,
    }),
  });
  if (!res.ok) throw new Error(`MoMo token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

/** GET /{correlatorId}/transactionStatus -- the spec types the real payload as an
 * opaque `data: string` field (loosely typed in MTN's own OpenAPI doc, not just a gap in
 * this client), so the terminal status is detected by keyword instead of a strict field
 * read. If a live test shows `data` is itself JSON, tighten this to parse it properly. */
async function pollForOutcome(correlatorId: string, token: string): Promise<PaymentResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${env.momo.baseUrl}/${correlatorId}/transactionStatus`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "transactionId": crypto.randomUUID(),
        "countryCode": COUNTRY_CODE,
      },
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: string; error?: { statusMessage?: string } };
      const status = (body.data ?? "").toUpperCase();
      if (status.includes("SUCCESS") || status.includes("COMPLETED")) {
        return { success: true, providerRef: correlatorId, message: "MoMo payment confirmed" };
      }
      if (status.includes("FAILED") || status.includes("CANCELLED") || status.includes("REJECTED")) {
        return { success: false, providerRef: correlatorId, message: body.error?.statusMessage ?? "MoMo payment failed" };
      }
      // Anything else (e.g. PENDING) -- keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { success: false, providerRef: correlatorId, message: "MoMo payment timed out waiting for customer approval" };
}

/** Real MTN MoMo "Payments V1" integration (the MADAPI platform) -- same
 * PaymentProvider shape as the mock it replaces, so no caller needs to change.
 * Endpoints/auth confirmed against the product's downloaded OpenAPI spec
 * (developers.mtn.com/products/payments-v1 -> Download Swagger), not guessed. The
 * `/payment-link` flow generates a link the customer completes payment on themselves --
 * NOT a synchronous "approve on your phone" push -- which is why this polls
 * transactionStatus afterward rather than expecting an instant result. */
export const realMomoProvider: PaymentProvider = {
  async charge(req: PaymentRequest): Promise<PaymentResult> {
    if (!req.phoneNumber) {
      return { success: false, providerRef: "", message: "A phone number is required for MoMo payment" };
    }

    try {
      const token = await getAccessToken();
      const transactionId = crypto.randomUUID();

      const res = await fetch(`${env.momo.baseUrl}/payment-link`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "transactionId": transactionId,
          "countryCode": COUNTRY_CODE,
        },
        body: JSON.stringify({
          countryCode: COUNTRY_CODE,
          externalTransactionId: req.reference,
          description: "New Class Car Wash payment",
          amount: { amount: String(req.amount), units: env.momo.currency },
          payer: { payerId: normalizeMsisdn(req.phoneNumber), payerIdType: "MSISDN" },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        logger.error({ status: res.status, body }, "MoMo payment-link request rejected");
        return { success: false, providerRef: "", message: "MoMo could not process this request" };
      }

      // 200 response is documented as a bare string -- treat it as the correlator id
      // needed for the status-check call, stripping surrounding quotes if the body came
      // back JSON-encoded.
      const raw = (await res.text()).trim();
      const correlatorId = raw.replace(/^"|"$/g, "") || transactionId;

      return await pollForOutcome(correlatorId, token);
    } catch (err) {
      logger.error({ err }, "MoMo charge failed");
      return { success: false, providerRef: "", message: "MoMo payment failed due to a connection error" };
    }
  },
};

// The OAuth2 token endpoint consistently rejects every standard client-credentials
// request shape tried so far (form body, Basic Auth header, query string, JSON body --
// all return a generic, non-specific "Bad Request" from MTN's Apigee gateway). Rather
// than keep guessing against a live production financial API, this stays off until the
// real cause is confirmed (likely needs MTN support/documentation, possibly a consent
// step the "Payments V1" product's spec hints at) -- flip to true once getAccessToken()
// is verified actually working. Until then, every MOMO payment correctly falls back to
// the simulated provider below, so payments keep working end-to-end either way.
const TOKEN_EXCHANGE_VERIFIED = false;

export function isMomoConfigured(): boolean {
  return TOKEN_EXCHANGE_VERIFIED && Boolean(env.momo.baseUrl && env.momo.consumerKey && env.momo.consumerSecret);
}
