/** The YYYY-MM months from the month of `from` to the month of `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/** Admissions and withdrawals per month; each date is a YYYY-MM-DD day. */
export function admissionsByMonth(admitted: string[], withdrawn: string[], from: string, to: string) {
  const rows = new Map(monthsBetween(from, to).map((month) => [month, { month, admitted: 0, withdrawn: 0, net: 0 }]));
  for (const [days, field, step] of [[admitted, 'admitted', 1], [withdrawn, 'withdrawn', -1]] as const) {
    for (const d of days) {
      const row = rows.get(d.slice(0, 7));
      if (!row) continue;
      row[field] += 1;
      row.net += step;
    }
  }
  return [...rows.values()];
}
