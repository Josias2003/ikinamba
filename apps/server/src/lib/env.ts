import "dotenv/config";
import os from "os";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** Returns the machine's current LAN IP so tracking links and CORS work on any device
 * on the same network without ever hardcoding an IP in .env. Prefers hotspot/10.x
 * addresses (phone hotspot) over router LAN (192.168.x). Falls back to localhost. */
function detectLanIp(): string {
  const candidates: string[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/loopback|vmware|virtual|docker|vethernet|bluetooth|hyper/i.test(name)) continue;
    for (const net of addrs ?? []) {
      if (net.family !== "IPv4" || net.internal || net.address.startsWith("169.254.")) continue;
      candidates.push(net.address);
    }
  }
  return candidates.find((ip) => ip.startsWith("10.")) ?? candidates.find((ip) => ip.startsWith("192.168.")) ?? candidates[0] ?? "localhost";
}

const lanIp = detectLanIp();
const frontendPort = 5173;

export const env = {
  port: Number(process.env.PORT ?? 4000),
  // If explicitly set (production), use as-is. In dev, auto-build from detected LAN IP.
  clientOrigin: process.env.CLIENT_ORIGIN
    ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim())
    : [`http://localhost:${frontendPort}`, `http://${lanIp}:${frontendPort}`],
  appUrl: process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : `http://${lanIp}:${frontendPort}`,
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
