/**
 * Parallel-run reports (SCHOOL-150): shapes of /reports/parallel-run/* and the
 * rows each table and Excel download shows, so the school can tick them off
 * against its old registers.
 */

export interface FeeTotals {
  from: string;
  to: string;
  total: number;
  receipts: number;
  methods: string[];
  byDay: { date: string; total: number; receipts: number; byMethod: Record<string, number> }[];
  byMethod: { name: string; total: number; receipts: number }[];
  byHead: { key: string; name: string; total: number }[];
}

export interface VoucherTally {
  name: string;
  issued: number;
  billed: number;
  paid: number;
  partial: number;
  unpaid: number;
  carried: number;
  collected: number;
  outstanding: number;
}

export interface VoucherTotals {
  from: string;
  to: string;
  totals: VoucherTally;
  voided: number;
  byClass: VoucherTally[];
  byPeriod: VoucherTally[];
}

export interface Cell {
  present: number;
  marked: number;
  percent: number;
}

export interface AttendanceGrid {
  from: string;
  to: string;
  dates: string[];
  sections: { sectionId: string; name: string; cells: Record<string, Cell>; days: number; present: number; marked: number; percent: number }[];
  byDate: { date: string; sections: number; present: number; marked: number; percent: number }[];
  present: number;
  marked: number;
  percent: number;
}

type Row = (string | number)[];

/** CASH -> Cash, BANK_TRANSFER -> Bank transfer. */
export const methodLabel = (m: string) => m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, " ");

/** Fees per day: date, receipts, one column per method, then the day's total; a totals row last. */
export function feeDayTable(r: FeeTotals): { header: string[]; rows: Row[] } {
  const header = ["Date", "Receipts", ...r.methods.map(methodLabel), "Total"];
  const rows: Row[] = r.byDay.map((d) => [d.date, d.receipts, ...r.methods.map((m) => d.byMethod[m] ?? 0), d.total]);
  rows.push(["Total", r.receipts, ...r.methods.map((m) => r.byMethod.find((x) => x.name === m)?.total ?? 0), r.total]);
  return { header, rows };
}

const TALLY_HEADER = ["Issued", "Billed", "Paid in full", "Part paid", "Unpaid", "Carried forward", "Collected", "Outstanding"];
const tallyCells = (t: VoucherTally): Row => [t.issued, t.billed, t.paid, t.partial, t.unpaid, t.carried, t.collected, t.outstanding];

/** Vouchers issued against paid, one row per class (or month) and a totals row. */
export function voucherTable(groups: VoucherTally[], totals: VoucherTally, first: string): { header: string[]; rows: Row[] } {
  return { header: [first, ...TALLY_HEADER], rows: [...groups.map((g) => [g.name, ...tallyCells(g)]), ["Total", ...tallyCells(totals)]] };
}

/** A cell as the register shows it: "18/20" present of marked, or blank when not marked. */
export const cellText = (c: Cell | undefined) => (c ? `${c.present}/${c.marked}` : "");

/**
 * Attendance with one row per section and one column per day ("present/marked"),
 * then the section's days marked and percent present; the last row is each day's total.
 */
export function attendanceTable(r: AttendanceGrid): { header: string[]; rows: Row[] } {
  const header = ["Section", ...r.dates, "Days marked", "% present"];
  const rows: Row[] = r.sections.map((s) => [s.name, ...r.dates.map((d) => cellText(s.cells[d])), s.days, s.percent]);
  rows.push([
    "All sections",
    ...r.byDate.map((d) => `${d.present}/${d.marked}`),
    r.dates.length,
    r.percent,
  ]);
  return { header, rows };
}
