import crypto from "crypto";
import type { PaymentProvider, PaymentRequest, PaymentResult } from "./PaymentProvider.js";
import { realMomoProvider, isMomoConfigured } from "./momoProvider.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulates MTN MoMo / Airtel Money / card processing: real latency, a real adapter shape,
 * and a small simulated decline rate -- so the UI has to handle failure paths like a live
 * integration would. Swapping in real provider SDKs later means implementing this same
 * interface, not rewriting callers. */
class MockPaymentProvider implements PaymentProvider {
  constructor(private channelName: string, private declineRate = 0.04) {}

  async charge(req: PaymentRequest): Promise<PaymentResult> {
    await sleep(400 + Math.random() * 600);
    const providerRef = `${this.channelName}-${crypto.randomBytes(6).toString("hex")}`;
    if (Math.random() < this.declineRate) {
      return { success: false, providerRef, message: `${this.channelName} declined the transaction` };
    }
    return { success: true, providerRef, message: `${this.channelName} payment confirmed` };
  }
}

export const momoProvider = new MockPaymentProvider("MOMO");
export const airtelProvider = new MockPaymentProvider("AIRTEL");
export const cardProvider = new MockPaymentProvider("CARD", 0.06);

export const cashProvider: PaymentProvider = {
  async charge(req) {
    return { success: true, providerRef: `CASH-${Date.now()}`, message: "Cash received" };
  },
};

export function providerFor(method: string): PaymentProvider {
  switch (method) {
    case "MOMO":
      // Real MTN MoMo Collections once all four MOMO_* env vars are set (see
      // docs/MOMO_SETUP_GUIDE.md); falls back to the simulated provider otherwise so the
      // app still runs for anyone who hasn't set up sandbox credentials yet.
      return isMomoConfigured() ? realMomoProvider : momoProvider;
    case "AIRTEL":
      return airtelProvider;
    case "CARD":
      return cardProvider;
    case "CASH":
      return cashProvider;
    default:
      throw new Error(`No payment provider for method ${method}`);
  }
}
