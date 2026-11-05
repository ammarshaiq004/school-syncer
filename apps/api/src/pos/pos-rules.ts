export interface QtyLine {
  itemId: string;
  qty: number;
}

/** The same product scanned twice becomes one line. */
export function mergeLines<T extends QtyLine>(lines: T[]): T[] {
  const byItem = new Map<string, T>();
  for (const l of lines) {
    const seen = byItem.get(l.itemId);
    byItem.set(l.itemId, seen ? { ...seen, qty: seen.qty + l.qty } : { ...l });
  }
  return [...byItem.values()];
}

/** Sale amounts in rupees; null when the discount is more than the goods are worth. */
export function saleTotals(
  lines: { qty: number; unitPrice: number }[],
  discount: number,
): { subtotal: number; total: number } | null {
  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  return discount > subtotal ? null : { subtotal, total: subtotal - discount };
}

/** "S-000012": the prefix, then the next number after `count` earlier ones. */
export const documentNumber = (prefix: string, count: number, width = 6) =>
  `${prefix}-${String(count + 1).padStart(width, '0')}`;

/** Stock after a change, or null when it would go below zero. */
export const stockAfter = (current: number, change: number): number | null =>
  current + change < 0 ? null : current + change;

/** Rupees still owed to a vendor, never below zero. */
export const owed = (total: number, paid: number) => Math.max(0, total - paid);

/** Sums `fields` of rows sharing a key, e.g. sales per day or per product. */
export function rollup<T, F extends string>(
  rows: T[],
  key: (row: T) => string,
  fields: Record<F, (row: T) => number>,
): ({ key: string } & Record<F, number>)[] {
  const out = new Map<string, { key: string } & Record<F, number>>();
  for (const row of rows) {
    const k = key(row);
    let acc = out.get(k);
    if (!acc) {
      acc = { key: k } as { key: string } & Record<F, number>;
      for (const f of Object.keys(fields) as F[]) (acc as Record<F, number>)[f] = 0;
      out.set(k, acc);
    }
    for (const f of Object.keys(fields) as F[]) (acc as Record<F, number>)[f] += fields[f](row);
  }
  return [...out.values()];
}
