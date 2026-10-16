/** A bill as the ledger sees it. Void bills are left out before allocating. */
export interface LedgerInvoice {
  id: string;
  amount: number;
  dueDate: Date;
  number: string;
}

/** A recorded (not void) payment. */
export interface LedgerPayment {
  id: string;
  amount: number;
  receivedOn: Date;
  createdAt: Date;
  method: string;
  reference: string | null;
}

export interface Allocation {
  paymentId: string;
  invoiceId: string;
  amount: number;
}

export interface InvoiceSettlement {
  amountPaid: number;
  /** Set when the bill is paid in full: the payment that finished it. */
  settledBy: LedgerPayment | null;
}

export interface LedgerResult {
  allocations: Allocation[];
  invoices: Map<string, InvoiceSettlement>;
  /** Paid but not yet owed: carried to the next bill. */
  credit: number;
  /** Owed on bills, after payments. */
  outstanding: number;
}

/**
 * Applies a school's payments to its bills, oldest bill first, in the order
 * the money arrived. Rebuilt from scratch after every change (a new payment,
 * a voided payment or bill), so the result never depends on history.
 */
export function allocate(
  invoices: readonly LedgerInvoice[],
  payments: readonly LedgerPayment[],
): LedgerResult {
  const bills = [...invoices].sort(
    (a, b) => +a.dueDate - +b.dueDate || a.number.localeCompare(b.number),
  );
  const money = [...payments].sort(
    (a, b) => +a.receivedOn - +b.receivedOn || +a.createdAt - +b.createdAt,
  );
  const settled = new Map<string, InvoiceSettlement>(
    bills.map((b) => [b.id, { amountPaid: 0, settledBy: null }]),
  );
  const allocations: Allocation[] = [];
  let i = 0;
  for (const p of money) {
    let left = p.amount;
    while (left > 0 && i < bills.length) {
      const bill = bills[i];
      const s = settled.get(bill.id)!;
      const take = Math.min(left, bill.amount - s.amountPaid);
      if (take > 0) {
        allocations.push({ paymentId: p.id, invoiceId: bill.id, amount: take });
        s.amountPaid += take;
        left -= take;
      }
      if (s.amountPaid >= bill.amount) {
        s.settledBy = p;
        i += 1;
      }
    }
  }
  const paid = money.reduce((sum, p) => sum + p.amount, 0);
  const billed = bills.reduce((sum, b) => sum + b.amount, 0);
  const applied = allocations.reduce((sum, a) => sum + a.amount, 0);
  return {
    allocations,
    invoices: settled,
    credit: paid - applied,
    outstanding: billed - applied,
  };
}

/** Sales tax inside a bill: base plus tax at `percent`, rounded to the rupee. */
export function withTax(base: number, percent: number | null | undefined) {
  const taxPercent = percent && percent > 0 ? percent : 0;
  const taxAmount = Math.round((base * taxPercent) / 100);
  return { amount: base + taxAmount, taxPercent, taxAmount };
}
