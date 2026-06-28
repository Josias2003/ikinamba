// Loyalty economics, centralized so billing/reporting/seed all agree on the same numbers.
export const POINTS_PER_RWF_SPENT = 1 / 1000; // 1 point per RWF 1,000 spent
export const RWF_VALUE_PER_POINT = 100; // redeeming 1 point knocks RWF 100 off an invoice

export const TIER_THRESHOLDS = { GOLD: 500_000, SILVER: 150_000 } as const;

export function tierForSpend(totalSpend: number): "BRONZE" | "SILVER" | "GOLD" {
  if (totalSpend >= TIER_THRESHOLDS.GOLD) return "GOLD";
  if (totalSpend >= TIER_THRESHOLDS.SILVER) return "SILVER";
  return "BRONZE";
}

export const pointsEarnedFor = (amountSpent: number) => Math.floor(amountSpent * POINTS_PER_RWF_SPENT);
export const rwfValueOfPoints = (points: number) => points * RWF_VALUE_PER_POINT;
