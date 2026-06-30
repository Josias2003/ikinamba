import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: required("CLIENT_ORIGIN", "http://localhost:5173").split(",").map((s) => s.trim()),
  appUrl: (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, ""),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  brevo: {
    apiKey: process.env.BREVO_API_KEY || "",
    from: process.env.BREVO_FROM || "",
    senderName: process.env.BREVO_SENDER_NAME || "New Class Car Wash",
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "ikinamba-ai",
  },
  // MTN MoMo Collections sandbox credentials -- see docs/MOMO_SETUP_GUIDE.md for the
  // click-by-click setup. All four (subscriptionKey, apiUser, apiKey, targetEnv) must be
  // set to use the real sandbox; if any is missing, mockProvider.ts falls back to the
  // simulated provider so the app still runs without sandbox credentials.
  momo: {
    baseUrl: process.env.MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com",
    subscriptionKey: process.env.MOMO_SUBSCRIPTION_KEY || "",
    apiUser: process.env.MOMO_API_USER || "",
    apiKey: process.env.MOMO_API_KEY || "",
    targetEnv: process.env.MOMO_TARGET_ENV || "sandbox",
    currency: process.env.MOMO_CURRENCY || "EUR",
  },
};
