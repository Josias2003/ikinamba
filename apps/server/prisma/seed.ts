import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth.js";
import { trainAllModels } from "../src/ai/train.js";
import { recomputeCustomerInsights } from "../src/ai/scoring.js";
import { pointsEarnedFor, tierForSpend } from "../src/lib/loyalty.js";

const prisma = new PrismaClient();
const DAY_MS = 86_400_000;
const NOW = new Date();
const BATCH_SIZE = 2000;

const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const pick = <T>(arr: T[]): T => arr[randInt(0, arr.length - 1)];
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY_MS);

/** Like daysAgo, but lands at a random time within business hours (08:00-18:00) instead of
 * preserving the seed script's run-time-of-day -- otherwise every generated visit clusters at
 * a single hour, which makes peak-hour analysis meaningless. */
function daysAgoAtBusinessHour(d: number): Date {
  const date = daysAgo(d);
  date.setHours(randInt(8, 17), randInt(0, 59), 0, 0);
  return date;
}

/** Bulk-inserts in fixed-size chunks -- createMany has no row-count ceiling in MySQL itself,
 * but batching keeps each query's parameter count well clear of any driver/packet limits at
 * the tens-of-thousands-of-rows scale this script generates. */
async function bulkInsert<T>(label: string, rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await insert(rows.slice(i, i + BATCH_SIZE));
  }
  console.log(`  ${label}: ${rows.length} rows`);
}

const MAKES = [
  ["Toyota", "Corolla"], ["Toyota", "RAV4"], ["Toyota", "Hiace"], ["Suzuki", "Alto"],
  ["Nissan", "X-Trail"], ["Honda", "Civic"], ["Mitsubishi", "Pajero"], ["Hyundai", "Tucson"],
  ["Kia", "Sportage"], ["Volkswagen", "Golf"],
];
const FIRST_NAMES = ["Eric", "Aline", "Jean", "Claudine", "Patrick", "Diane", "Emmanuel", "Solange", "Olivier", "Vanessa", "Marie", "Bosco", "Aimee", "David", "Grace", "Samuel", "Josiane", "Pacifique", "Nadia", "Yves", "Chantal", "Frank", "Lillian", "Eric", "Divine", "Innocent", "Christine", "Moses", "Esperance", "Theogene"];
const LAST_NAMES = ["Mugisha", "Uwase", "Niyonzima", "Ingabire", "Habimana", "Mukamana", "Bizimana", "Uwimana", "Nkurunziza", "Gasana", "Mutesi", "Ndayisaba", "Kamanzi", "Murekatete", "Twagirayezu"];

async function resetDatabase() {
  // Order matters: children before parents.
  const tableOrder = [
    "AuditLog", "CustomerInsight", "Message", "NotificationLog", "LoyaltyTransaction",
    "Payment", "InvoiceItem", "Invoice", "PurchaseOrderItem", "PurchaseOrder", "Supplier", "InventoryItem",
    "VehiclePhoto", "MaintenanceInspection", "ServiceJobItem", "ServiceJob", "QueueEntry",
    "AppointmentServiceItem", "Appointment", "Vehicle", "ServiceCatalogItem", "Bay", "User", "Customer",
  ];
  for (const table of tableOrder) {
    // @ts-expect-error dynamic model access for bulk reset
    await prisma[table.charAt(0).toLowerCase() + table.slice(1)].deleteMany();
  }
}

async function seedBaysAndCatalog() {
  const bays = await Promise.all(["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 5", "Bay 6"].map((name) => prisma.bay.create({ data: { name } })));

  const catalog = await Promise.all(
    [
      { name: "Basic Wash", category: "WASH", basePrice: 5000, durationMinutes: 20 },
      { name: "Premium Wash", category: "WASH", basePrice: 8000, durationMinutes: 30 },
      { name: "Deluxe Detailing", category: "DETAIL", basePrice: 25000, durationMinutes: 90 },
      { name: "Waxing", category: "DETAIL", basePrice: 15000, durationMinutes: 45 },
      { name: "Polishing", category: "DETAIL", basePrice: 18000, durationMinutes: 60 },
      { name: "Oil Change", category: "MAINTENANCE", basePrice: 20000, durationMinutes: 30 },
      { name: "Tire Rotation", category: "MAINTENANCE", basePrice: 10000, durationMinutes: 30 },
      { name: "Brake Inspection", category: "INSPECTION", basePrice: 5000, durationMinutes: 20 },
      { name: "Full Inspection", category: "INSPECTION", basePrice: 12000, durationMinutes: 40 },
      { name: "Underbody Wash", category: "ADDON", basePrice: 3000, durationMinutes: 10 },
      { name: "Tire Shine", category: "ADDON", basePrice: 2000, durationMinutes: 5 },
      { name: "Interior Vacuum", category: "ADDON", basePrice: 4000, durationMinutes: 15 },
    ].map((item) => prisma.serviceCatalogItem.create({ data: item }))
  );

  return { bays, catalog };
}

async function seedStaffUsers() {
  // Real inboxes (not @ikinamba.rw placeholders) so notification/OTP emails actually land
  // somewhere checkable during the thesis defense. mustChangePassword: false -- these are
  // the documented defense-day credentials, not first-time temp passwords.
  const staff = [
    { email: "josiaszacharie@gmail.com", role: "ADMIN" },
    { email: "vianew440@gmail.com", role: "MANAGER" },
    { email: "blackhathackers2022@gmail.com", role: "CASHIER" },
    { email: "bikomeye9@gmail.com", role: "RECEPTIONIST" },
    { email: "sindnepom@gmail.com", role: "TECHNICIAN" },
    { email: "junique1jay@gmail.com", role: "TECHNICIAN" },
  ];
  const passwordHash = await hashPassword("Passw0rd!");
  const created = await Promise.all(
    staff.map((u) => prisma.user.create({ data: { ...u, passwordHash, mustChangePassword: false } }))
  );
  return created;
}

type CustomerProfile = "LOYAL" | "OCCASIONAL" | "CHURNED" | "NEW";

/** Returns visit ages (days-ago) for a customer, shaped by their behavior profile, spread
 * across a full year so the AI model sees genuine seasonal/lifecycle variety instead of
 * everything clustering in the last 90 days. */
function visitScheduleFor(profile: CustomerProfile): number[] {
  switch (profile) {
    case "LOYAL":
      return Array.from({ length: randInt(8, 16) }, (_, i) => i * randInt(10, 18) + randInt(0, 4)).filter((d) => d <= 365);
    case "OCCASIONAL":
      return Array.from({ length: randInt(3, 6) }, (_, i) => i * randInt(35, 60) + randInt(0, 8)).filter((d) => d <= 365);
    case "CHURNED": {
      // Most recent visit is well past the 45-day churn window used in training, spread
      // anywhere across the year so churn isn't artificially clustered at one recency.
      const mostRecent = randInt(50, 280);
      const count = randInt(2, 5);
      return Array.from({ length: count }, (_, i) => mostRecent + i * randInt(12, 25)).filter((d) => d <= 365);
    }
    case "NEW":
      return Array.from({ length: randInt(1, 2) }, (_, i) => randInt(0, 20) + i * 6);
  }
}

interface GeneratedData {
  customers: any[];
  vehicles: any[];
  queueEntries: any[];
  serviceJobs: any[];
  serviceJobItems: any[];
  invoices: any[];
  invoiceItems: any[];
  payments: any[];
  loyaltyTransactions: any[];
  maintenanceInspections: any[];
}

const CUSTOMER_COUNT = 2500;

/** Builds every row in memory first (pure JS, no DB I/O) so referential IDs are known up
 * front, then the caller bulk-inserts each table with createMany -- createMany doesn't
 * support nested writes or return generated IDs, so this is the standard trick for seeding
 * a large relational graph quickly instead of thousands of sequential awaited .create() calls. */
function generateCustomersAndHistory(
  catalog: { id: string; name: string; category: string; basePrice: number }[],
  technicianIds: string[]
): GeneratedData {
  const profiles: CustomerProfile[] = ["LOYAL", "OCCASIONAL", "CHURNED", "NEW"];
  const maintenanceItems = catalog.filter((c) => c.category === "MAINTENANCE");
  const nonMaintenanceItems = catalog.filter((c) => c.category !== "MAINTENANCE");

  const data: GeneratedData = {
    customers: [], vehicles: [], queueEntries: [], serviceJobs: [], serviceJobItems: [],
    invoices: [], invoiceItems: [], payments: [], loyaltyTransactions: [], maintenanceInspections: [],
  };

  let plateCounter = 0;
  const nextPlate = () => {
    plateCounter += 1;
    const letter = String.fromCharCode(65 + (plateCounter % 26));
    return `RA${String(100 + plateCounter).padStart(3, "0")}${letter}`;
  };

  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const profile = profiles[i % profiles.length];
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const phone = `07${randInt(2, 9)}${randInt(1000000, 9999999)}`;
    const customerId = randomUUID();

    const vehicleCount = Math.random() > 0.7 ? 2 : 1;
    const vehicleIds: string[] = [];
    for (let v = 0; v < vehicleCount; v++) {
      const [make, model] = pick(MAKES);
      const vehicleId = randomUUID();
      vehicleIds.push(vehicleId);
      data.vehicles.push({
        id: vehicleId,
        customerId,
        make,
        model,
        year: randInt(2008, 2023),
        plate: nextPlate(),
        color: pick(["White", "Black", "Silver", "Blue", "Red"]),
      });
    }

    const visitAges = visitScheduleFor(profile);
    let totalSpend = 0;
    let mileageByVehicle: Record<string, number> = {};
    vehicleIds.forEach((id) => (mileageByVehicle[id] = randInt(15000, 90000)));
    const lastInspectionDayByVehicle: Record<string, number> = {};

    for (const ageDays of visitAges.sort((a, b) => b - a)) {
      const vehicleId = pick(vehicleIds);
      const checkedInAt = daysAgoAtBusinessHour(ageDays);
      const startedAt = new Date(checkedInAt.getTime() + randInt(5, 20) * 60_000);
      const completedAt = new Date(startedAt.getTime() + randInt(20, 90) * 60_000);

      const items = [pick(nonMaintenanceItems), ...(Math.random() > 0.6 ? [pick(nonMaintenanceItems)] : [])];
      const isMaintenanceVisit = Math.random() > 0.5 && maintenanceItems.length > 0;
      if (isMaintenanceVisit) items.push(pick(maintenanceItems));

      const queueEntryId = randomUUID();
      data.queueEntries.push({
        id: queueEntryId,
        customerId,
        vehicleId,
        status: "COMPLETED",
        createdVia: Math.random() > 0.3 ? "WALK_IN" : "APPOINTMENT",
        priority: 0,
        trackingToken: randomUUID(),
        checkedInAt,
        startedAt,
        completedAt,
      });

      const serviceJobId = randomUUID();
      data.serviceJobs.push({
        id: serviceJobId,
        queueEntryId,
        technicianId: pick(technicianIds),
        qcSignedById: pick(technicianIds),
        qcSignedAt: completedAt,
      });
      for (const it of items) {
        data.serviceJobItems.push({ id: randomUUID(), serviceJobId, catalogItemId: it.id, name: it.name, price: it.basePrice, qty: 1 });
      }

      const subtotal = items.reduce((s, it) => s + it.basePrice, 0);
      totalSpend += subtotal;

      const invoiceId = randomUUID();
      data.invoices.push({
        id: invoiceId,
        queueEntryId,
        customerId,
        subtotal,
        total: subtotal,
        status: "PAID",
        createdAt: completedAt,
      });
      for (const it of items) {
        data.invoiceItems.push({ id: randomUUID(), invoiceId, description: it.name, price: it.basePrice, qty: 1 });
      }
      data.payments.push({
        id: randomUUID(), invoiceId, method: pick(["CASH", "MOMO", "AIRTEL", "CARD"]), amount: subtotal, createdAt: completedAt,
      });

      const earned = pointsEarnedFor(subtotal);
      data.loyaltyTransactions.push({
        id: randomUUID(), customerId, points: earned, type: "EARN", reason: `Invoice ${invoiceId}`, createdAt: completedAt,
      });

      if (isMaintenanceVisit && ageDays !== lastInspectionDayByVehicle[vehicleId]) {
        mileageByVehicle[vehicleId] += randInt(800, 3000);
        data.maintenanceInspections.push({
          id: randomUUID(),
          vehicleId,
          queueEntryId,
          technicianId: pick(technicianIds),
          checklist: JSON.stringify([
            { item: "Engine oil", status: "OK" },
            { item: "Brake pads", status: Math.random() > 0.8 ? "ATTENTION" : "OK" },
            { item: "Tire pressure", status: "OK" },
          ]),
          dtcCodes: JSON.stringify(Math.random() > 0.85 ? ["P0420"] : []),
          mileage: mileageByVehicle[vehicleId],
          nextServiceDueAt: new Date(completedAt.getTime() + 90 * DAY_MS),
          createdAt: completedAt,
        });
        lastInspectionDayByVehicle[vehicleId] = ageDays;
      }
    }

    data.customers.push({
      id: customerId,
      name,
      phone,
      email: Math.random() > 0.15 ? `${name.toLowerCase().replace(/\s+/g, ".")}${i}@example.com` : null,
      preferredContact: pick(["PHONE", "EMAIL", "SMS"]),
      totalSpend,
      loyaltyTier: tierForSpend(totalSpend),
      loyaltyPoints: pointsEarnedFor(totalSpend),
    });
  }

  return data;
}

async function bulkInsertAll(data: GeneratedData) {
  await bulkInsert("Customers", data.customers, (batch) => prisma.customer.createMany({ data: batch }));
  await bulkInsert("Vehicles", data.vehicles, (batch) => prisma.vehicle.createMany({ data: batch }));
  await bulkInsert("Queue entries", data.queueEntries, (batch) => prisma.queueEntry.createMany({ data: batch }));
  await bulkInsert("Service jobs", data.serviceJobs, (batch) => prisma.serviceJob.createMany({ data: batch }));
  await bulkInsert("Service job items", data.serviceJobItems, (batch) => prisma.serviceJobItem.createMany({ data: batch }));
  await bulkInsert("Invoices", data.invoices, (batch) => prisma.invoice.createMany({ data: batch }));
  await bulkInsert("Invoice items", data.invoiceItems, (batch) => prisma.invoiceItem.createMany({ data: batch }));
  await bulkInsert("Payments", data.payments, (batch) => prisma.payment.createMany({ data: batch }));
  await bulkInsert("Loyalty transactions", data.loyaltyTransactions, (batch) => prisma.loyaltyTransaction.createMany({ data: batch }));
  await bulkInsert("Maintenance inspections", data.maintenanceInspections, (batch) => prisma.maintenanceInspection.createMany({ data: batch }));
}

const NOTIFICATION_TEMPLATES = [
  { template: "BOOKING_CONFIRMATION", subject: "Your booking is confirmed" },
  { template: "SERVICE_READY", subject: "Your vehicle is ready for pickup" },
  { template: "PROMO", subject: "This month's offer for you" },
];

function generateNotificationLogs(customerIds: string[]): any[] {
  const rows: any[] = [];
  for (let i = 0; i < 3000; i++) {
    const t = pick(NOTIFICATION_TEMPLATES);
    rows.push({
      id: randomUUID(),
      customerId: pick(customerIds),
      channel: "EMAIL",
      template: t.template,
      subject: t.subject,
      body: `<p>Dear customer,</p><p>${t.subject}.</p><p>Thank you for choosing New Class Car Wash.</p>`,
      status: Math.random() > 0.05 ? "SENT" : "FAILED",
      createdAt: daysAgoAtBusinessHour(randInt(0, 365)),
    });
  }
  return rows;
}

function generateAuditLogs(staffIds: string[]): any[] {
  const actions = ["LOGIN", "LOGOUT", "PAYMENT", "CHECK_IN", "QC_SIGN_OFF", "ADJUST_STOCK", "CREATE"];
  const rows: any[] = [];
  for (let i = 0; i < 500; i++) {
    rows.push({
      id: randomUUID(),
      userId: pick(staffIds),
      action: pick(actions),
      entity: "User",
      createdAt: daysAgoAtBusinessHour(randInt(0, 180)),
    });
  }
  return rows;
}

async function seedInventoryAndSuppliers() {
  const supplier = await prisma.supplier.create({ data: { name: "Kigali Auto Supplies Ltd", email: "sales@kigaliautosupplies.rw", phone: "0788123456" } });

  await Promise.all(
    [
      { name: "Car Shampoo", unit: "liters", category: "CHEMICAL", stockLevel: 8, reorderThreshold: 15, costPerUnit: 4500 },
      { name: "Carnauba Wax", unit: "kg", category: "CHEMICAL", stockLevel: 25, reorderThreshold: 10, costPerUnit: 9000 },
      { name: "Engine Oil (5W-30)", unit: "liters", category: "PART", stockLevel: 40, reorderThreshold: 20, costPerUnit: 7000 },
      { name: "Oil Filters", unit: "units", category: "PART", stockLevel: 6, reorderThreshold: 10, costPerUnit: 5000 },
      { name: "Microfiber Cloths", unit: "units", category: "CONSUMABLE", stockLevel: 80, reorderThreshold: 30, costPerUnit: 1500 },
      { name: "Tire Shine Spray", unit: "liters", category: "CHEMICAL", stockLevel: 12, reorderThreshold: 8, costPerUnit: 6000 },
    ].map((item) => prisma.inventoryItem.create({ data: item as any }))
  );

  return supplier;
}

async function main() {
  console.log("Resetting database...");
  await resetDatabase();

  console.log("Seeding bays + service catalog...");
  const { catalog } = await seedBaysAndCatalog();

  console.log("Seeding staff users...");
  const staff = await seedStaffUsers();
  const technicianIds = staff.filter((u) => u.role === "TECHNICIAN").map((u) => u.id);
  const staffIds = staff.map((u) => u.id);

  console.log(`Generating ${CUSTOMER_COUNT} customers + a year of service history in memory...`);
  const data = generateCustomersAndHistory(catalog, technicianIds);

  console.log("Bulk-inserting customers + service history...");
  await bulkInsertAll(data);

  console.log("Bulk-inserting notification log + audit log history...");
  await bulkInsert("Notification logs", generateNotificationLogs(data.customers.map((c) => c.id)), (batch) => prisma.notificationLog.createMany({ data: batch }));
  await bulkInsert("Audit logs", generateAuditLogs(staffIds), (batch) => prisma.auditLog.createMany({ data: batch }));

  console.log("Seeding inventory + suppliers...");
  await seedInventoryAndSuppliers();

  console.log("Training AI models (churn-risk + predictive maintenance)...");
  await trainAllModels();

  console.log(`Computing initial customer insights for ${CUSTOMER_COUNT} customers (this iterates per-customer -- expect a few minutes at this scale)...`);
  await recomputeCustomerInsights();

  console.log("\nSeed complete. Staff login (password: Passw0rd!):");
  staff.forEach((u) => console.log(`  ${u.email} (${u.role})`));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
