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

const AFFIRMATIVE = /^\s*(yes|yeah|yep|yup|confirm(ed)?|correct|that'?s right|go ahead|book it|sure|ok(ay)?)\b/i

/** Remove markdown formatting the small local model sometimes adds despite instructions.
 * Bullet lists become plain lines; bold/italic markers are stripped. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")   // **bold** -> bold
    .replace(/\*([^*\n]+)\*/g, "$1")      // *italic* -> italic
    .replace(/^#{1,6}\s+/gm, "")          // # headings
    .replace(/^[-*]\s+/gm, "")            // bullet list markers
    .replace(/`([^`]+)`/g, "$1")          // `inline code`
    .replace(/\n{3,}/g, "\n\n")           // collapse excessive blank lines
    .trim();
};

const VEHICLE_MAKES = [
  "Toyota", "Honda", "BMW", "Mercedes", "Volkswagen", "VW", "Kia", "Hyundai",
  "Nissan", "Range Rover", "Land Rover", "Ford", "Audi", "Subaru", "Mitsubishi",
  "Mazda", "Peugeot", "Renault", "Jeep", "Suzuki", "Isuzu", "Fiat", "Opel",
  "Volvo", "Lexus", "Infiniti", "Skoda", "Seat", "Dodge", "Chevrolet", "Datsun",
];

// Sentence filler words that must never be swallowed into an extracted name.
// Anything under 3 characters is also rejected when collecting name words.
const NAME_STOP_WORDS = new Set([
  "i", "a", "the", "to", "and", "need", "want", "book", "is", "am", "are",
  "my", "me", "you", "it", "name", "please", "sorry",
  "booking", "trying", "looking", "going", "calling", "coming", "here", "just",
]);

const MONTHS: Record<string, number> = {
  january:0, february:1, march:2, april:3, may:4, june:5,
  july:6, august:7, september:8, october:9, november:10, december:11,
};

/** Parse a natural language date/time string from a single message.
 * Handles ISO, "DD Month YYYY HH:MM", "Month DD YYYY", "today/tomorrow at HH:MM". */
function parseNaturalDate(text: string): string | undefined {
  // ISO: 2026-06-30T18:00 or 2026-06-30 18:00
  const isoM = text.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/);
  if (isoM) { const d = new Date(isoM[1]); if (!isNaN(d.getTime())) return d.toISOString(); }

  // "DD Month YYYY [at] HH:MM" e.g. "20 June 2026 18:00"
  const dmyM = text.match(
    /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})(?:[^0-9]+(\d{1,2}):(\d{2}))?/i
  );
  if (dmyM) {
    const d = new Date(Number(dmyM[3]), MONTHS[dmyM[2].toLowerCase()], Number(dmyM[1]),
      dmyM[4] ? Number(dmyM[4]) : 9, dmyM[5] ? Number(dmyM[5]) : 0);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // "Month DD[,] YYYY [at] HH:MM" e.g. "June 30, 2026"
  const mdyM = text.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})[,\s]+(\d{4})(?:[^0-9]+(\d{1,2}):(\d{2}))?/i
  );
  if (mdyM) {
    const d = new Date(Number(mdyM[3]), MONTHS[mdyM[1].toLowerCase()], Number(mdyM[2]),
      mdyM[4] ? Number(mdyM[4]) : 9, mdyM[5] ? Number(mdyM[5]) : 0);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // "today/tomorrow at HH:MM"
  const relM = text.match(/\b(today|tomorrow)\b[^0-9]*(\d{1,2}):(\d{2})/i);
  if (relM) {
    const d = new Date();
    if (relM[1].toLowerCase() === "tomorrow") d.setDate(d.getDate() + 1);
    d.setHours(Number(relM[2]), Number(relM[3]), 0, 0);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return undefined;
}

/** Server-side extraction of booking fields from conversation history.
 * Scans USER messages only (in reverse so the most recent correction wins) --
 * used both to drive the 'FIELDS STILL NEEDED' prompt reminder and as a fallback
 * when the model writes a plain-text summary instead of calling the tool. */
function extractBookingFields(
  history: ChatHistoryItem[],
  catalog: { name: string }[]
): Record<string, unknown> {
  // Only look at what the user said -- bot messages can confuse field extraction
  const userMsgs = history.filter((h) => h.role === "user").map((h) => h.content);
  const reversed = [...userMsgs].reverse();
  const allUserText = userMsgs.join("\n");

  // Rwandan plate (most recent mention -- user may correct)
  // Priority order: compact → spaced → spelled-out letters ("r a h 224 G")
  let plate: string | undefined;
  for (const msg of reversed) {
    const compact = msg.match(/\b([A-Za-z]{2,3}\d{2,4}[A-Za-z]{1,2})\b/);
    if (compact) { plate = compact[1].toUpperCase(); break; }
    const spaced = msg.match(/\b([A-Za-z]{2,3})\s+(\d{2,4})\s+([A-Za-z]{1,2})\b/);
    if (spaced) { plate = `${spaced[1]}${spaced[2]}${spaced[3]}`.toUpperCase(); break; }
    // Voice spells letters individually: "r a h 224 G" → RAH224G
    const spelled = msg.match(/\b([A-Za-z](?:\s+[A-Za-z]){1,3})\s+(\d{2,4})\s+([A-Za-z]{1,2})\b/);
    if (spelled) { plate = `${spelled[1].replace(/\s+/g, "")}${spelled[2]}${spelled[3]}`.toUpperCase(); break; }
  }

  // Phone (most recent) -- strip dashes/spaces first so "078-078-7811" and "078 078 7811" both match
  let phone: string | undefined;
  for (const msg of reversed) {
    const digits = msg.replace(/[\s\-]/g, "");
    const m = digits.match(/(07\d{8}|2507\d{8})/);
    if (m) { phone = m[1]; break; }
  }

  // Email (most recent) -- handles typed "a@b.com", voice "a at b dot com",
  // and multi-word voice like "black hat hackers 2022 at gmail dot com"
  let email: string | undefined;
  for (const msg of reversed) {
    // Standard typed email
    const typed = msg.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
    if (typed) { email = typed[1]; break; }

    const normalised = msg.replace(/\s+dot\s+/gi, ".");

    // Voice with "email is/my email is" prefix: captures multi-word local part
    // e.g. "email is black hat hackers 2022 at gmail.com" → "blackhathackers2022@gmail.com"
    const labelledMulti = normalised.match(
      /\bemail(?:\s+(?:is|address|:))?\s+([\w.+\-]+(?:\s+[\w.+\-]+){0,6})\s+at\s+([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/i
    );
    if (labelledMulti) {
      email = `${labelledMulti[1].trim().replace(/\s+/g, "")}@${labelledMulti[2]}`;
      break;
    }

    // Single-word voice: "zachary at gmail.com"
    const spoken = normalised.match(/\b([a-zA-Z0-9._+\-]+)\s+at\s+([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/i);
    if (spoken) { email = `${spoken[1]}@${spoken[2]}`; break; }
  }

  // Name: try multiple patterns across all user messages, prefer most recent match
  let customerName: string | undefined;
  for (const msg of reversed) {
    // "my name is X [Y]" / "I'm X" / "I am X" / "call me X" / "they call me X"
    // Single-word names are accepted; trailing sentence filler ("I need to book")
    // is trimmed off by stopping at the first short/stop word. Max 3 name words.
    const m1 = msg.match(
      /(?:my name is|I(?:'m| am)|(?:they\s+)?call me)\s+([A-Za-z][a-zA-Z'-]+(?:\s+[A-Za-z][a-zA-Z'-]+)*)/i
    );
    if (m1) {
      const nameWords: string[] = [];
      for (const w of m1[1].trim().split(/\s+/)) {
        if (w.length < 3 || NAME_STOP_WORDS.has(w.toLowerCase())) break;
        nameWords.push(w);
        if (nameWords.length >= 3) break;
      }
      if (nameWords.length) { customerName = nameWords.join(" "); break; }
    }

    // Standalone two-word proper name on its own line/message, not a vehicle make
    const m2 = msg.trim().match(/^([A-Z][a-z'-]+\s+[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)[\s,.]?$/);
    if (m2 && !VEHICLE_MAKES.some((mk) => m2[1].toLowerCase().includes(mk.toLowerCase()))) {
      customerName = m2[1].trim(); break;
    }
  }

  // Vehicle make (most recent user message mentioning a known make)
  let vehicleMake: string | undefined;
  let vehicleModel: string | undefined;
  const sortedMakes = [...VEHICLE_MAKES].sort((a, b) => b.length - a.length);
  for (const msg of reversed) {
    const mk = sortedMakes.find((m) => new RegExp(`\\b${m.replace(" ", "\\s+")}\\b`, "i").test(msg));
    if (mk) {
      vehicleMake = mk;
      const modelM = msg.match(
        new RegExp(
          `\\b${mk.replace(" ", "\\s+")}\\b[^a-zA-Z0-9]*(?:(?:and\\s+)?model(?:\\s+is)?\\s+)?([A-Za-z0-9]+)`,
          "i"
        )
      );
      vehicleModel = modelM?.[1];
      break;
    }
  }

  // Services: catalog items whose significant words appear anywhere in user messages
  const serviceNames = catalog
    .filter((s) => {
      const words = s.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return words.some((w) => allUserText.toLowerCase().includes(w));
    })
    .map((s) => s.name);

  // Date/time: most recent parseable date in any user message
  let scheduledAt: string | undefined;
  for (const msg of reversed) {
    const parsed = parseNaturalDate(msg);
    if (parsed) { scheduledAt = parsed; break; }
  }

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

/** Look up a returning customer by email or phone and merge their stored data into
 * the extracted fields so the model doesn't ask for info it already has.
 * Returns the enriched fields plus a system-prompt block telling the model what's
 * pre-filled and what it must NOT ask for again. */
async function enrichWithReturningCustomer(
  fields: Record<string, unknown>
): Promise<{ fields: Record<string, unknown>; customerBlock: string | null }> {
  const email = fields.email as string | undefined;
  const phone = fields.phone as string | undefined;
  if (!email && !phone) return { fields, customerBlock: null };

  const customer = await prisma.customer.findFirst({
    where: email ? { email } : { phone: phone! },
    include: { vehicles: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  if (!customer) return { fields, customerBlock: null };

  const enriched: Record<string, unknown> = { ...fields };
  enriched.customerName = enriched.customerName ?? customer.name;
  enriched.phone       = enriched.phone       ?? customer.phone;
  enriched.email       = enriched.email       ?? customer.email ?? email;

  let block = `RETURNING CUSTOMER — ${customer.name} (${customer.phone}${customer.email ? ", " + customer.email : ""}).`;

  if (customer.vehicles.length === 1 && !enriched.plate) {
    const v = customer.vehicles[0];
    enriched.vehicleMake  = v.make;
    enriched.vehicleModel = v.model;
    enriched.plate        = v.plate;
    block += ` One vehicle on file: ${v.make} ${v.model} (${v.plate}). Do NOT ask for name, phone, email, make, model, or plate — they are already known. Only ask for the service(s) wanted and the preferred date/time.`;
  } else if (customer.vehicles.length > 1) {
    const list = customer.vehicles.map((v) => `${v.make} ${v.model} (${v.plate})`).join(", ");
    block += ` Vehicles on file: ${list}. Do NOT ask for name, phone, or email. Ask which vehicle they are bringing today, or whether it is a new car.`;
  } else {
    block += ` No vehicle on file yet. Do NOT ask for name, phone, or email again. Ask for their vehicle details and desired service.`;
  }

  return { fields: enriched, customerBlock: block };
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

// --- Booking conductor helpers ---

// Patterns used to count how many times the bot already asked for each field.
// We require a "?" so general mentions (e.g. "services start at RWF 2000") don't count.
const FIELD_ASK_PATTERNS: Record<string, RegExp> = {
  "your full name": /\bname\b/i,
  "your phone number": /\b(phone|contact|digits)\b/i,
  "your email address": /\b(email|username)\b/i,
  "the vehicle make and model": /\b(make|model)\b/i,
  "the license plate number": /\b(plate|character)\b/i,
  "which service(s) you want": /\bservice\b/i,
  "the preferred date and time": /\b(date|time|when)\b/i,
};

// Voice retry prompts are spoken instructions ("Say the digits one by one.") that
// don't always end in "?", so count those too -- otherwise the attempt counter
// stalls and the retry escalation / give-up threshold is never reached.
const RETRY_PROMPT_STYLE = /^(sorry, i did not catch|(please\s+)?say\b)/i;

function countFieldAsks(history: ChatHistoryItem[], fieldLabel: string): number {
  const pat = FIELD_ASK_PATTERNS[fieldLabel];
  if (!pat) return 0;
  return history.filter(
    (h) =>
      h.role === "assistant" &&
      pat.test(h.content) &&
      (h.content.includes("?") || RETRY_PROMPT_STYLE.test(h.content))
  ).length;
}

function firstAskForField(fieldLabel: string): string {
  switch (fieldLabel) {
    case "your full name":
      return "Could I get your full name for the booking?";
    case "your phone number":
      return "What is your phone number?";
    case "your email address":
      return "What is your email address? I will send the confirmation and QR code there.";
    case "the vehicle make and model":
      return "What make and model is your vehicle? For example, Toyota Corolla.";
    case "the license plate number":
      return "What is the license plate number on the vehicle?";
    case "which service(s) you want":
      // Do NOT enumerate the whole catalog -- TTS reading a long list is painful.
      // The user says what they want and extractBookingFields matches the catalog.
      return "Which service would you like? We offer washes, detailing, inspections, and more.";
    case "the preferred date and time":
      return "When would you like to come in? For example, Friday at 10am.";
    default:
      return `Could you tell me ${fieldLabel}?`;
  }
}

// Voice-only retry guidance. Never tells the user to type -- this assistant is
// driven by speech, so every retry coaches the user on HOW to say it instead.
function retryAskForField(fieldLabel: string, attemptNumber: number): string {
  const friendlyNames: Record<string, string> = {
    "your full name": "full name",
    "your phone number": "phone number",
    "your email address": "email address",
    "the vehicle make and model": "vehicle make and model",
    "the license plate number": "plate number",
    "which service(s) you want": "service choice",
    "the preferred date and time": "preferred date and time",
  };
  const fname = friendlyNames[fieldLabel] ?? fieldLabel;

  if (fieldLabel === "your full name") {
    if (attemptNumber === 1) return "Sorry, I did not catch that. Please say just your first name.";
    if (attemptNumber === 2) return "Say your first name, then your last name, one word at a time.";
    return "Please say your name again, speaking each syllable slowly.";
  }
  if (fieldLabel === "the license plate number") {
    if (attemptNumber === 1) return "Say each character separately. For example: R, A, B, then 1, 2, 3, then A.";
    return "Please say the plate one character at a time.";
  }
  if (fieldLabel === "your email address") {
    if (attemptNumber === 1) return "Say your email like: username, at, gmail, dot, com.";
    return "Say each part separately: your username, then at, then the domain, then dot com.";
  }
  if (fieldLabel === "your phone number") {
    if (attemptNumber === 1) return "Please say your 10-digit phone number again.";
    return "Say the digits one by one.";
  }
  if (attemptNumber === 1) {
    return `Sorry, I did not catch that. Could you say your ${fname} again?`;
  }
  return `Please say your ${fname} once more, speaking slowly and clearly.`;
}

/** Graceful degradation after repeated failed retries on the same field: build a
 * best-guess value from the last user message so the flow can move on instead of
 * looping forever. Returns null for fields where guessing would be worse than
 * asking again (phone/email/service/date have rigid extraction). */
function bestGuessForField(
  fieldLabel: string,
  lastUserMessage: string
): Record<string, unknown> | null {
  if (fieldLabel === "your full name") {
    // First run of 3+ consecutive letters that isn't a known stop word
    const runs = lastUserMessage.match(/[A-Za-z]{3,}/g) ?? [];
    const word = runs.find((w) => !NAME_STOP_WORDS.has(w.toLowerCase()));
    return { customerName: word ?? "Guest" };
  }
  if (fieldLabel === "the license plate number") {
    const parts = lastUserMessage.match(/[A-Za-z0-9]{2,}/g);
    if (parts?.length) return { plate: parts.join("").toUpperCase() };
    return null;
  }
  return null;
}

/**
 * Booking conductor: handles every booking-flow turn with instant template responses,
 * bypassing the LLM entirely. Returns null for non-booking messages so they fall
 * through to the LLM as normal. Eliminates the 50-second cold-start wait during booking
 * and guarantees exactly one field is asked per turn with automatic retry logic.
 */
async function conductBooking(
  history: ChatHistoryItem[],
  services: { name: string }[],
  role?: Role
): Promise<ChatbotReply | null> {
  try {
    const lastUser = history[history.length - 1];
    if (lastUser?.role !== "user") return null;

    // Affirmatives ("yes", "confirm", etc.) are handled by SHORTCUT 1/2 above
    if (AFFIRMATIVE.test(lastUser.content)) return null;

    // Extract fields first -- we use the presence of any already-collected field as an
    // additional booking-intent signal alongside the keyword check. This keeps the conductor
    // active even after the original "book" keyword has scrolled far up in a long conversation.
    const raw = extractBookingFields(history, services);
    const alreadyHaveAField = !!(raw.phone || raw.email || raw.customerName || raw.vehicleMake || raw.plate);

    const hasBookingIntent =
      alreadyHaveAField ||
      history.some(
        (h) => h.role === "user" && /\b(book|appointment|schedule|reserve)\b/i.test(h.content)
      );
    if (!hasBookingIntent) return null;

    // Let the LLM handle FAQ/info questions asked mid-booking-flow
    const isInfoQuestion = /\b(how much|what (services?|is|are)|price|cost|how long|opening hours?|do you (have|offer)|can i|is it possible)\b/i.test(
      lastUser.content
    );
    if (isInfoQuestion) return null;

    const { fields: collected } = await enrichWithReturningCustomer(raw);
    const missing = missingBookingFields(collected);

    // All fields present - fire the booking preview immediately, no LLM needed
    if (!missing.length) {
      const outcome = await executeTool("book_appointment", { ...collected, confirmed: false }, role);
      return outcome.ok
        ? { reply: outcome.summary, display: outcome.display }
        : { reply: outcome.message };
    }

    // Ask for the next missing field, with retry/give-up logic
    const nextField = missing[0];
    const askCount = countFieldAsks(history, nextField);

    // Graceful degradation: after 5+ asks with no successful extraction, take the
    // best guess from the last user message and move on rather than looping forever.
    // Only name and plate are guessable; other fields keep asking.
    if (askCount >= 5) {
      const guess = bestGuessForField(nextField, lastUser.content);
      if (guess) {
        const patched = { ...collected, ...guess };
        const stillMissing = missingBookingFields(patched);
        if (!stillMissing.length) {
          const outcome = await executeTool("book_appointment", { ...patched, confirmed: false }, role);
          return outcome.ok
            ? { reply: outcome.summary, display: outcome.display }
            : { reply: outcome.message };
        }
        const followUp = stillMissing[0];
        const followUpCount = countFieldAsks(history, followUp);
        return {
          reply: followUpCount === 0
            ? firstAskForField(followUp)
            : retryAskForField(followUp, followUpCount),
        };
      }
    }

    const reply = askCount === 0
      ? firstAskForField(nextField)
      : retryAskForField(nextField, askCount);
    return { reply };

  } catch (err) {
    logger.error({ err }, "conductBooking error");
    return { reply: "Sorry, I had a small hiccup. Could you repeat what you just said?" };
  }
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
      const raw = extractBookingFields(history, svcs);
      const { fields: extracted } = await enrichWithReturningCustomer(raw);
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

  // CONDUCTOR: bypass the LLM for booking field collection -- instant template responses,
  // one field per turn, automatic retry logic. Returns null for non-booking turns so they
  // fall through to the LLM as normal.
  const conductorReply = await conductBooking(history, services, role);
  if (conductorReply) return conductorReply;

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
BOOKING RULES (follow exactly):
1. Ask for ONE missing field at a time -- never list multiple questions in one reply.
2. Never re-ask for a field already collected (see ALREADY COLLECTED section below).
3. Never write "confirmed", "booked", "scheduled", or "all set" yourself -- the tool does that.
4. When all fields are collected, call book_appointment with confirmed=false immediately.
5. After the customer says yes/confirm, call book_appointment again with confirmed=true.
6. Output plain text only -- no bullet points, no dashes, no bold, no asterisks, no lists.
7. Keep every reply to 1-2 sentences maximum.
Required fields: name, phone, email (required for QR confirmation), vehicle make, vehicle model, license plate, service(s), date and time.
`.trim();

  // Per-turn booking state injection -- small local models cannot track multi-turn state
  // reliably from the conversation history alone. We do it for them server-side:
  // 1. Tell the model exactly what is already collected so it NEVER re-asks.
  // 2. Tell it the single next field to ask for -- not a list, one field only.
  // This is far more effective than static rules for a sub-2B parameter model.
  const inBookingFlow = history.some(
    (h) => h.role === "user" && /\b(book|appointment|wash|service|vehicle|car)\b/i.test(h.content)
  );
  if (inBookingFlow) {
    const raw = extractBookingFields(history, services);
    const { fields: alreadyCollected, customerBlock } = await enrichWithReturningCustomer(raw);
    if (customerBlock) systemPrompt += `\n\n${customerBlock}`;

    // Build the "already have" block
    const have: string[] = [];
    if (alreadyCollected.customerName) have.push(`name: "${alreadyCollected.customerName}"`);
    if (alreadyCollected.phone)        have.push(`phone: "${alreadyCollected.phone}"`);
    if (alreadyCollected.email)        have.push(`email: "${alreadyCollected.email}"`);
    if (alreadyCollected.vehicleMake)  have.push(`vehicle make: "${alreadyCollected.vehicleMake}"`);
    if (alreadyCollected.vehicleModel) have.push(`vehicle model: "${alreadyCollected.vehicleModel}"`);
    if (alreadyCollected.plate)        have.push(`plate: "${alreadyCollected.plate}"`);
    if (Array.isArray(alreadyCollected.serviceNames) && (alreadyCollected.serviceNames as string[]).length)
      have.push(`services: "${(alreadyCollected.serviceNames as string[]).join(", ")}"`);
    if (alreadyCollected.scheduledAt)
      have.push(`date/time: "${new Date(alreadyCollected.scheduledAt as string).toLocaleString()}"`);

    if (have.length) {
      systemPrompt += `\n\nALREADY COLLECTED — do NOT ask for these again, do NOT mention them as missing:\n${have.join("\n")}`;
    }

    const stillMissing = missingBookingFields(alreadyCollected);
    if (stillMissing.length) {
      systemPrompt += `\n\nNEXT ACTION: Ask the customer for their ${stillMissing[0]} only. One question, nothing else. Do not list other fields.`;
    } else {
      systemPrompt += `\n\nNEXT ACTION: All fields collected. Call book_appointment now with confirmed=false.`;
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
      /\b((booking|appointment) (is |has been )?(confirmed|scheduled|booked)|you('re| are) (all set|booked))\b/.test(
        lower
      ) && !/\bshall i book|shall i confirm|can i confirm|want me to book\b/.test(lower);

    if (looksLikeFakeConfirm) {
      const raw = extractBookingFields(history, services);
      const { fields: extracted } = await enrichWithReturningCustomer(raw);
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
      // Model fake-confirmed but fields are still missing -- ask only for what's outstanding
      return {
        reply:
          missing.length === 1
            ? `I still need your ${missing[0]} before I can book that. Could you share it?`
            : `I still need a couple of things to finish the booking: ${missing.join(", ")}.`,
      };
    }
    return { reply: stripMarkdown(result.content) };
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
