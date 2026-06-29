import crypto from "crypto";
import { env } from "../../lib/env.js";
import { logger } from "../../lib/logger.js";
import type { PaymentProvider, PaymentRequest, PaymentResult } from "./PaymentProvider.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

/** Rwandan numbers come in from forms as local format (e.g. "0788123456") -- the
 * Collections API needs MSISDN with country code and no leading 0/+. */
function normalizeMsisdn(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("250")) return digits;
  if (digits.startsWith("0")) return `250${digits.slice(1)}`;
  return `250${digits}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) return cachedToken.value;

  const basicAuth = Buffer.from(`${env.momo.apiUser}:${env.momo.apiKey}`).toString("base64");
  const res = await fetch(`${env.momo.baseUrl}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Ocp-Apim-Subscription-Key": env.momo.subscriptionKey,
    },
  });
  if (!res.ok) throw new Error(`MoMo token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

async function pollForOutcome(referenceId: string, token: string): Promise<PaymentResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${env.momo.baseUrl}/collection/v1_0/requesttopay/${referenceId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": env.momo.subscriptionKey,
        "X-Target-Environment": env.momo.targetEnvironment,
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { status: string; reason?: string };
      if (data.status === "SUCCESSFUL") {
        return { success: true, providerRef: referenceId, message: "MoMo payment confirmed" };
      }
      if (data.status === "FAILED") {
        return { success: false, providerRef: referenceId, message: data.reason ?? "MoMo payment failed" };
      }
      // PENDING -- keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { success: false, providerRef: referenceId, message: "MoMo payment timed out waiting for customer approval" };
}

/** Real MTN MoMo Collections ("Request to Pay") integration -- same PaymentProvider
 * shape as the mock it replaces, so no caller needs to change. See
 * docs/MOMO_SETUP_GUIDE.md for how to get the four MOMO_* env vars this needs. */
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
          "Ocp-Apim-Subscription-Key": env.momo.subscriptionKey,
          "X-Target-Environment": env.momo.targetEnvironment,
          "X-Reference-Id": referenceId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: String(req.amount),
          currency: env.momo.currency,
          externalId: req.reference,
          payer: { partyIdType: "MSISDN", partyId: normalizeMsisdn(req.phoneNumber) },
          payerMessage: "New Class Car Wash payment",
          payeeNote: `Invoice ${req.reference}`,
        }),
      });

      if (res.status !== 202) {
        const body = await res.text();
        logger.error({ status: res.status, body }, "MoMo request-to-pay rejected");
        return { success: false, providerRef: referenceId, message: "MoMo could not process this request" };
      }

      return await pollForOutcome(referenceId, token);
    } catch (err) {
      logger.error({ err }, "MoMo charge failed");
      return { success: false, providerRef: "", message: "MoMo payment failed due to a connection error" };
    }
  },
};

export function isMomoConfigured(): boolean {
  return Boolean(env.momo.baseUrl && env.momo.subscriptionKey && env.momo.apiUser && env.momo.apiKey);
}
