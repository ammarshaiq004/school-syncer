import { SubscriptionStatus } from '@prisma/client';
import { addDays, deletionBlockers, normaliseName, trialExtensionError, trialNoticeDays } from './deletion.js';

const now = new Date('2026-11-04T10:00:00Z');
const clean = { status: SubscriptionStatus.TRIAL, invoices: 0, payments: 0, claims: 0, pending: false };

describe('deletionBlockers', () => {
  it('lets an unbilled trial school go', () => {
    expect(deletionBlockers(clean)).toEqual([]);
  });

  it('keeps every school that ever dealt with money or is not on a trial', () => {
    for (const status of ['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const)
      expect(deletionBlockers({ ...clean, status })).toEqual(['not_on_trial']);
    expect(deletionBlockers({ ...clean, invoices: 1 })).toEqual(['has_invoices']);
    expect(deletionBlockers({ ...clean, payments: 2, claims: 1 })).toEqual(['has_payments', 'has_claims']);
  });

  it('reports only the pending deletion once one is waiting', () => {
    expect(deletionBlockers({ ...clean, status: SubscriptionStatus.SUSPENDED, invoices: 3, pending: true })).toEqual(['pending_deletion']);
  });
});

describe('names, notices and trial dates', () => {
  it('matches a typed name in any case and spacing', () => {
    expect(normaliseName('  Al-Huda   ACADEMY ')).toBe(normaliseName('al-huda academy'));
    expect(normaliseName('Al Huda')).not.toBe(normaliseName('Al-Huda'));
  });

  it('warns only in the last three days of a running trial', () => {
    expect(trialNoticeDays(null, now)).toBeNull();
    expect(trialNoticeDays(addDays(now, 4), now)).toBeNull();
    expect(trialNoticeDays(addDays(now, 3), now)).toBe(3);
    expect(trialNoticeDays(addDays(now, 0.2), now)).toBe(1);
    expect(trialNoticeDays(addDays(now, -1), now)).toBeNull();
  });

  it('only extends a trial into the future and not past 90 days', () => {
    expect(trialExtensionError(addDays(now, 10), now)).toBeNull();
    expect(trialExtensionError(addDays(now, 90), now)).toBeNull();
    expect(trialExtensionError(now, now)).toMatch(/future/);
    expect(trialExtensionError(addDays(now, 91), now)).toMatch(/90 days/);
  });
});
