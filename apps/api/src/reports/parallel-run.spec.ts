import {
  attendanceGrid,
  feeTotals,
  fill,
  percent,
  splitPayments,
  UNMATCHED,
  voucherBuckets,
  voucherTotals,
  type VoucherLine,
} from './parallel-run.js';

const line = (over: Partial<VoucherLine>): VoucherLine => ({
  feeHeadId: null,
  feeHeadName: null,
  description: 'Line',
  amount: 0,
  kind: 'FEE',
  ...over,
});

const tuition = line({ feeHeadId: 't', feeHeadName: 'Tuition', description: 'Tuition', amount: 5000 });
const computer = line({ feeHeadId: 'c', feeHeadName: 'Computer', description: 'Computer', amount: 1000 });

describe('voucherBuckets', () => {
  it('nets concessions into their head and orders arrears, heads, other charges, fine', () => {
    const buckets = voucherBuckets([
      line({ kind: 'LATE_FINE', description: 'Late fine', amount: 300 }),
      tuition,
      line({ feeHeadId: 't', description: 'Tuition concession', amount: -1000 }),
      line({ kind: 'ADJUSTMENT', description: 'Lab breakage', amount: 200 }),
      computer,
      line({ kind: 'ARREARS', description: 'Arrears from 2026-09', amount: 1500 }),
    ]);
    expect(buckets.map((b) => [b.key, b.name, b.amount])).toEqual([
      ['arrears', 'Arrears', 1500],
      ['head:t', 'Tuition', 4000],
      ['head:c', 'Computer', 1000],
      ['adjustments', 'Adjustments', 200],
      ['late-fine', 'Late fine', 300],
    ]);
  });

  it('takes a discount with no fee head off the last heads, and drops waived fines', () => {
    const buckets = voucherBuckets([
      tuition,
      computer,
      line({ kind: 'ADJUSTMENT', description: 'Goodwill discount', amount: -1500 }),
      line({ kind: 'LATE_FINE', amount: 200 }),
      line({ kind: 'LATE_FINE', amount: -200 }),
    ]);
    // 6000 billed less 1500: Computer is wiped out and Tuition loses 500.
    expect(buckets.map((b) => [b.key, b.amount])).toEqual([['head:t', 4500]]);
    expect(buckets.reduce((s, b) => s + b.amount, 0)).toBe(4500);
  });

  it('names a charge with no fee head by its description', () => {
    expect(voucherBuckets([line({ description: 'Library fine', amount: 50 })])).toEqual([
      { key: 'line:Library fine', name: 'Library fine', amount: 50 },
    ]);
  });
});

describe('fill and splitPayments', () => {
  const buckets = voucherBuckets([tuition, computer, line({ kind: 'ARREARS', amount: 500 })]);

  it('fills heads in order and keeps an overpayment apart', () => {
    expect(Object.fromEntries(fill(buckets, 2000))).toEqual({ arrears: 500, 'head:t': 1500 });
    expect(Object.fromEntries(fill(buckets, 7000))).toEqual({ arrears: 500, 'head:t': 5000, 'head:c': 1000, [UNMATCHED.key]: 500 });
    expect(fill(buckets, -10).size).toBe(0);
  });

  it('splits each payment where the one before left off, adding up to the voucher', () => {
    const splits = splitPayments(buckets, [
      { id: 'p1', amount: 2000 },
      { id: 'p2', amount: 3500 },
      { id: 'p3', amount: 1000 },
    ]);
    expect(Object.fromEntries(splits.get('p1')!)).toEqual({ arrears: 500, 'head:t': 1500 });
    expect(Object.fromEntries(splits.get('p2')!)).toEqual({ 'head:t': 3500 });
    expect(Object.fromEntries(splits.get('p3')!)).toEqual({ 'head:c': 1000 });
    const perHead = new Map<string, number>();
    for (const split of splits.values()) for (const [k, v] of split) perHead.set(k, (perHead.get(k) ?? 0) + v);
    expect(Object.fromEntries(perHead)).toEqual({ arrears: 500, 'head:t': 5000, 'head:c': 1000 });
  });
});

describe('feeTotals', () => {
  it('adds payments up per day and method, per method and per head', () => {
    const names = new Map([
      ['head:t', 'Tuition'],
      ['head:c', 'Computer'],
    ]);
    const totals = feeTotals(
      [
        { date: '2026-10-02', method: 'CASH', amount: 5000, heads: new Map([['head:t', 5000]]) },
        { date: '2026-10-01', method: 'BANK', amount: 6000, heads: new Map([['head:t', 5000], ['head:c', 1000]]) },
        { date: '2026-10-02', method: 'BANK', amount: 1000, heads: new Map([['head:c', 1000]]) },
        { date: '2026-10-02', method: 'CASH', amount: 250, heads: new Map([['late-fine', 250]]) },
      ],
      names,
    );
    expect(totals.total).toBe(12250);
    expect(totals.receipts).toBe(4);
    expect(totals.methods).toEqual(['BANK', 'CASH']);
    expect(totals.byDay).toEqual([
      { date: '2026-10-01', total: 6000, receipts: 1, byMethod: { BANK: 6000 } },
      { date: '2026-10-02', total: 6250, receipts: 3, byMethod: { CASH: 5250, BANK: 1000 } },
    ]);
    expect(totals.byMethod).toEqual([
      { name: 'BANK', total: 7000, receipts: 2 },
      { name: 'CASH', total: 5250, receipts: 2 },
    ]);
    expect(totals.byHead).toEqual([
      { key: 'head:t', name: 'Tuition', total: 10000 },
      { key: 'head:c', name: 'Computer', total: 2000 },
      { key: 'late-fine', name: 'late-fine', total: 250 },
    ]);
    // Every view adds up to the same total.
    expect(totals.byDay.reduce((s, d) => s + d.total, 0)).toBe(totals.total);
    expect(totals.byHead.reduce((s, d) => s + d.total, 0)).toBe(totals.total);
  });

  it('is all zeroes with nothing collected', () => {
    expect(feeTotals([], new Map())).toEqual({ total: 0, receipts: 0, methods: [], byDay: [], byMethod: [], byHead: [] });
  });
});

describe('voucherTotals', () => {
  it('counts issued against paid by class and month, leaving voided vouchers out', () => {
    const r = voucherTotals([
      { status: 'PAID', total: 5000, paid: 5000, className: 'Grade 2 A', period: '2026-10' },
      { status: 'PARTIAL', total: 5000, paid: 2000, className: 'Grade 10 A', period: '2026-10' },
      { status: 'UNPAID', total: 4000, paid: 0, className: 'Grade 2 A', period: '2026-10' },
      { status: 'CARRIED_FORWARD', total: 4000, paid: 1000, className: 'Grade 2 A', period: '2026-09' },
      { status: 'CANCELLED', total: 4000, paid: 0, className: 'Grade 2 A', period: '2026-10' },
    ]);
    expect(r.voided).toBe(1);
    expect(r.totals).toMatchObject({ issued: 4, billed: 18000, paid: 1, partial: 1, unpaid: 1, carried: 1, collected: 8000, outstanding: 7000 });
    expect(r.byClass.map((c) => c.name)).toEqual(['Grade 2 A', 'Grade 10 A']);
    expect(r.byClass[0]).toMatchObject({ issued: 3, billed: 13000, collected: 6000, outstanding: 4000 });
    expect(r.byPeriod.map((p) => [p.name, p.issued])).toEqual([
      ['2026-09', 1],
      ['2026-10', 3],
    ]);
  });
});

describe('attendanceGrid', () => {
  it('gives each section-day cell, section and day its share present', () => {
    const g = attendanceGrid([
      { sectionId: 'b', name: 'Grade 2 A', sort: 2, date: '2026-10-02', present: 18, marked: 20 },
      { sectionId: 'a', name: 'Grade 1 A', sort: 1, date: '2026-10-01', present: 9, marked: 10 },
      { sectionId: 'a', name: 'Grade 1 A', sort: 1, date: '2026-10-02', present: 10, marked: 10 },
      { sectionId: 'c', name: 'Grade 3 A', sort: 3, date: '2026-10-02', present: 0, marked: 0 },
    ]);
    expect(g.dates).toEqual(['2026-10-01', '2026-10-02']);
    expect(g.sections.map((s) => [s.name, s.days, s.percent])).toEqual([
      ['Grade 1 A', 2, 95],
      ['Grade 2 A', 1, 90],
      ['Grade 3 A', 1, 0],
    ]);
    expect(g.sections[0].cells['2026-10-01']).toEqual({ present: 9, marked: 10, percent: 90 });
    expect(g.byDate).toEqual([
      { date: '2026-10-01', sections: 1, present: 9, marked: 10, percent: 90 },
      { date: '2026-10-02', sections: 3, present: 28, marked: 30, percent: 93.3 },
    ]);
    expect([g.present, g.marked, g.percent]).toEqual([37, 40, 92.5]);
  });

  it('rounds to one decimal and is 0 for nothing marked', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(0, 0)).toBe(0);
  });
});
