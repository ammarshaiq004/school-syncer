export interface PlanItem {
  /** YYYY-MM-DD */
  dueDate: string;
  amount: number;
}

export type InstallmentState = 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE';

/** The same day-of-month `n` months on, clamped to the month's last day (31 Jan + 1 = 28 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/** `total` split into `count` monthly instalments; the rupees that do not divide evenly go on the first ones. */
export function evenSplit(total: number, count: number, firstDue: string): PlanItem[] {
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return Array.from({ length: count }, (_, i) => ({
    dueDate: addMonths(firstDue, i),
    amount: base + (i < extra ? 1 : 0),
  }));
}

/** Why a plan cannot be used for a voucher of `total`, or null. */
export function planProblem(items: PlanItem[], total: number): string | null {
  if (items.length < 2) return 'A plan needs at least two instalments';
  if (items.length > 12) return 'A plan has at most 12 instalments';
  if (items.some((i) => i.amount <= 0)) return 'Every instalment must be more than zero';
  for (let i = 1; i < items.length; i++) {
    if (items[i].dueDate <= items[i - 1].dueDate) return 'Instalment dates must be in order, one after another';
  }
  const sum = items.reduce((s, i) => s + i.amount, 0);
  if (sum !== total) return `The instalments add up to Rs ${sum}, but the voucher is Rs ${total}`;
  return null;
}

export interface Allocated<T> {
  item: T;
  amount: number;
  paid: number;
  balance: number;
  status: InstallmentState;
}

/**
 * Spreads what a voucher has been paid over its instalments, earliest first.
 * Anything added to the voucher after the plan was made (a late fine) is owed
 * with the last instalment.
 */
export function allocate<T extends { amount: number; dueDate: string }>(
  items: T[],
  total: number,
  paid: number,
  today: string,
): Allocated<T>[] {
  const planned = items.reduce((s, i) => s + i.amount, 0);
  let left = paid;
  return items.map((item, i) => {
    const amount = item.amount + (i === items.length - 1 ? Math.max(0, total - planned) : 0);
    const got = Math.min(amount, left);
    left -= got;
    const balance = amount - got;
    const status: InstallmentState =
      balance === 0 ? 'PAID' : item.dueDate < today ? 'OVERDUE' : got > 0 ? 'PARTIAL' : 'UNPAID';
    return { item, amount, paid: got, balance, status };
  });
}
