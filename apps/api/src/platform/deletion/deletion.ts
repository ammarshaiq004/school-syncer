import { SubscriptionStatus } from '@prisma/client';

/** A school asked to be deleted can be let off for this long. */
export const DELETION_GRACE_DAYS = 14;
/** After the purge, the copy of the school's data is kept this long. */
export const EXPORT_KEEP_DAYS = 90;
/** A school is told its trial is ending this many days ahead. */
export const TRIAL_NOTICE_DAYS = 3;
/** A trial can be set at most this far ahead of today. */
export const MAX_TRIAL_DAYS = 90;

const DAY = 86_400_000;

export type Blocker = 'not_on_trial' | 'has_invoices' | 'has_payments' | 'has_claims' | 'pending_deletion';

export const BLOCKER_TEXT: Record<Blocker, string> = {
  not_on_trial: 'Only a school on a free trial can be deleted.',
  has_invoices: 'This school has been sent a bill.',
  has_payments: 'This school has paid SchoolSyncer.',
  has_claims: 'This school has told SchoolSyncer about a payment.',
  pending_deletion: 'This school is already waiting to be deleted.',
};

/**
 * Why a school cannot be deleted. Only a school on a free trial that never had
 * a bill, a payment or a payment claim can go: anything else is customer money
 * history that stays.
 */
export function deletionBlockers(s: {
  status: SubscriptionStatus;
  invoices: number;
  payments: number;
  claims: number;
  pending: boolean;
}): Blocker[] {
  if (s.pending) return ['pending_deletion'];
  const out: Blocker[] = [];
  if (s.status !== SubscriptionStatus.TRIAL) out.push('not_on_trial');
  if (s.invoices) out.push('has_invoices');
  if (s.payments) out.push('has_payments');
  if (s.claims) out.push('has_claims');
  return out;
}

/** Names match when typed in any case, with any spacing. */
export const normaliseName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export const addDays = (at: Date, days: number) => new Date(at.getTime() + days * DAY);

/**
 * Days until a trial ends when it is close enough to warn about (1 to
 * TRIAL_NOTICE_DAYS), or null when it is further off, over, or has no end.
 */
export function trialNoticeDays(trialEndsAt: Date | null, now: Date): number | null {
  if (!trialEndsAt || trialEndsAt <= now) return null;
  const days = Math.ceil((+trialEndsAt - +now) / DAY);
  return days <= TRIAL_NOTICE_DAYS ? days : null;
}

/** An error when a new trial end is not allowed: it must be ahead of now and not too far off. */
export function trialExtensionError(endsAt: Date, now: Date): string | null {
  if (endsAt <= now) return 'The new trial end must be in the future';
  if (endsAt > addDays(now, MAX_TRIAL_DAYS)) return `A trial can run at most ${MAX_TRIAL_DAYS} days from today`;
  return null;
}
