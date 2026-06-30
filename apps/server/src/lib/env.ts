import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: required("CLIENT_ORIGIN", "http://localhost:5173").split(",").map((s) => s.trim()),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "New Class Car Wash <no-reply@newclasscarwash.rw>",
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
