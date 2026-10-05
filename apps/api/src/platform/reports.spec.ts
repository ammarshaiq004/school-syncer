import { SubscriptionStatus as S } from '@prisma/client';
import {
  byMonth,
  fallingStudents,
  monthKeys,
  trialConversion,
  trialRisk,
} from './reports.js';

const now = new Date('2026-10-04T10:00:00Z');

describe('monthKeys', () => {
  it('lists the last months oldest first, across a year end', () => {
    const keys = monthKeys(now, 12);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe('2025-11');
    expect(keys[11]).toBe('2026-10');
    expect(monthKeys(new Date('2026-01-31T00:00:00Z'), 2)).toEqual(['2025-12', '2026-01']);
    // 21:00 UTC on 31 Jan is already 1 Feb in Pakistan.
    expect(monthKeys(new Date('2026-01-31T21:00:00Z'), 2)).toEqual(['2026-01', '2026-02']);
  });
});

describe('byMonth', () => {
  it('counts or sums rows per month and ignores older ones', () => {
    const keys = ['2026-09', '2026-10'];
    expect(
      byMonth(keys, [
        { at: new Date('2026-09-03') },
        { at: new Date('2026-09-20') },
        { at: new Date('2025-01-01') },
      ]),
    ).toEqual([
      { month: '2026-09', value: 2 },
      { month: '2026-10', value: 0 },
    ]);
    expect(byMonth(keys, [{ at: new Date('2026-10-02'), value: 5000 }])[1].value).toBe(5000);
    // Paid at 02:00 on 1 Oct Pakistan time (still September in UTC).
    expect(byMonth(keys, [{ at: new Date('2026-09-30T21:00:00Z') }])[1].value).toBe(1);
  });
});

describe('trialConversion', () => {
  it('compares paying schools with lost ones, ignoring running trials', () => {
    const r = trialConversion(
      [
        { status: S.ACTIVE, trialEndsAt: null },
        { status: S.PAST_DUE, trialEndsAt: null },
        { status: S.ACTIVE, trialEndsAt: null },
        { status: S.TRIAL, trialEndsAt: new Date('2026-09-01') },
        { status: S.TRIAL, trialEndsAt: new Date('2026-11-01') },
      ],
      now,
    );
    expect(r).toEqual({ converted: 3, lost: 1, inTrial: 1, rate: 75 });
    expect(trialConversion([], now).rate).toBeNull();
  });
});

describe('fallingStudents', () => {
  it('flags schools billed for fewer students than last time', () => {
    const r = fallingStudents([
      { schoolId: 'a', period: '2026-09', students: 300 },
      { schoolId: 'a', period: '2026-08', students: 320 },
      { schoolId: 'a', period: '2026-07', students: 100 },
      { schoolId: 'b', period: '2026-08', students: 50 },
      { schoolId: 'b', period: '2026-09', students: 60 },
      { schoolId: 'c', period: '2026-09', students: 10 },
    ]);
    expect([...r]).toEqual([['a', [320, 300]]]);
  });
});

describe('trialRisk', () => {
  it('flags expired trials and trials ending within a week', () => {
    expect(trialRisk(new Date('2026-09-25T00:00:00Z'), now)).toEqual({
      reason: 'trial_ended',
      detail: 'Trial ended 9 days ago, read-only',
    });
    expect(trialRisk(new Date('2026-10-03T12:00:00Z'), now)?.detail).toBe(
      'Trial ended today, read-only',
    );
    expect(trialRisk(new Date('2026-10-06T10:00:00Z'), now)).toEqual({
      reason: 'trial_ending',
      detail: 'Trial ends in 2 days',
    });
    expect(trialRisk(new Date('2026-10-20'), now)).toBeNull();
    expect(trialRisk(null, now)).toBeNull();
  });
});
