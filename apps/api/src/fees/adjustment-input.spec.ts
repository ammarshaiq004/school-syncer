import { describe, expect, it } from 'vitest';
import { adjustmentSchema } from './adjustment-input.js';

const parse = (v: unknown) => adjustmentSchema.safeParse(v);

describe('adjustmentSchema', () => {
  it('signs the amount from an explicit type', () => {
    expect(parse({ amount: 500, type: 'DISCOUNT', reason: 'Scholarship' })).toMatchObject({ success: true, data: { amount: -500 } });
    expect(parse({ amount: 500, type: 'CHARGE', reason: 'Trip fee' })).toMatchObject({ success: true, data: { amount: 500 } });
  });

  it('still takes a signed amount on its own', () => {
    expect(parse({ amount: -300, reason: 'Discount' })).toMatchObject({ success: true, data: { amount: -300 } });
    expect(parse({ amount: 300, reason: 'Late form' })).toMatchObject({ success: true, data: { amount: 300 } });
  });

  it('refuses unknown fields, unknown types, a negative amount with a type, and zero', () => {
    expect(parse({ amount: 500, kind: 'DISCOUNT', reason: 'Oops' }).success).toBe(false);
    expect(parse({ amount: 500, type: 'REFUND', reason: 'Oops' }).success).toBe(false);
    expect(parse({ amount: -500, type: 'DISCOUNT', reason: 'Oops' }).success).toBe(false);
    expect(parse({ amount: 0, reason: 'Nothing' }).success).toBe(false);
  });
});
