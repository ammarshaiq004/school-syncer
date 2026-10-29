import { PlatformMessageTarget, Prisma, SubscriptionStatus } from '@prisma/client';

const DAY = 86_400_000;
/** "Trials ending" covers trials that end within this many days, and those already over. */
export const TRIAL_ENDING_DAYS = 7;

/**
 * The subscriptions a message goes to. Cancelled schools never get one;
 * CHOSEN is exactly the ids picked (a cancelled one among them is skipped).
 */
export function recipientsWhere(
  target: PlatformMessageTarget,
  schoolIds: string[],
  now: Date,
): Prisma.SubscriptionWhereInput {
  const live = { status: { not: SubscriptionStatus.CANCELLED } };
  switch (target) {
    case 'CHOSEN':
      return { ...live, schoolId: { in: schoolIds } };
    case 'OVERDUE':
      return { status: SubscriptionStatus.PAST_DUE };
    case 'TRIALS_ENDING':
      return { status: SubscriptionStatus.TRIAL, trialEndsAt: { lte: new Date(now.getTime() + TRIAL_ENDING_DAYS * DAY) } };
    default:
      return live;
  }
}
