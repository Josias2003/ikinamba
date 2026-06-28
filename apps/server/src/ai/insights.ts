import { prisma } from "../lib/prisma.js";
import { chatWithLocalAI } from "./ollamaClient.js";

/** Shared 7-day operational metrics used both for the dashboard narrative and for
 * grounding the chatbot's Money-scope answers -- one set of queries, two consumers. */
export async function getOperationalSnapshot() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [recentInvoices, queueEntries, bays, inventory, insights] = await Promise.all([
    prisma.invoice.findMany({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.queueEntry.findMany({ where: { checkedInAt: { gte: sevenDaysAgo } } }),
    prisma.bay.findMany(),
    prisma.inventoryItem.findMany(),
    prisma.customerInsight.findMany({ where: { churnRiskLabel: "HIGH" }, include: { customer: true } }),
  ]);

  const revenue = recentInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const lowStock = inventory.filter((i) => i.stockLevel <= i.reorderThreshold);

  const byHour: Record<number, number> = {};
  for (const entry of queueEntries) {
    const hour = entry.checkedInAt.getHours();
    byHour[hour] = (byHour[hour] || 0) + 1;
  }
  const peakHour = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    revenue,
    vehiclesServiced: queueEntries.length,
    bayCount: bays.length,
    peakHour: peakHour ? Number(peakHour) : null,
    lowStock,
    highChurnCustomers: insights.map((i) => i.customer.name),
  };
}

/** Gathers real operational metrics and asks the local model to narrate them into a
 * plain-language summary + recommendations for the manager dashboard. */
export async function generateDashboardInsights() {
  const snap = await getOperationalSnapshot();

  const metricsSummary = `
Last 7 days:
- Revenue: RWF ${snap.revenue.toLocaleString()}
- Vehicles serviced: ${snap.vehiclesServiced}
- Bays: ${snap.bayCount} total
- Peak check-in hour: ${snap.peakHour !== null ? `${snap.peakHour}:00` : "not enough data"}
- Low-stock inventory items: ${snap.lowStock.map((i) => i.name).join(", ") || "none"}
- Customers flagged HIGH churn risk: ${snap.highChurnCustomers.length} (${snap.highChurnCustomers.slice(0, 5).join(", ")})
`.trim();

  const reply = await chatWithLocalAI([
    {
      role: "system",
      content:
        "You are an operations analyst for IKINAMBA, a car wash and vehicle service management system. " +
        "Given real metrics, write a concise (4-6 sentence) plain-language summary for a busy manager, " +
        "followed by 2-3 short bullet-point recommendations. Be specific and reference the numbers given. Do not invent numbers not given to you. " +
        "Output plain text only -- no markdown, no asterisks, no bold/headers. For the recommendations, start each line with a plain number like '1.' on its own line.",
    },
    { role: "user", content: metricsSummary },
  ]);

  return { metricsSummary, narrative: reply.content };
}
