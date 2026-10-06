/**
 * Reading gateway statements: the transaction or settlement reports schools
 * download from the JazzCash, Easypaisa and 1LINK merchant portals. Each
 * portal names its columns differently, so columns are found by name.
 */

export interface StatementRow {
  /** School-local day, YYYY-MM-DD. */
  date: string;
  /** Our reference as the gateway shows it: order ref, pp_TxnRefNo or 1Bill consumer number. */
  reference: string;
  providerRef?: string;
  /** Whole rupees. */
  amount: number;
}

export interface ParsedStatement {
  rows: StatementRow[];
  /** Rows left out because their status says the money was not taken. */
  skipped: number;
  /** Rows that could not be read, with the sheet row number (1 = headers). */
  errors: { row: number; message: string }[];
  fromDate: string | null;
  toDate: string | null;
}

const COLUMNS = {
  reference: [
    'order ref', 'order ref num', 'order reference', 'order id', 'order no', 'orderrefnum', 'orderid',
    'txn ref', 'txn ref no', 'pp txnrefno', 'txnrefno', 'transaction reference', 'merchant reference', 'merchant ref',
    'consumer number', 'consumer no', 'bill reference', 'reference', 'reference no', 'ref no',
  ],
  providerRef: [
    'transaction id', 'txn id', 'transaction no', 'rrn', 'retrieval reference', 'retrieval reference no',
    'pp retreivalreferenceno', 'auth id', 'tran auth id', 'auth code', 'stan', 'trx id',
  ],
  amount: ['amount', 'transaction amount', 'txn amount', 'amount paid', 'paid amount', 'amount pkr', 'amount rs', 'gross amount'],
  date: [
    'date', 'transaction date', 'txn date', 'transaction date time', 'txn date time', 'date time', 'paid on',
    'payment date', 'paid date', 'tran date', 'created on', 'created at', 'settlement date',
  ],
  status: ['status', 'transaction status', 'txn status', 'payment status', 'response code', 'response description'],
} as const;

type Column = keyof typeof COLUMNS;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Status words and codes that mean the money was taken. Rows with no status column count as paid. */
const PAID_STATUS = /^(paid|success|successful|succeeded|completed|complete|settled|approved|captured|000|00|0000|121|p)$/;

/** Finds which column holds what. The first matching header wins. */
export function statementColumns(header: string[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  const names = header.map((h) => norm(String(h ?? '')));
  for (const col of Object.keys(COLUMNS) as Column[]) {
    const aliases = COLUMNS[col] as readonly string[];
    const i = names.findIndex((n, idx) => aliases.includes(n) && !Object.values(found).includes(idx));
    if (i >= 0) found[col] = i;
  }
  return found;
}

/** "Rs 1,500.00" -> 1500. Null when it is not an amount. */
export function statementAmount(text: string): number | null {
  const t = text.replace(/rs\.?|pkr|,|\s/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A statement date as YYYY-MM-DD. Pakistani portals write day first
 * (05/10/2026), so slashes and dashes are read as day/month/year.
 */
export function statementDate(text: string): string | null {
  const t = text.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (y: number, m: number, d: number) => {
    const at = new Date(Date.UTC(y, m - 1, d));
    return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})(\d{6})?$/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(t);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s,-]+(\d{4})\b/i.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    return month ? valid(+m[3], month, +m[1]) : null;
  }
  m = /^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    return month ? valid(+m[3], month, +m[2]) : null;
  }
  return null;
}

/**
 * Turns a statement grid (first non-empty row = headers) into the successful
 * transactions on it. Throws when the reference, amount or date column is
 * missing, naming the headers it did find.
 */
export function parseStatement(grid: string[][]): ParsedStatement {
  const start = grid.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (start < 0) throw new Error('The file is empty.');
  const header = grid[start].map((c) => String(c ?? ''));
  const cols = statementColumns(header);
  const missing = (['reference', 'amount', 'date'] as const).filter((c) => cols[c] === undefined);
  if (missing.length) {
    const label = { reference: 'order or transaction reference', amount: 'amount', date: 'date' };
    throw new Error(
      `Could not find the ${missing.map((c) => label[c]).join(', ')} column. The headers in the file are: ${header.filter(Boolean).join(', ') || 'none'}.`,
    );
  }
  const rows: StatementRow[] = [];
  const errors: ParsedStatement['errors'] = [];
  let skipped = 0;
  grid.slice(start + 1).forEach((cells, i) => {
    const cell = (c: Column) => (cols[c] === undefined ? '' : String(cells[cols[c]!] ?? '').trim());
    if (cells.every((c) => String(c ?? '').trim() === '')) return;
    const rowNo = start + i + 2;
    if (cols.status !== undefined && !PAID_STATUS.test(norm(cell('status')))) {
      skipped++;
      return;
    }
    const reference = cell('reference').replace(/^'/, '');
    const amount = statementAmount(cell('amount'));
    const date = statementDate(cell('date'));
    if (!reference) return void errors.push({ row: rowNo, message: 'No reference' });
    if (amount === null) return void errors.push({ row: rowNo, message: `"${cell('amount')}" is not an amount` });
    if (!date) return void errors.push({ row: rowNo, message: `"${cell('date')}" is not a date` });
    rows.push({ date, reference, providerRef: cell('providerRef').replace(/^'/, '') || undefined, amount });
  });
  const days = rows.map((r) => r.date).sort();
  return { rows, skipped, errors, fromDate: days[0] ?? null, toDate: days.at(-1) ?? null };
}
