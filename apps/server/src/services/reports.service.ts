import { prisma } from "../lib/prisma.js";

export async function getDashboardMetrics(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [invoices, queueEntries, jobItems, bays] = await Promise.all([
    prisma.invoice.findMany({ where: { createdAt: { gte: since }, status: { in: ["PAID", "PARTIALLY_PAID"] } } }),
    prisma.queueEntry.findMany({
      where: { checkedInAt: { gte: since } },
      include: { serviceJob: { include: { technician: true } } },
    }),
    prisma.serviceJobItem.findMany({
      where: { serviceJob: { queueEntry: { checkedInAt: { gte: since } } } },
      include: { catalogItem: true },
    }),
    prisma.bay.findMany(),
  ]);

  const revenueByDay: Record<string, number> = {};
  for (const inv of invoices) {
    const day = inv.createdAt.toISOString().slice(0, 10);
    revenueByDay[day] = (revenueByDay[day] || 0) + inv.total;
  }

  const popularityByService: Record<string, number> = {};
  for (const item of jobItems) {
    popularityByService[item.catalogItem.name] = (popularityByService[item.catalogItem.name] || 0) + item.qty;
  }

  const byHour: Record<number, number> = {};
  for (const entry of queueEntries) {
    const hour = entry.checkedInAt.getHours();
    byHour[hour] = (byHour[hour] || 0) + 1;
  }

  const staffCounts: Record<string, number> = {};
  for (const entry of queueEntries) {
    const tech = entry.serviceJob?.technician?.email;
    if (tech) staffCounts[tech] = (staffCounts[tech] || 0) + 1;
  }

  const completed = queueEntries.filter((e) => e.completedAt && e.startedAt);
  const avgServiceMinutes = completed.length
    ? completed.reduce((sum, e) => sum + (e.completedAt!.getTime() - e.startedAt!.getTime()) / 60_000, 0) / completed.length
    : 0;

  return {
    revenueByDay: Object.entries(revenueByDay).map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date)),
    servicePopularity: Object.entries(popularityByService).map(([name, count]) => ({ name, count })),
    peakHours: Object.entries(byHour).map(([hour, count]) => ({ hour: Number(hour), count })).sort((a, b) => a.hour - b.hour),
    staffProductivity: Object.entries(staffCounts).map(([email, count]) => ({ email, count })),
    bayCount: bays.length,
    vehiclesServiced: queueEntries.length,
    totalRevenue: invoices.reduce((s, i) => s + i.total, 0),
    avgServiceMinutes: Math.round(avgServiceMinutes),
  };
}

export async function getCustomerRetention() {
  const customers = await prisma.customer.findMany({ include: { queueEntries: { select: { checkedInAt: true } } } });
  const returning = customers.filter((c) => c.queueEntries.length > 1).length;
  const oneTime = customers.filter((c) => c.queueEntries.length === 1).length;
  return { returning, oneTime, total: customers.length };
}
