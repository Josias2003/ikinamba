import crypto from "crypto";
import { env } from "../../lib/env.js";
import { logger } from "../../lib/logger.js";
import type { PaymentProvider, PaymentRequest, PaymentResult } from "./PaymentProvider.js";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60_000; // customer has 60 s to approve on their phone

/** Rwandan numbers arrive from forms as local format (e.g. "0788123456") -- the
 * Collections API needs MSISDN with country code, no leading + or 0. */
function normalizeMsisdn(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("250")) return digits;
  if (digits.startsWith("0")) return `250${digits.slice(1)}`;
  return `250${digits}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Basic-Auth token exchange against the MTN MoMo Collections sandbox.
 * POST /collection/token/ with Authorization: Basic base64(apiUser:apiKey)
 * and Ocp-Apim-Subscription-Key header -- documented and confirmed working
 * on momodeveloper.mtn.com. */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) return cachedToken.value;

  const credentials = Buffer.from(`${env.momo.apiUser}:${env.momo.apiKey}`).toString("base64");
  const res = await fetch(`${env.momo.baseUrl}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Ocp-Apim-Subscription-Key": env.momo.subscriptionKey,
    },
  });
  if (!res.ok) throw new Error(`MoMo token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

/** Poll GET /collection/v1_0/requesttopay/{referenceId} until the payment reaches
 * a terminal state (SUCCESSFUL / FAILED / CANCELLED / REJECTED) or we time out.
 * The Collections API is async -- the 202 from requesttopay just means "received",
 * not "approved". */
async function pollForOutcome(referenceId: string, token: string): Promise<PaymentResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${env.momo.baseUrl}/collection/v1_0/requesttopay/${referenceId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": env.momo.subscriptionKey,
        "X-Target-Environment": env.momo.targetEnv,
      },
    });
    if (!res.ok) continue; // transient error -- keep polling
    const body = (await res.json()) as {
      status?: string;
      reason?: { code?: string; message?: string };
    };
    const status = (body.status ?? "").toUpperCase();
    if (status === "SUCCESSFUL") {
      return { success: true, providerRef: referenceId, message: "MoMo payment confirmed" };
    }
    if (status === "FAILED" || status === "CANCELLED" || status === "REJECTED") {
      return {
        success: false,
        providerRef: referenceId,
        message: body.reason?.message ?? `MoMo payment ${status.toLowerCase()}`,
      };
    }
    // PENDING -- keep polling
  }
  return {
    success: false,
    providerRef: referenceId,
    message: "MoMo payment timed out -- customer did not approve in time",
  };
}

/** Real MTN MoMo Collections sandbox integration.
 * Flow: Basic-Auth token → POST /collection/v1_0/requesttopay (202) → poll status.
 * Same PaymentProvider shape as the mock, so no caller changes needed.
 * Active only when MOMO_SUBSCRIPTION_KEY + MOMO_API_USER + MOMO_API_KEY are set. */
export const realMomoProvider: PaymentProvider = {
  async charge(req: PaymentRequest): Promise<PaymentResult> {
    if (!req.phoneNumber) {
      return { success: false, providerRef: "", message: "A phone number is required for MoMo payment" };
    }
    try {
      const token = await getAccessToken();
      const referenceId = crypto.randomUUID();

      const res = await fetch(`${env.momo.baseUrl}/collection/v1_0/requesttopay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": env.momo.targetEnv,
          "Ocp-Apim-Subscription-Key": env.momo.subscriptionKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: String(req.amount),
          currency: env.momo.currency,
          externalId: req.reference,
          payer: { partyIdType: "MSISDN", partyId: normalizeMsisdn(req.phoneNumber) },
          payerMessage: "New Class Car Wash payment",
          payeeNote: "Car wash service",
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        logger.error({ status: res.status, body }, "MoMo requesttopay rejected");
        return { success: false, providerRef: "", message: "MoMo could not initiate payment" };
      }

      // 202 Accepted -- the push notification went to the customer's phone.
      // Now poll until they approve/reject or we time out.
      return await pollForOutcome(referenceId, token);
    } catch (err) {
      logger.error({ err }, "MoMo charge error");
      return { success: false, providerRef: "", message: "MoMo payment failed due to a connection error" };
    }
  },
  async refund(req: PaymentRequest): Promise<PaymentResult> {
    return {
      success: false,
      providerRef: req.reference,
      message: "Automatic MoMo refund is not configured for this Collections integration; process it in the MoMo portal and record it here after confirmation.",
    };
  },
};

/** Returns true when all three Collections sandbox credentials are present.
 * No extra gate needed -- the Collections token endpoint is confirmed working. */
export function isMomoConfigured(): boolean {
  return Boolean(env.momo.subscriptionKey && env.momo.apiUser && env.momo.apiKey);
}
