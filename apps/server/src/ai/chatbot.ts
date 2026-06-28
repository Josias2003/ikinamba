import { prisma } from "../lib/prisma.js";
import { chatWithLocalAI } from "./ollamaClient.js";
import { getOperationalSnapshot } from "./insights.js";
import { toolsForRole, executeTool } from "./tools.js";
import type { Role } from "../types/enums.js";

// Mirrors the role boundaries already encoded in the frontend's NAV_GROUPS
// (components/Layout.tsx) -- the assistant unlocks the same topics the sidebar would let
// that role navigate to, rather than a separately-maintained permission list. ADMIN is
// deliberately not on FLOOR_ROLES: real per-role separation, not seniority inheritance.
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

/** Booking/FAQ assistant grounded with real service catalog + bay data pulled from the DB,
 * so it can't hallucinate prices/services that don't exist. When called by a logged-in
 * staff member (role passed in), it's additionally grounded with operational data scoped
 * to what that role can already see elsewhere in the app -- anonymous customers and
 * unrecognized roles only ever get the base booking/FAQ grounding below. Can also act:
 * booking a real appointment, or pulling up a live chart, via the tools in ai/tools.ts. */
export async function askChatbot(history: ChatHistoryItem[], role?: Role): Promise<ChatbotReply> {
  // If the previous turn showed a booking preview and the user just confirmed it, book
  // directly from that already-validated data instead of asking the model to re-extract
  // every field from the conversation again -- a small local model occasionally drops or
  // re-mangles a field on a repeat extraction, which a real booking flow can't tolerate.
  const lastAssistant = history[history.length - 2];
  const lastUser = history[history.length - 1];
  if (
    lastUser?.role === "user" &&
    AFFIRMATIVE.test(lastUser.content) &&
    lastAssistant?.role === "assistant" &&
    lastAssistant.display?.type === "bookingPreview"
  ) {
    const outcome = await executeTool("book_appointment", { ...(lastAssistant.display.data as Record<string, unknown>), confirmed: true }, role);
    return outcome.ok ? { reply: outcome.summary, display: outcome.display } : { reply: outcome.message };
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
  const systemPrompt = `
You are New Class Car Wash's virtual assistant, Gisimenti, Kigali, Rwanda.
Today's date is ${today} -- use this to resolve relative dates like "tomorrow" or "Friday".
You help customers choose services, understand pricing/duration, and book or track a vehicle.
There are ${bays.length} service bays. Today's service catalog:
${catalogText}
${scopedBlocks.length ? `\nAdditional operational data you may answer questions about (the person you're talking to is logged-in staff with access to this):\n${scopedBlocks.join("\n")}` : ""}

Rules: Only quote prices/services from the catalog above, and only discuss the operational data given to you -- never invent numbers.
If asked something outside what you were given (including operational data not listed above), say it's outside what you have access to and suggest reception or the relevant dashboard page.
To book an appointment, use the book_appointment tool -- only call it once you have every required field. If anything is missing, ask for it in natural conversational language; never mention parameter or field names literally.
The booking does not exist until you call book_appointment. Never say a booking is confirmed, scheduled, or booked yourself -- if you have every required field, call book_appointment immediately in that same turn instead of describing the booking in words; the tool's own reply will tell you and the customer what happens next.
book_appointment is two-step: call it first with confirmed left out/false once you have all fields -- it replies with a summary for the customer to check, it does not book anything yet. Only call it again with confirmed=true, using the exact same details, after the customer has explicitly said something like yes/confirm/that's right in their next message.
To check status, tell them to use their QR tracking link sent at check-in.
Keep answers short (2-4 sentences). Output plain text only -- no markdown, no asterisks, no bold/headers.
`.trim();

  const tools = toolsForRole(role);
  // Lower temperature than the dashboard-narrative call -- tool-call argument extraction
  // benefits from determinism far more than it benefits from fluent/varied phrasing.
  const result = await chatWithLocalAI([{ role: "system", content: systemPrompt }, ...history], { tools, temperature: 0.15 });

  const toolCall = result.toolCalls?.[0];
  if (!toolCall) return { reply: result.content };

  const outcome = await executeTool(toolCall.function.name, toolCall.function.arguments, role);
  return outcome.ok ? { reply: outcome.summary, display: outcome.display } : { reply: outcome.message };
}
