export type Flow = 'IN' | 'OUT';

export interface CashMovement {
  date: string; // YYYY-MM-DD, local
  flow: Flow;
  amount: number;
  source: 'FEES' | 'SALARY' | 'ENTRY';
  description: string;
  method: string;
  reference?: string | null;
}

/** Movements in date order with a running balance from the opening balance. */
export function cashbook(opening: number, movements: CashMovement[]) {
  let balance = opening;
  const rows = [...movements]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.flow === b.flow ? 0 : a.flow === 'IN' ? -1 : 1))
    .map((m) => {
      balance += m.flow === 'IN' ? m.amount : -m.amount;
      return { ...m, balance };
    });
  const totalIn = movements.filter((m) => m.flow === 'IN').reduce((s, m) => s + m.amount, 0);
  const totalOut = movements.filter((m) => m.flow === 'OUT').reduce((s, m) => s + m.amount, 0);
  return { opening, totalIn, totalOut, closing: opening + totalIn - totalOut, rows };
}

/** Sums amounts by a key, largest first. */
export function totalsBy<T>(items: T[], key: (t: T) => string, amount: (t: T) => number) {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + amount(item));
  return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}
