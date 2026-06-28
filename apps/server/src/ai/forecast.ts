import { prisma } from "../lib/prisma.js";

const LOOKBACK_DAYS = 120;
const RECENCY_DECAY = 0.85; // each week further back counts for 0.85x as much

/** Day-of-week-keyed history of vehicle counts, most recent first within each weekday's list. */
async function getWeekdayHistory(asOf: Date): Promise<Record<number, number[]>> {
  const since = new Date(asOf.getTime() - LOOKBACK_DAYS * 86_400_000);
  const entries = await prisma.queueEntry.findMany({
    where: { checkedInAt: { gte: since, lt: asOf } },
    select: { checkedInAt: true },
  });

  const countByDay: Record<string, number> = {};
  for (const e of entries) {
    const day = e.checkedInAt.toISOString().slice(0, 10);
    countByDay[day] = (countByDay[day] || 0) + 1;
  }

  const byWeekday: Record<number, { date: string; count: number }[]> = {};
  for (const [day, count] of Object.entries(countByDay)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    (byWeekday[weekday] ??= []).push({ date: day, count });
  }
  for (const list of Object.values(byWeekday)) list.sort((a, b) => b.date.localeCompare(a.date));

  const result: Record<number, number[]> = {};
  for (const [weekday, list] of Object.entries(byWeekday)) result[Number(weekday)] = list.map((d) => d.count);
  return result;
}

/** Seasonal-naive forecast: for each upcoming date, average past occurrences of the same
 * weekday, weighting more recent weeks higher (0.85 per week back) so a recent shift in
 * volume shows up faster than a flat historical average would. Hand-rolled and fully
 * explainable -- no external forecasting library, consistent with the rest of ai/. */
export async function forecastExpectedVisits(daysAhead = 7) {
  const now = new Date();
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const history = await getWeekdayHistory(today);

  const forecast: { date: string; weekday: number; expectedVisits: number; sampleSize: number }[] = [];
  for (let i = 1; i <= daysAhead; i++) {
    const target = new Date(today.getTime() + i * 86_400_000);
    const weekday = target.getUTCDay();
    const samples = history[weekday] ?? [];

    let weightedSum = 0;
    let weightTotal = 0;
    samples.forEach((count, idx) => {
      const weight = RECENCY_DECAY ** idx; // idx 0 = most recent occurrence of this weekday
      weightedSum += count * weight;
      weightTotal += weight;
    });

    forecast.push({
      date: target.toISOString().slice(0, 10),
      weekday,
      expectedVisits: weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : 0,
      sampleSize: samples.length,
    });
  }
  return forecast;
}
