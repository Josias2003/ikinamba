import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/errors.js";
import { getDashboardMetrics, defaultRange } from "../services/reports.service.js";
import { getBoard } from "../services/queue.service.js";
import { assertSlotAvailable, getAvailability, createPublicBooking } from "../services/appointments.service.js";
import type { ToolDefinition } from "./ollamaClient.js";
import type { Role } from "../types/enums.js";

// Same role boundaries as the grounding blocks in chatbot.ts -- kept here too since tool
// availability and grounding-block availability are conceptually the same permission.
// ADMIN doesn't run the floor (real per-role separation, not seniority inheritance) --
// see [[project-kariza-roles-separation]].
const FLOOR_ROLES: Role[] = ["MANAGER", "CASHIER", "RECEPTIONIST", "TECHNICIAN"];
const MONEY_ROLES: Role[] = ["ADMIN", "MANAGER"];

const SHOW_REVENUE_CHART: ToolDefinition = {
  type: "function",
  function: {
    name: "show_revenue_chart",
    description: "Show the customer's manager a chart of revenue over the last 30 days. Only call when asked about revenue/earnings trends.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const SHOW_QUEUE_STATUS: ToolDefinition = {
  type: "function",
  function: {
    name: "show_queue_status",
    description: "Show the current live bay/queue status (how many bays occupied, vehicles waiting). Only call when asked about current floor/queue status.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const BOOK_APPOINTMENT: ToolDefinition = {
  type: "function",
  function: {
    name: "book_appointment",
    description: "Book a car wash/service appointment. Only call this once you have ALL required fields -- otherwise ask the user for whatever is missing.",
    parameters: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Customer's full name" },
        phone: { type: "string", description: "Customer's phone number" },
        vehicleMake: { type: "string" },
        vehicleModel: { type: "string" },
        plate: { type: "string", description: "Vehicle license plate" },
        serviceNames: { type: "array", items: { type: "string" }, description: "REQUIRED, never omit: every service name the customer requested, matching the catalog given to you" },
        scheduledAt: { type: "string", description: "REQUIRED: a literal ISO 8601 date-time, e.g. 2026-06-28T08:00:00. You must resolve relative phrases like 'tomorrow' or 'next Friday' into an actual calendar date yourself using today's date before calling this tool -- never pass relative text like 'tomorrow' as this argument." },
        confirmed: {
          type: "boolean",
          description:
            "Leave false (or omit) the first time you have all fields -- this only shows the customer a summary to check, it does NOT book anything yet. " +
            "Set true ONLY on a later call, with the exact same details, after the customer has explicitly said yes/confirmed/correct in response to that summary.",
        },
      },
      required: ["customerName", "phone", "vehicleMake", "vehicleModel", "plate", "serviceNames", "scheduledAt"],
    },
  },
};

export function toolsForRole(role?: Role): ToolDefinition[] {
  const tools: ToolDefinition[] = [BOOK_APPOINTMENT];
  if (role && FLOOR_ROLES.includes(role)) tools.push(SHOW_QUEUE_STATUS);
  if (role && MONEY_ROLES.includes(role)) tools.push(SHOW_REVENUE_CHART);
  return tools;
}

export type ToolResult =
  | { ok: true; summary: string; display: { type: string; data: unknown } }
  | { ok: false; message: string };

export async function executeTool(name: string, args: Record<string, unknown>, role?: Role): Promise<ToolResult> {
  // Re-check permission server-side -- never trust that the model only requested a tool
  // it was actually offered.
  const allowed = toolsForRole(role).map((t) => t.function.name);
  if (!allowed.includes(name)) {
    return { ok: false, message: "That's outside what I have access to for your account." };
  }

  if (name === "show_revenue_chart") {
    const metrics = await getDashboardMetrics(defaultRange());
    return {
      ok: true,
      summary: `Total revenue over the last 30 days: RWF ${Math.round(metrics.totalRevenue).toLocaleString()} across ${metrics.vehiclesServiced} vehicles. Chart below.`,
      display: { type: "revenueChart", data: metrics.revenueByDay },
    };
  }

  if (name === "show_queue_status") {
    const board = await getBoard();
    const occupied = board.bays.filter((b) => b.status === "OCCUPIED").length;
    return {
      ok: true,
      summary: `${occupied}/${board.bays.length} bays occupied, ${board.waiting.length} vehicles waiting.`,
      display: {
        type: "queueStatus",
        data: {
          bays: board.bays.map((b) => ({ name: b.name, status: b.status })),
          waitingCount: board.waiting.length,
        },
      },
    };
  }

  if (name === "book_appointment") {
    return bookAppointmentTool(args);
  }

  return { ok: false, message: "I don't know how to do that yet." };
}

async function bookAppointmentTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { customerName, phone, vehicleMake, vehicleModel, plate, serviceNames, scheduledAt, confirmed } = args as Record<string, unknown>;

  // Defense in depth: the tool schema marks these required, but never trust the model's
  // arguments blindly -- re-check before touching the database, and say exactly what's
  // still missing (the model can drop a field or pass an unparsable date even when the
  // user already gave it -- a generic "missing details" message just loops the user).
  const missing: string[] = [];
  if (!customerName) missing.push("your name");
  if (!phone) missing.push("a phone number");
  if (!vehicleMake || !vehicleModel) missing.push("the vehicle's make and model");
  if (!plate) missing.push("the plate number");
  if (!Array.isArray(serviceNames) || !serviceNames.length) missing.push("which service(s) you'd like");
  if (!scheduledAt) missing.push("the date and time");
  if (missing.length) {
    return { ok: false, message: `I just need ${missing.join(", ")} to finish that booking.` };
  }

  const when = new Date(scheduledAt as string);
  if (isNaN(when.getTime())) {
    return { ok: false, message: "I couldn't pin down an exact date and time from that -- could you give me a specific day (e.g. June 28) and time?" };
  }

  const catalog = await prisma.serviceCatalogItem.findMany({ where: { isActive: true } });
  const matched: { id: string; name: string }[] = [];
  for (const requested of serviceNames as string[]) {
    const found = catalog.find((c) => c.name.toLowerCase().includes(String(requested).toLowerCase()) || String(requested).toLowerCase().includes(c.name.toLowerCase()));
    if (!found) {
      return {
        ok: false,
        message: `I don't have a service called "${requested}" in our catalog. We offer: ${catalog.map((c) => c.name).join(", ")}. Which would you like?`,
      };
    }
    matched.push({ id: found.id, name: found.name });
  }

  try {
    await assertSlotAvailable(when);
  } catch (err) {
    if (err instanceof HttpError) {
      const sameDay = await getAvailability(when);
      const alternatives = sameDay.filter((s) => s.available).slice(0, 3).map((s) => new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      return {
        ok: false,
        message: alternatives.length
          ? `That time's fully booked. Nearby open times: ${alternatives.join(", ")}. Want one of those instead?`
          : "That time's fully booked and I couldn't find another open slot that day -- could you try a different day?",
      };
    }
    throw err;
  }

  // Read back the exact resolved details before writing anything -- catches the small
  // model's occasional date-arithmetic mistakes (e.g. "tomorrow" resolved to the wrong
  // day) by giving the customer a chance to see and correct it before it's booked.
  if (confirmed !== true) {
    const when_ = when.toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return {
      ok: true,
      summary: `Here's what I have: ${matched.map((m) => m.name).join(", ")} for ${vehicleMake} ${vehicleModel} (${plate}) on ${when_}, under ${customerName}, ${phone}. Shall I book it?`,
      display: {
        type: "bookingPreview",
        data: { customerName, phone, vehicleMake, vehicleModel, plate, services: matched.map((m) => m.name), scheduledAt: when.toISOString() },
      },
    };
  }

  const appointment = await createPublicBooking({
    customer: { name: customerName as string, phone: phone as string },
    vehicle: { make: vehicleMake as string, model: vehicleModel as string, year: new Date().getFullYear(), plate: plate as string },
    scheduledAt: when,
    serviceItemIds: matched.map((m) => m.id),
    source: "ONLINE",
  });

  return {
    ok: true,
    summary: `Booked! ${matched.map((m) => m.name).join(", ")} on ${when.toLocaleString()} for ${customerName}. A confirmation with your tracking QR has been sent.`,
    display: { type: "bookingConfirmed", data: { trackingToken: appointment.trackingToken, scheduledAt: when.toISOString(), services: matched.map((m) => m.name) } },
  };
}
