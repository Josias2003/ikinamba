import { prisma } from "../lib/prisma.js";
import { chatWithLocalAI } from "./ollamaClient.js";
import { getOperationalSnapshot } from "./insights.js";
import { toolsForRole, executeTool } from "./tools.js";
import { logger } from "../lib/logger.js";
import type { Role } from "../types/enums.js";

const FLOOR_ROLES: Role[] = ["MANAGER", "CASHIER", "RECEPTIONIST", "TECHNICIAN"];
const MONEY_ROLES: Role[] = ["ADMIN", "MANAGER"];
const ADMIN_ROLES: Role[] = ["ADMIN"];

async function buildFloorSnapshot(): Promise<string> {
  const bays = await prisma.bay.findMany();
  const occupied = bays.filter((b) => b.status === "OCCUPIED").length;
  const maintenance = bays.filter((b) => b.status === "MAINTENANCE").length;
  const waiting = await prisma.queueEntry.count({ where: { status: "WAITING" } });
  return `Live floor status: ${occupied}/${bays.length} bays occupied, ${maintenance} in maintenance, ${waiting} vehicles waiting in queue.`;
}

async function buildMoneySnapshot(): Promise<string> {
  const snap = await getOperationalSnapshot();
  return `Last 7 days: revenue RWF ${snap.revenue.toLocaleString()}, ${snap.vehiclesServiced} vehicles serviced. Low-stock items: ${
    snap.lowStock.map((i) => i.name).join(", ") || "none"
  }. Customers flagged HIGH churn risk: ${snap.highChurnCustomers.length}.`;
}

async function buildAdminSnapshot(): Promise<string> {
  const [activeUsers, recentAudit] = await Promise.all([
    prisma.user.count({ where: { isActive: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { user: { select: { email: true } } } }),
  ]);
  const auditLines = recentAudit.map((a) => `${a.action} ${a.entity} by ${a.user?.email ?? "system"}`).join("; ");
  return `Active staff accounts: ${activeUsers}. Most recent audit actions: ${auditLines || "none"}.`;
}

export interface ChatbotReply {
  reply: string;
  display?: { type: string; data: unknown };
}

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
  display?: { type: string; data: unknown };
}

const AFFIRMATIVE = /^\s*(yes|yeah|yep|yup|confirm(ed)?|correct|that'?s right|go ahead|book it|sure|ok(ay)?)\b/i;

const VEHICLE_MAKES = [
  "Toyota", "Honda", "BMW", "Mercedes", "Volkswagen", "VW", "Kia", "Hyundai",
  "Nissan", "Range Rover", "Land Rover", "Ford", "Audi", "Subaru", "Mitsubishi",
  "Mazda", "Peugeot", "Renault", "Jeep", "Suzuki", "Isuzu", "Fiat", "Opel",
  "Volvo", "Lexus", "Infiniti", "Skoda", "Seat", "Dodge", "Chevrolet", "Datsun",
];

/** Server-side extraction of booking fields from full conversation text.
 * Used as a fallback when the model writes a plain-text summary instead of calling
 * the tool (a common failure mode for small local models). Not exhaustive but covers
 * the standard happy-path conversation where the customer gives info in natural sentences. */
function extractBookingFields(
  history: ChatHistoryItem[],
  catalog: { name: string }[]
): Record<string, unknown> {
  const text = history.map((h) => h.content).join("\n");

  // Rwandan plate: 2-3 letters + 2-4 digits + 1-2 letters, e.g. RAH334G
  const plate = text.match(/\b([A-Za-z]{2,3}\d{2,4}[A-Za-z]{1,2})\b/)?.[1]?.toUpperCase();

  // Phone: local 07xxxxxxxx or international 2507xxxxxxxx
  const phone = text.match(/\b(07\d{8}|2507\d{8})\b/)?.[1];

  // Email
  const email = text.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/)?.[1];

  // Customer name: after "my name is" / "I'm" / "I am" + proper nouns
  const customerName = text
    .match(/(?:my name is|I(?:'m| am))\s+([A-Z][a-zA-Zéèêëàâùûüôîï'-]+(?:\s+[A-Z][a-zA-Zéèêëàâùûüôîï'-]+)+)/i)
    ?.[1]?.trim();

  // Vehicle make (longest match wins so "Range Rover" beats "Range")
  const vehicleMake = [...VEHICLE_MAKES]
    .sort((a, b) => b.length - a.length)
    .find((m) => new RegExp(`\\b${m.replace(" ", "\\s+")}\\b`, "i").test(text));

  // Vehicle model: first word immediately after the make (skip "and", "model", "is")
  const vehicleModel = vehicleMake
    ? text.match(
        new RegExp(
          `\\b${vehicleMake.replace(" ", "\\s+")}\\b[^a-zA-Z0-9]*(?:(?:and\\s+)?model(?:\\s+is)?\\s+)?([A-Za-z0-9]+)`,
          "i"
        )
      )?.[1]
    : undefined;

  // Services: any catalog item whose significant words appear in the conversation
  const serviceNames = catalog
    .filter((s) => {
      const words = s.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return words.some((w) => text.toLowerCase().includes(w));
    })
    .map((s) => s.name);

  // Date/time: ISO format (the LLM should have resolved relative phrases before writing)
  const isoM = text.match(/\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/);
  const scheduledAt = isoM ? new Date(isoM[1]).toISOString() : undefined;

  return {
    customerName,
    phone,
    email,
    vehicleMake,
    vehicleModel,
    plate,
    serviceNames: serviceNames.length ? serviceNames : undefined,
    scheduledAt,
  };
}

function missingBookingFields(args: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!args.customerName) missing.push("your full name");
  if (!args.phone) missing.push("your phone number");
  if (!args.email) missing.push("your email address");
  if (!args.vehicleMake || !args.vehicleModel) missing.push("the vehicle make and model");
  if (!args.plate) missing.push("the license plate number");
  if (!Array.isArray(args.serviceNames) || !(args.serviceNames as unknown[]).length)
    missing.push("which service(s) you want");
  if (!args.scheduledAt) missing.push("the preferred date and time");
  return missing;
}

/** Booking/FAQ assistant grounded with real service catalog + bay data pulled from the DB,
 * so it can't hallucinate prices/services that don't exist. When called by a logged-in
 * staff member (role passed in), it's additionally grounded with operational data scoped
 * to what that role can already see elsewhere in the app. */
export async function askChatbot(history: ChatHistoryItem[], role?: Role): Promise<ChatbotReply> {
  const lastUser = history[history.length - 1];
  const lastAssistant = history[history.length - 2];

  if (lastUser?.role === "user" && AFFIRMATIVE.test(lastUser.content)) {
    // SHORTCUT 1: a proper bookingPreview exists anywhere in the recent 10 turns.
    // Search back rather than only checking the immediately previous message -- the model
    // sometimes inserts an extra conversational turn between the preview and the user's yes.
    const preview = history
      .slice(-10)
      .reverse()
      .find((h) => h.role === "assistant" && h.display?.type === "bookingPreview");
    if (preview) {
      const outcome = await executeTool(
        "book_appointment",
        { ...(preview.display!.data as Record<string, unknown>), confirmed: true },
        role
      );
      return outcome.ok
        ? { reply: outcome.summary, display: outcome.display }
        : { reply: outcome.message };
    }

    // SHORTCUT 2: model wrote a plain-text booking summary without calling the tool.
    // Detected by: last assistant message has no display object but reads like a summary
    // (mentions plate / vehicle / service / RWF / "proceed"). Extract what we can from
    // the conversation; if everything is present, book directly (user already said yes
    // so no need for another preview round-trip); if something is still missing, ask for
    // just that one thing.
    const summaryLike =
      lastAssistant?.role === "assistant" &&
      !lastAssistant.display &&
      /\b(plate|vehicle|service|rwf|proceed|confirm|would you like)\b/i.test(
        lastAssistant.content ?? ""
      );
    if (summaryLike) {
      const svcs = await prisma.serviceCatalogItem.findMany({ where: { isActive: true } });
      const extracted = extractBookingFields(history, svcs);
      const missing = missingBookingFields(extracted);
      if (!missing.length) {
        const outcome = await executeTool(
          "book_appointment",
          { ...extracted, confirmed: true },
          role
        );
        return outcome.ok
          ? { reply: outcome.summary, display: outcome.display }
          : { reply: outcome.message };
      }
      return {
        reply:
          missing.length === 1
            ? `Just one more thing before I can book: ${missing[0]}?`
            : `Almost there! I still need: ${missing.join(", ")}.`,
      };
    }
  }

  const [services, bays] = await Promise.all([
    prisma.serviceCatalogItem.findMany({ where: { isActive: true } }),
    prisma.bay.findMany(),
  ]);

  const catalogText = services
    .map((s) => `- ${s.name} (${s.category}): RWF ${s.basePrice.toLocaleString()}, ~${s.durationMinutes} min`)
    .join("\n");

  const scopedBlocks: string[] = [];
  if (role && FLOOR_ROLES.includes(role)) scopedBlocks.push(await buildFloorSnapshot());
  if (role && MONEY_ROLES.includes(role)) scopedBlocks.push(await buildMoneySnapshot());
  if (role && ADMIN_ROLES.includes(role)) scopedBlocks.push(await buildAdminSnapshot());

  const today = new Date().toISOString().slice(0, 10);
  let systemPrompt = `
You are New Class Car Wash's virtual assistant, Gisimenti, Kigali, Rwanda.
Today's date is ${today} -- use this to resolve relative dates like "tomorrow" or "Friday".
You help customers choose services, understand pricing/duration, and book or track a vehicle.
There are ${bays.length} service bays. Today's service catalog:
${catalogText}
${scopedBlocks.length ? `\nAdditional operational data you may answer questions about (the person you're talking to is logged-in staff with access to this):\n${scopedBlocks.join("\n")}` : ""}

Rules: Only quote prices/services from the catalog above, and only discuss the operational data given to you -- never invent numbers.
If asked something outside what you were given (including operational data not listed above), say it's outside what you have access to and suggest reception or the relevant dashboard page.
To book an appointment, use the book_appointment tool -- only call it once you have every required field. If anything is missing, ask for it in natural conversational language; never mention parameter or field names literally.
Required fields are exactly: name, phone number, email address, vehicle make/model, plate number (license plate -- always ask for this if not given), which service(s), and the date/time. Email is required -- it is how the customer receives their booking confirmation and tracking QR code. Always ask for it; do not skip or treat the booking as complete without it.
CRITICAL: The booking does not exist until the book_appointment tool returns. NEVER write the words "confirmed", "booked", "scheduled", "all set", or any synonym yourself -- doing so tells the customer something is saved when nothing is. If you have every required field, call book_appointment immediately; the tool reply tells the customer what happened. If you are missing even one field, ask for it -- do not guess or skip.
book_appointment is two-step: call it first with confirmed omitted/false once you have all fields -- it returns a summary for the customer to verify, nothing is saved yet. Call it again with confirmed=true only after the customer explicitly says yes/confirm/correct/book it/go ahead in their next message.
To check status, tell them to use their QR tracking link sent at check-in.
Keep answers short (2-4 sentences). Output plain text only -- no markdown, no asterisks, no bold/headers.
`.trim();

  // Inject a real-time "still missing" reminder so the model can't skip fields it hasn't
  // collected yet -- static system-prompt rules alone aren't reliable with small local
  // models; a specific per-turn reminder that lists exactly what's outstanding is far more
  // effective. Only added when we detect the conversation is already in a booking flow
  // (user mentioned booking/service/vehicle in a prior turn).
  const inBookingFlow = history.some(
    (h) => h.role === "user" && /\b(book|appointment|wash|service|vehicle|car)\b/i.test(h.content)
  );
  if (inBookingFlow) {
    const alreadyCollected = extractBookingFields(history, services);
    const stillMissing = missingBookingFields(alreadyCollected);
    if (stillMissing.length) {
      systemPrompt += `\n\nFIELDS STILL NEEDED (do NOT call the tool yet, ask for these first, one at a time): ${stillMissing.join(", ")}.`;
    }
  }

  const tools = toolsForRole(role);
  let result: Awaited<ReturnType<typeof chatWithLocalAI>>;
  try {
    result = await chatWithLocalAI(
      [{ role: "system", content: systemPrompt }, ...history],
      { tools, temperature: 0.15 }
    );
  } catch (err) {
    logger.error({ err }, "Chatbot LLM call failed");
    return { reply: "I'm having a brief technical issue. Please try again in a moment." };
  }

  const toolCall = result.toolCalls?.[0];
  if (!toolCall) {
    const lower = result.content.toLowerCase();
    const looksLikeFakeConfirm =
      /\b(booking (is |has been )?(confirmed|scheduled|booked)|appointment (is |has been )?confirmed|you('re| are) (all set|booked))\b/.test(
        lower
      ) && !/\bshall i book|shall i confirm|can i confirm|want me to book\b/.test(lower);

    if (looksLikeFakeConfirm) {
      // Check what's actually missing from the conversation instead of blindly asking for plate.
      // If everything is in the history, call the tool properly rather than looping.
      const extracted = extractBookingFields(history, services);
      const missing = missingBookingFields(extracted);
      if (!missing.length) {
        const outcome = await executeTool(
          "book_appointment",
          { ...extracted, confirmed: false },
          role
        );
        return outcome.ok
          ? { reply: outcome.summary, display: outcome.display }
          : { reply: outcome.message };
      }
      return {
        reply:
          missing.length === 1
            ? `Before I can confirm that, I still need ${missing[0]}.`
            : `Before I can confirm that, I still need: ${missing.join(", ")}.`,
      };
    }
    return { reply: result.content };
  }

  // Pre-flight: if the model calls book_appointment with fields still missing, catch it
  // here for a cleaner conversational response before the service layer runs.
  if (toolCall.function.name === "book_appointment") {
    const a = toolCall.function.arguments as Record<string, unknown>;
    const missing = missingBookingFields(a);
    if (missing.length) {
      return {
        reply:
          missing.length === 1
            ? `I still need ${missing[0]} to complete this booking. Could you share that?`
            : `I still need a few things before I can book: ${missing.join(", ")}. Could you provide those?`,
      };
    }
  }

  const outcome = await executeTool(toolCall.function.name, toolCall.function.arguments, role);
  return outcome.ok ? { reply: outcome.summary, display: outcome.display } : { reply: outcome.message };
}
