import type { Decimal } from "@prisma/client/runtime/library";

function toNum(v: Decimal | number | string): number {
  return parseFloat(v.toString());
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Billing history rows define a new monthly rate effective from the first day of
 * `periodMonth` until superseded by a later row. Returns the rate that applies on `asOf`
 * (compared by calendar month).
 */
export function getEffectiveMonthlyBilling(
  baseBilling: number,
  history: { periodMonth: Date; monthlyBilling: Decimal | number | string }[],
  asOf: Date = new Date()
): number {
  const target = monthStart(asOf).getTime();
  let bestT = -Infinity;
  let bestAmount = baseBilling;
  for (const h of history) {
    const t = monthStart(new Date(h.periodMonth)).getTime();
    if (t <= target && t > bestT) {
      bestT = t;
      bestAmount = toNum(h.monthlyBilling);
    }
  }
  return bestAmount;
}
