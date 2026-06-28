import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth.js";
import { trainAllModels } from "../src/ai/train.js";
import { recomputeCustomerInsights } from "../src/ai/scoring.js";
import { pointsEarnedFor, tierForSpend } from "../src/lib/loyalty.js";

const prisma = new PrismaClient();
const DAY_MS = 86_400_000;
const NOW = new Date();

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

const MAKES = [
  ["Toyota", "Corolla"], ["Toyota", "RAV4"], ["Toyota", "Hiace"], ["Suzuki", "Alto"],
  ["Nissan", "X-Trail"], ["Honda", "Civic"], ["Mitsubishi", "Pajero"], ["Hyundai", "Tucson"],
  ["Kia", "Sportage"], ["Volkswagen", "Golf"],
];
const FIRST_NAMES = ["Eric", "Aline", "Jean", "Claudine", "Patrick", "Diane", "Emmanuel", "Solange", "Olivier", "Vanessa", "Eric", "Marie", "Bosco", "Aimee", "David", "Grace", "Samuel", "Josiane", "Pacifique", "Nadia"];
const LAST_NAMES = ["Mugisha", "Uwase", "Niyonzima", "Ingabire", "Habimana", "Mukamana", "Bizimana", "Uwimana", "Nkurunziza", "Gasana"];

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
  const bays = await Promise.all(["Bay 1", "Bay 2", "Bay 3"].map((name) => prisma.bay.create({ data: { name } })));

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
  const staff = [
    { email: "admin@ikinamba.rw", role: "ADMIN" },
    { email: "manager@ikinamba.rw", role: "MANAGER" },
    { email: "cashier@ikinamba.rw", role: "CASHIER" },
    { email: "reception@ikinamba.rw", role: "RECEPTIONIST" },
    { email: "tech1@ikinamba.rw", role: "TECHNICIAN" },
    { email: "tech2@ikinamba.rw", role: "TECHNICIAN" },
  ];
  const passwordHash = await hashPassword("Passw0rd!");
  const created = await Promise.all(staff.map((u) => prisma.user.create({ data: { ...u, passwordHash } })));
  return created;
}

type CustomerProfile = "LOYAL" | "OCCASIONAL" | "CHURNED" | "NEW";

/** Returns visit ages (days-ago) for a customer, shaped by their behavior profile, so the
 * generated history has a genuine mix of churned/active customers for the AI model to learn from. */
function visitScheduleFor(profile: CustomerProfile): number[] {
  switch (profile) {
    case "LOYAL":
      return Array.from({ length: randInt(6, 10) }, (_, i) => i * randInt(8, 14) + randInt(0, 3)).filter((d) => d <= 90);
    case "OCCASIONAL":
      return Array.from({ length: randInt(3, 5) }, (_, i) => i * randInt(20, 35) + randInt(0, 5)).filter((d) => d <= 90);
    case "CHURNED": {
      // Most recent visit is 50-80 days ago -- solidly past the 45-day churn window used in
      // training, not just borderline -- then a couple earlier visits further back still.
      const mostRecent = randInt(50, 80);
      const count = randInt(2, 4);
      return Array.from({ length: count }, (_, i) => mostRecent + i * randInt(10, 18)).filter((d) => d <= 90);
    }
    case "NEW":
      return Array.from({ length: randInt(1, 2) }, (_, i) => randInt(0, 10) + i * 5);
  }
}

async function seedCustomersAndHistory(
  catalog: { id: string; name: string; category: string; basePrice: number }[],
  technicians: { id: string }[]
) {
  const profiles: CustomerProfile[] = ["LOYAL", "OCCASIONAL", "CHURNED", "NEW"];
  const maintenanceItems = catalog.filter((c) => c.category === "MAINTENANCE");
  const nonMaintenanceItems = catalog.filter((c) => c.category !== "MAINTENANCE");

  for (let i = 0; i < 40; i++) {
    const profile = profiles[i % profiles.length];
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const phone = `07${randInt(2, 9)}${randInt(1000000, 9999999)}`;

    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        email: Math.random() > 0.15 ? `${name.toLowerCase().replace(/\s+/g, ".")}${i}@example.com` : null,
        preferredContact: pick(["PHONE", "EMAIL", "SMS"]),
      },
    });

    const [make, model] = pick(MAKES);
    const vehicle = await prisma.vehicle.create({
      data: {
        customerId: customer.id,
        make,
        model,
        year: randInt(2008, 2023),
        plate: `RA${100 + i}${String.fromCharCode(65 + randInt(0, 25))}`,
        color: pick(["White", "Black", "Silver", "Blue", "Red"]),
      },
    });

    const visitAges = visitScheduleFor(profile);
    let totalSpend = 0;
    let mileage = randInt(15000, 90000);
    let lastInspectionDay = -1;

    for (const ageDays of visitAges.sort((a, b) => b - a)) {
      const checkedInAt = daysAgoAtBusinessHour(ageDays);
      const startedAt = new Date(checkedInAt.getTime() + randInt(5, 20) * 60_000);
      const completedAt = new Date(startedAt.getTime() + randInt(20, 90) * 60_000);

      const items = [pick(nonMaintenanceItems), ...(Math.random() > 0.6 ? [pick(nonMaintenanceItems)] : [])];
      const isMaintenanceVisit = Math.random() > 0.5 && maintenanceItems.length;
      if (isMaintenanceVisit) items.push(pick(maintenanceItems));

      const entry = await prisma.queueEntry.create({
        data: {
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: "COMPLETED",
          createdVia: Math.random() > 0.3 ? "WALK_IN" : "APPOINTMENT",
          priority: 0,
          trackingToken: `${customer.id}-${ageDays}-${Math.random().toString(36).slice(2, 8)}`,
          checkedInAt,
          startedAt,
          completedAt,
        },
      });

      await prisma.serviceJob.create({
        data: {
          queueEntryId: entry.id,
          technicianId: pick(technicians).id,
          qcSignedById: pick(technicians).id,
          qcSignedAt: completedAt,
          items: { create: items.map((it) => ({ catalogItemId: it.id, name: it.name, price: it.basePrice })) },
        },
      });

      const subtotal = items.reduce((s, it) => s + it.basePrice, 0);
      totalSpend += subtotal;

      const invoice = await prisma.invoice.create({
        data: {
          queueEntryId: entry.id,
          customerId: customer.id,
          subtotal,
          total: subtotal,
          status: "PAID",
          createdAt: completedAt,
          items: { create: items.map((it) => ({ description: it.name, price: it.basePrice })) },
          payments: { create: [{ method: pick(["CASH", "MOMO", "AIRTEL", "CARD"]), amount: subtotal, createdAt: completedAt }] },
        },
      });

      const earned = pointsEarnedFor(subtotal);
      await prisma.loyaltyTransaction.create({
        data: { customerId: customer.id, points: earned, type: "EARN", reason: `Invoice ${invoice.id}`, createdAt: completedAt },
      });

      if (isMaintenanceVisit && ageDays !== lastInspectionDay) {
        mileage += randInt(800, 3000);
        await prisma.maintenanceInspection.create({
          data: {
            vehicleId: vehicle.id,
            queueEntryId: entry.id,
            technicianId: pick(technicians).id,
            checklist: JSON.stringify([
              { item: "Engine oil", status: "OK" },
              { item: "Brake pads", status: Math.random() > 0.8 ? "ATTENTION" : "OK" },
              { item: "Tire pressure", status: "OK" },
            ]),
            dtcCodes: JSON.stringify(Math.random() > 0.85 ? ["P0420"] : []),
            mileage,
            nextServiceDueAt: new Date(completedAt.getTime() + 90 * DAY_MS),
            createdAt: completedAt,
          },
        });
        lastInspectionDay = ageDays;
      }
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: { totalSpend, loyaltyTier: tierForSpend(totalSpend), loyaltyPoints: pointsEarnedFor(totalSpend) },
    });
  }
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
  const technicians = staff.filter((u) => u.role === "TECHNICIAN");

  console.log("Seeding customers + 90 days of service history (for AI training)...");
  await seedCustomersAndHistory(catalog, technicians);

  console.log("Seeding inventory + suppliers...");
  await seedInventoryAndSuppliers();

  console.log("Training AI models (churn-risk + predictive maintenance)...");
  await trainAllModels();

  console.log("Computing initial customer insights...");
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
