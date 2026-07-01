import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/errors.js";
import { getDashboardMetrics, defaultRange } from "../services/reports.service.js";
import { getBoard } from "../services/queue.service.js";
import { assertSlotAvailable, getAvailability, createPublicBooking } from "../services/appointments.service.js";
import type { ToolDefinition } from "./ollamaClient.js";
import type { Role } from "../types/enums.js";

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

const CHECK_VEHICLE_STATUS: ToolDefinition = {
  type: "function",
  function: {
    name: "check_vehicle_status",
    description: "Check the current service progress of a vehicle by its plate number. Call this when someone asks about their car's status, how far along it is, which bay it's in, or when it will be ready.",
    parameters: {
      type: "object",
      properties: {
        plate: { type: "string", description: "The vehicle license plate number to look up" },
      },
      required: ["plate"],
    },
  },
};

const SHOW_AVAILABILITY: ToolDefinition = {
  type: "function",
  function: {
    name: "show_availability",
    description: "Show available booking time slots for a specific date. Call this when a customer asks when you are free, what times are available, whether a date has openings, or before they have picked a time slot.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "The date to check, in YYYY-MM-DD format. Resolve relative phrases like 'tomorrow' or 'this Saturday' to an actual date before calling." },
      },
      required: ["date"],
    },
  },
};

const LOOKUP_MY_APPOINTMENT: ToolDefinition = {
  type: "function",
  function: {
    name: "lookup_my_appointment",
    description: "Look up a customer's upcoming appointment by their email address or phone number. Call when someone asks to confirm their booking, check if it was saved, or says 'did my booking go through?'.",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer's email address" },
        phone: { type: "string", description: "Customer's phone number (use if no email given)" },
      },
      required: [],
    },
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
        email: { type: "string", description: "Customer's email address -- required for the confirmation email with tracking QR. Always ask for it." },
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
      required: ["customerName", "phone", "email", "vehicleMake", "vehicleModel", "plate", "serviceNames", "scheduledAt"],
    },
  },
};

export function toolsForRole(role?: Role): ToolDefinition[] {
  const tools: ToolDefinition[] = [BOOK_APPOINTMENT, CHECK_VEHICLE_STATUS, SHOW_AVAILABILITY, LOOKUP_MY_APPOINTMENT];
  if (role && FLOOR_ROLES.includes(role)) tools.push(SHOW_QUEUE_STATUS);
  if (role && MONEY_ROLES.includes(role)) tools.push(SHOW_REVENUE_CHART);
  return tools;
}

export type ToolResult =
  | { ok: true; summary: string; display: { type: string; data: unknown } }
  | { ok: false; message: string };

export async function executeTool(name: string, args: Record<string, unknown>, role?: Role): Promise<ToolResult> {
  const allowed = toolsForRole(role).map((t) => t.function.name);
  if (!allowed.includes(name)) {
    return { ok: false, message: "That's outside what I have access to for your account." };
  }

  if (name === "check_vehicle_status") return checkVehicleStatusTool(args);
  if (name === "show_availability")    return showAvailabilityTool(args);
  if (name === "lookup_my_appointment") return lookupMyAppointmentTool(args);

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

  if (name === "book_appointment") return bookAppointmentTool(args);

  return { ok: false, message: "I don't know how to do that yet." };
}

async function showAvailabilityTool(args: Record<string, unknown>): Promise<ToolResult> {
  const dateStr = String(args.date ?? "").trim();
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return { ok: false, message: "I couldn't understand that date. Could you try something like 'July 5' or '2026-07-05'?" };
  }
  const slots = await getAvailability(date);
  const available = slots.filter((s) => s.available);
  const dayLabel = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  if (!available.length) {
    return { ok: false, message: `We're fully booked on ${dayLabel}. Would you like to try a different day?` };
  }
  return {
    ok: true,
    summary: `We have ${available.length} open slot${available.length !== 1 ? "s" : ""} on ${dayLabel}. Pick a time below, then tell me which you'd like.`,
    display: {
      type: "availabilitySlots",
      data: { date: dateStr, slots: available.map((s) => s.start) },
    },
  };
}

async function lookupMyAppointmentTool(args: Record<string, unknown>): Promise<ToolResult> {
  const email = (args.email as string | undefined)?.trim().toLowerCase();
  const phone = (args.phone as string | undefined)?.trim();
  if (!email && !phone) {
    return { ok: false, message: "Could you give me your email address or phone number so I can find your booking?" };
  }
  const customer = await prisma.customer.findFirst({
    where: email ? { email } : { phone: phone! },
  });
  if (!customer) {
    return { ok: false, message: "I couldn't find an account with those details. Double-check the email or phone, or ask our front desk for help." };
  }
  const appt = await prisma.appointment.findFirst({
    where: {
      customerId: customer.id,
      status: { notIn: ["CANCELLED", "COMPLETED"] },
      scheduledAt: { gte: new Date() },
    },
    include: { vehicle: true, serviceItems: { include: { catalogItem: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  if (!appt) {
    return {
      ok: false,
      message: `Hi ${customer.name}! I don't see any upcoming appointments on your account. Would you like to book one?`,
    };
  }
  const when = appt.scheduledAt.toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const services = appt.serviceItems.map((si) => si.catalogItem.name).join(", ");
  return {
    ok: true,
    summary: `Hi ${customer.name}! Your booking is confirmed: ${services} on ${when} for ${appt.vehicle.make} ${appt.vehicle.model} (${appt.vehicle.plate}).`,
    display: {
      type: "appointmentLookup",
      data: {
        customerName: customer.name,
        services,
        scheduledAt: appt.scheduledAt.toISOString(),
        vehicle: { make: appt.vehicle.make, model: appt.vehicle.model, plate: appt.vehicle.plate },
        trackingToken: appt.trackingToken,
        status: appt.status,
      },
    },
  };
}

async function checkVehicleStatusTool(args: Record<string, unknown>): Promise<ToolResult> {
  const plate = String(args.plate ?? "").trim();
  if (!plate) return { ok: false, message: "Please provide the plate number you'd like to check." };

  const STAGE_LABELS: Record<string, string> = {
    WAITING: "waiting in the queue",
    IN_SERVICE: "currently being serviced",
    QUALITY_CHECK: "in quality check",
    READY: "ready for pickup",
    COMPLETED: "completed",
  };

  const vehicle = await prisma.vehicle.findFirst({
    where: { plate: { contains: plate } },
    select: { id: true, make: true, model: true, plate: true },
  });

  if (vehicle) {
    const entry = await prisma.queueEntry.findFirst({
      where: { vehicleId: vehicle.id, status: { not: "COMPLETED" } },
      include: { bay: { select: { name: true } }, serviceJob: { include: { items: { select: { name: true } } } } },
      orderBy: { checkedInAt: "desc" },
    });

    if (entry) {
      const label = STAGE_LABELS[entry.status] ?? entry.status;
      const bayInfo = entry.bay ? ` in bay ${entry.bay.name}` : "";
      const services = entry.serviceJob?.items.map((i) => i.name).join(", ") ?? "";
      const pickup = entry.status === "READY" ? " Please come to collect your vehicle!" : "";
      return {
        ok: true,
        summary: `${vehicle.make} ${vehicle.model} (${vehicle.plate}) is ${label}${bayInfo}.${services ? ` Services: ${services}.` : ""}${pickup}`,
        display: {
          type: "vehicleStatus",
          data: { status: entry.status, plate: vehicle.plate, vehicle, bay: entry.bay?.name ?? null, services: entry.serviceJob?.items.map((i) => i.name) ?? [] },
        },
      };
    }

    const appt = await prisma.appointment.findFirst({
      where: { vehicleId: vehicle.id, status: { notIn: ["CANCELLED", "COMPLETED"] } },
      orderBy: { scheduledAt: "asc" },
    });

    if (appt) {
      const when = appt.scheduledAt.toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
      return {
        ok: true,
        summary: `${vehicle.make} ${vehicle.model} (${vehicle.plate}) has an appointment booked for ${when}. It hasn't been checked in yet.`,
        display: { type: "vehicleStatus", data: { status: "BOOKED", plate: vehicle.plate, vehicle, bay: null, services: [], scheduledAt: appt.scheduledAt } },
      };
    }
  }

  return { ok: false, message: `No active booking or service found for plate "${plate}". Double-check the plate or ask our front desk for help.` };
}

async function bookAppointmentTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { customerName, phone, email, vehicleMake, vehicleModel, plate, serviceNames, scheduledAt, confirmed } = args as Record<string, unknown>;

  const missing: string[] = [];
  if (!customerName) missing.push("your name");
  if (!phone) missing.push("a phone number");
  if (!email) missing.push("an email address");
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

  if (confirmed !== true) {
    const when_ = when.toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return {
      ok: true,
      summary: `Here's what I have: ${matched.map((m) => m.name).join(", ")} for ${vehicleMake} ${vehicleModel} (${plate}) on ${when_}, under ${customerName} (${phone}, ${email}). Shall I book it?`,
      display: {
        type: "bookingPreview",
        data: { customerName, phone, email, vehicleMake, vehicleModel, plate, serviceNames: matched.map((m) => m.name), scheduledAt: when.toISOString() },
      },
    };
  }

  const appointment = await createPublicBooking({
    customer: { name: customerName as string, phone: phone as string, email: email as string },
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
