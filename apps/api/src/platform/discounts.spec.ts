import { discountAmount, pickDiscount, type DiscountRule } from './discounts.js';

const rule = (o: Partial<DiscountRule> = {}): DiscountRule => ({
  id: 'd1',
  name: 'Launch',
  kind: 'PERCENT',
  value: 10,
  schoolId: null,
  startsOn: new Date('2026-11-01'),
  endsOn: null,
  ...o,
});

describe('discountAmount', () => {
  it('rounds a percent down to the rupee and caps a fixed amount at the bill', () => {
    expect(discountAmount(rule(), 10_295)).toBe(1_029);
    expect(discountAmount(rule({ kind: 'FIXED', value: 5_000 }), 3_000)).toBe(3_000);
    expect(discountAmount(rule({ kind: 'PERCENT', value: 100 }), 777)).toBe(777);
  });
});

describe('pickDiscount', () => {
  const none = new Set<string>();

  it('takes the biggest discount that applies to the school and the date', () => {
    const rules = [rule({ id: 'a', value: 10 }), rule({ id: 'b', kind: 'FIXED', value: 2_000 }), rule({ id: 'c', schoolId: 'other', value: 90 })];
    expect(pickDiscount(rules, 's1', '2026-11-05', none, 10_000)).toMatchObject({ rule: { id: 'b' }, amount: 2_000 });
  });

  it('skips discounts outside their dates and ones the school already used', () => {
    const rules = [rule({ id: 'a', endsOn: new Date('2026-11-30') }), rule({ id: 'b', startsOn: new Date('2026-12-05') })];
    expect(pickDiscount(rules, 's1', '2026-12-01', none, 1_000)).toBeNull();
    expect(pickDiscount(rules, 's1', '2026-11-30', none, 1_000)?.rule.id).toBe('a');
    expect(pickDiscount(rules, 's1', '2026-11-30', new Set(['a']), 1_000)).toBeNull();
  });

  it('returns nothing when the discount would take off nothing', () => {
    expect(pickDiscount([rule({ value: 10 })], 's1', '2026-11-05', none, 5)).toBeNull();
  });
});
