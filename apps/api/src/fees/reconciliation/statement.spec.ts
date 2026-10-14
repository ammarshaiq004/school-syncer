import { localTime, reconcileAt, reconcileSlot } from './reconciliation.scheduler.js';
import { parseStatement, statementAmount, statementColumns, statementDate } from './statement.js';

describe('statement columns', () => {
  it('finds the columns each portal uses', () => {
    expect(statementColumns(['Sr.', 'Order Ref Num', 'Transaction ID', 'Amount (Rs)', 'Transaction Date Time', 'Transaction Status'])).toEqual({
      reference: 1,
      providerRef: 2,
      amount: 3,
      date: 4,
      status: 5,
    });
    expect(statementColumns(['pp_TxnRefNo', 'pp_RetreivalReferenceNo', 'Txn Amount', 'Txn Date'])).toMatchObject({ reference: 0, providerRef: 1 });
    expect(statementColumns(['Consumer No', 'Tran Auth ID', 'Amount Paid', 'Paid On'])).toEqual({ reference: 0, providerRef: 1, amount: 2, date: 3 });
  });
});

describe('statement values', () => {
  it('reads amounts in rupees', () => {
    expect(statementAmount('Rs. 1,500.00')).toBe(1500);
    expect(statementAmount('4500')).toBe(4500);
    expect(statementAmount('PKR 2,000.5')).toBe(2001);
    expect(statementAmount('-')).toBeNull();
    expect(statementAmount('')).toBeNull();
  });

  it('reads dates day first', () => {
    expect(statementDate('2026-10-05 18:20:11')).toBe('2026-10-05');
    expect(statementDate('05/10/2026')).toBe('2026-10-05');
    expect(statementDate('5-10-26 09:00 PM')).toBe('2026-10-05');
    expect(statementDate('20261005143000')).toBe('2026-10-05');
    expect(statementDate('05-Oct-2026')).toBe('2026-10-05');
    expect(statementDate('Oct 5, 2026 2:30 PM')).toBe('2026-10-05');
    expect(statementDate('31/02/2026')).toBeNull();
    expect(statementDate('yesterday')).toBeNull();
  });
});

describe('parseStatement', () => {
  it('starts at the first non-empty row', () => {
    const parsed = parseStatement([
      [],
      ['Txn Ref No', 'Amount', 'Date', 'Status'],
      ['T1', '4,500', '04/10/2026', 'Completed'],
      ["'T2", '3000', '05/10/2026', 'SUCCESS'],
      ['T3', '100', '05/10/2026', 'Failed'],
      ['T4', 'n/a', '05/10/2026', 'Completed'],
      ['', '', '', ''],
    ]);
    expect(parsed.rows).toEqual([
      { reference: 'T1', amount: 4500, date: '2026-10-04', providerRef: undefined },
      { reference: 'T2', amount: 3000, date: '2026-10-05', providerRef: undefined },
    ]);
    expect(parsed).toMatchObject({ skipped: 1, fromDate: '2026-10-04', toDate: '2026-10-05', errors: [{ row: 6, message: '"n/a" is not an amount' }] });
  });

  it('names the headers it found when a column is missing', () => {
    expect(() => parseStatement([['Name', 'Amount'], ['x', '1']])).toThrow(/order or transaction reference, date column. The headers in the file are: Name, Amount/);
    expect(() => parseStatement([[]])).toThrow('The file is empty.');
  });
});

describe('nightly schedule', () => {
  it('reads RECONCILE_AT', () => {
    expect(reconcileAt(undefined)).toBe('02:00');
    expect(reconcileAt('3:30')).toBe('03:30');
    expect(reconcileAt('OFF')).toBeNull();
    expect(reconcileAt('25:00')).toBe('02:00');
  });

  it('compares in school time', () => {
    expect(localTime(new Date('2026-10-05T21:15:00Z'))).toBe('02:15');
  });

  it('has one run slot per local day, due from the start time', () => {
    expect(reconcileSlot('02:00', new Date('2026-10-05T20:59:00Z'))).toBeNull();
    expect(reconcileSlot('02:00', new Date('2026-10-05T21:15:00Z'))).toBe('2026-10-06');
    expect(reconcileSlot('02:00', new Date('2026-10-06T18:00:00Z'))).toBe('2026-10-06');
  });
});
