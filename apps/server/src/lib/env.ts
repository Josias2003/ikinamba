import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: required("CLIENT_ORIGIN", "http://localhost:5173"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "IKINAMBA Car Wash <no-reply@ikinamba.local>",
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "ikinamba-ai",
  },
  // OAuth2 client-credentials creds from the "Payments V1" product on
  // developers.mtn.com (My Apps -> app row -> Consumer key/secret). All three must be
  // set to use the real API -- see docs/MOMO_SETUP_GUIDE.md. If any is missing,
  // mockProvider.ts falls back to the simulated provider instead of throwing, so the
  // app still runs without them.
  momo: {
    baseUrl: process.env.MOMO_BASE_URL || "",
    consumerKey: process.env.MOMO_CONSUMER_KEY || "",
    consumerSecret: process.env.MOMO_CONSUMER_SECRET || "",
    currency: process.env.MOMO_CURRENCY || "RWF",
  },
};
