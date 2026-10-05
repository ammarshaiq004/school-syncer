import { SubscriptionStatus } from '@prisma/client';
import {
  accessFor,
  effectiveFeatures,
  DEFAULT_PLANS,
  FEATURES,
  monthlyAmount,
  nextInvoiceNumber,
} from './plans.js';

const now = new Date('2026-10-02T10:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe('monthlyAmount', () => {
  it('charges per student with a minimum', () => {
    const plan = { pricePerStudent: 69, minimumMonthly: 10000 };
    expect(monthlyAmount(plan, 488)).toBe(33672);
    expect(monthlyAmount(plan, 50)).toBe(10000);
  });
});

describe('accessFor', () => {
  const base = {
    status: SubscriptionStatus.ACTIVE,
    trialEndsAt: null,
    oldestUnpaidDue: null,
  };

  it('gives full access to paying schools and running trials', () => {
    expect(accessFor(base, now).access).toBe('full');
    expect(
      accessFor(
        { ...base, status: SubscriptionStatus.TRIAL, trialEndsAt: daysAgo(-3) },
        now,
      ).access,
    ).toBe('full');
  });

  it('makes a school read-only when its trial ends', () => {
    expect(
      accessFor(
        { ...base, status: SubscriptionStatus.TRIAL, trialEndsAt: daysAgo(1) },
        now,
      ),
    ).toEqual({
      access: 'read_only',
      reason: 'The free trial has ended. Choose a plan to keep making changes.',
    });
  });

  it('allows a grace period on overdue bills', () => {
    expect(
      accessFor({ ...base, oldestUnpaidDue: daysAgo(10) }, now).access,
    ).toBe('full');
    expect(
      accessFor({ ...base, oldestUnpaidDue: daysAgo(16) }, now).access,
    ).toBe('read_only');
  });

  it('blocks suspended and cancelled schools', () => {
    expect(
      accessFor({ ...base, status: SubscriptionStatus.SUSPENDED }, now).access,
    ).toBe('blocked');
    expect(
      accessFor({ ...base, status: SubscriptionStatus.CANCELLED }, now).access,
    ).toBe('blocked');
  });
});

describe('DEFAULT_PLANS', () => {
  it('only names features that exist', () => {
    for (const plan of DEFAULT_PLANS) {
      for (const f of plan.features) expect(FEATURES).toHaveProperty(f);
    }
  });
});

describe('nextInvoiceNumber', () => {
  it('numbers bills per month, after the highest so far', () => {
    expect(nextInvoiceNumber('2026-10', null)).toBe('SS-202610-0001');
    expect(nextInvoiceNumber('2026-10', 'SS-202610-0041')).toBe(
      'SS-202610-0042',
    );
  });
});

describe('effectiveFeatures', () => {
  it('adds and removes modules on top of the plan', () => {
    expect(
      effectiveFeatures(['fees', 'exams'], ['transport'], ['exams']),
    ).toEqual(['fees', 'transport']);
  });
  it('lets a removal win over an addition and drops unknown keys', () => {
    expect(effectiveFeatures(['fees', 'nope'], ['hr', 'bogus'], ['hr'])).toEqual([
      'fees',
    ]);
  });
  it('keeps the plan as is without overrides', () => {
    expect(effectiveFeatures(['library', 'fees'])).toEqual(['fees', 'library']);
  });
});
