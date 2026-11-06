import { totalsBy, type Flow } from './cashbook.js';

interface Row {
  date: string;
  flow: Flow;
  amount: number;
  source: string;
  method: string;
}

interface Book {
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  rows: Row[];
}

/** A day's closing sheet: what came in and went out, by payment method and by source. */
export function closingSummary(book: Book) {
  const split = (flow: Flow) => {
    const rows = book.rows.filter((r) => r.flow === flow);
    return {
      byMethod: totalsBy(rows, (r) => r.method, (r) => r.amount),
      bySource: totalsBy(rows, (r) => r.source, (r) => r.amount),
    };
  };
  return {
    opening: book.opening,
    totalIn: book.totalIn,
    totalOut: book.totalOut,
    closing: book.closing,
    in: split('IN'),
    out: split('OUT'),
  };
}

/** Each day from `from` to `to` with what came in and went out and the balance the day closed on. */
export function monthDays(book: Book, from: string, to: string) {
  const days: { date: string; in: number; out: number; closing: number }[] = [];
  let balance = book.opening;
  for (let d = from; d <= to; d = nextIso(d)) {
    let moneyIn = 0;
    let moneyOut = 0;
    for (const r of book.rows) {
      if (r.date !== d) continue;
      if (r.flow === 'IN') moneyIn += r.amount;
      else moneyOut += r.amount;
    }
    balance += moneyIn - moneyOut;
    days.push({ date: d, in: moneyIn, out: moneyOut, closing: balance });
  }
  return days;
}

function nextIso(iso: string) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The 12 months (YYYY-MM) starting at `start`. */
export function twelveMonths(start: string): string[] {
  const [y, m] = start.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7));
}

export interface Pnl {
  months: string[];
  income: { name: string; byMonth: number[]; total: number }[];
  expenses: { name: string; byMonth: number[]; total: number }[];
  netByMonth: number[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
}

/** A year's profit and loss, one column per month: fees plus other income against salaries and other expenses. */
export function buildPnl(
  months: string[],
  fees: { month: string; amount: number }[],
  entries: { month: string; kind: 'INCOME' | 'EXPENSE'; category: string; amount: number }[],
  salaries: { month: string; amount: number }[],
): Pnl {
  const table = (items: { name: string; month: string; amount: number }[]) => {
    const byName = new Map<string, number[]>();
    for (const i of items) {
      const at = months.indexOf(i.month);
      if (at < 0) continue;
      const row = byName.get(i.name) ?? months.map(() => 0);
      row[at] += i.amount;
      byName.set(i.name, row);
    }
    return [...byName.entries()]
      .map(([name, byMonth]) => ({ name, byMonth, total: byMonth.reduce((s, n) => s + n, 0) }))
      .filter((r) => r.total !== 0)
      .sort((a, b) => b.total - a.total);
  };
  const income = table([
    ...fees.map((f) => ({ name: 'Fees', month: f.month, amount: f.amount })),
    ...entries.filter((e) => e.kind === 'INCOME').map((e) => ({ name: e.category, month: e.month, amount: e.amount })),
  ]);
  const expenses = table([
    ...salaries.map((s) => ({ name: 'Salaries', month: s.month, amount: s.amount })),
    ...entries.filter((e) => e.kind === 'EXPENSE').map((e) => ({ name: e.category, month: e.month, amount: e.amount })),
  ]);
  const column = (rows: { byMonth: number[] }[], i: number) => rows.reduce((s, r) => s + r.byMonth[i], 0);
  const netByMonth = months.map((_, i) => column(income, i) - column(expenses, i));
  const totalIncome = income.reduce((s, r) => s + r.total, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.total, 0);
  return { months, income, expenses, netByMonth, totalIncome, totalExpenses, net: totalIncome - totalExpenses };
}

export interface UserMoney {
  userId: string | null;
  collected: number;
  receipts: number;
  otherIncome: number;
  expenses: number;
  salaries: number;
}

/** Per-user profit and loss from what each user collected and booked; money with no user is "System". */
export function userwise(
  payments: { userId: string | null; amount: number }[],
  entries: { userId: string | null; kind: 'INCOME' | 'EXPENSE'; amount: number }[],
  salaries: { userId: string | null; amount: number }[],
): (UserMoney & { net: number })[] {
  const users = new Map<string | null, UserMoney>();
  const of = (userId: string | null) => {
    const row = users.get(userId) ?? { userId, collected: 0, receipts: 0, otherIncome: 0, expenses: 0, salaries: 0 };
    users.set(userId, row);
    return row;
  };
  for (const p of payments) {
    const r = of(p.userId);
    r.collected += p.amount;
    r.receipts += 1;
  }
  for (const e of entries) {
    if (e.kind === 'INCOME') of(e.userId).otherIncome += e.amount;
    else of(e.userId).expenses += e.amount;
  }
  for (const s of salaries) of(s.userId).salaries += s.amount;
  return [...users.values()]
    .map((r) => ({ ...r, net: r.collected + r.otherIncome - r.expenses - r.salaries }))
    .sort((a, b) => b.collected + b.otherIncome - (a.collected + a.otherIncome));
}
