import type { DiscountKind } from '@prisma/client';

export interface DiscountRule {
  id: string;
  name: string;
  kind: DiscountKind;
  value: number;
  schoolId: string | null;
  startsOn: Date;
  endsOn: Date | null;
}

/** Rupees off a bill before tax: a percent rounded down to the rupee, or a fixed amount, never more than the bill. */
export function discountAmount(rule: Pick<DiscountRule, 'kind' | 'value'>, subtotal: number): number {
  const off = rule.kind === 'PERCENT' ? Math.floor((subtotal * rule.value) / 100) : rule.value;
  return Math.max(0, Math.min(off, subtotal));
}

/**
 * The one discount a bill gets: of the active rules for this school that are
 * in their dates and not yet used by it, the one taking the most off (the
 * earliest on a tie). `today` is the local YYYY-MM-DD.
 */
export function pickDiscount(
  rules: readonly DiscountRule[],
  schoolId: string,
  today: string,
  used: ReadonlySet<string>,
  subtotal: number,
): { rule: DiscountRule; amount: number } | null {
  let best: { rule: DiscountRule; amount: number } | null = null;
  for (const rule of rules) {
    if ((rule.schoolId && rule.schoolId !== schoolId) || used.has(rule.id)) continue;
    if (rule.startsOn.toISOString().slice(0, 10) > today) continue;
    if (rule.endsOn && rule.endsOn.toISOString().slice(0, 10) < today) continue;
    const amount = discountAmount(rule, subtotal);
    if (amount > 0 && (!best || amount > best.amount)) best = { rule, amount };
  }
  return best;
}
