import { SubscriptionStatus } from '@prisma/client';

/**
 * Modules a plan can switch on. Student records, attendance, announcements,
 * users and the parent portal are in every plan.
 */
export const FEATURES = {
  admissions: 'Admissions and enquiries',
  fees: 'Fees and vouchers',
  online_payments: 'Online fee payments',
  exams: 'Exams and report cards',
  homework: 'Homework',
  timetable: 'Timetable',
  hr: 'HR and payroll',
  accounts: 'Accounts and cash book',
  reports: 'Reports',
  transport: 'Transport',
  library: 'Library',
  certificates: 'Certificates and ID cards',
} as const;

export type Feature = keyof typeof FEATURES;

export const isFeature = (value: string): value is Feature => value in FEATURES;

/** Plans every new installation starts with; prices in PKR. Kept in sync with the migration. */
export const DEFAULT_PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'For a single-campus school getting off paper.',
    pricePerStudent: 49,
    minimumMonthly: 5000,
    maxStudents: 300,
    maxCampuses: 1,
    features: [
      'admissions',
      'fees',
      'exams',
      'homework',
      'reports',
      'certificates',
    ] as Feature[],
    sortOrder: 1,
  },
  {
    code: 'growth',
    name: 'Growth',
    description:
      'Everything a growing school runs on, across up to three campuses.',
    pricePerStudent: 69,
    minimumMonthly: 10000,
    maxStudents: 1500,
    maxCampuses: 3,
    features: Object.keys(FEATURES) as Feature[],
    sortOrder: 2,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description:
      'School groups: unlimited campuses and students, priority support.',
    pricePerStudent: 89,
    minimumMonthly: 25000,
    maxStudents: null,
    maxCampuses: null,
    features: Object.keys(FEATURES) as Feature[],
    sortOrder: 3,
  },
];

/** New schools try the Growth plan free for this long. */
export const TRIAL_PLAN = 'growth';
export const TRIAL_DAYS = 30;

/** Days after an invoice's due date before a school counts as past due. */
export const GRACE_DAYS = 15;

/** One month's charge: per active student, never below the plan's minimum. */
export function monthlyAmount(
  plan: { pricePerStudent: number; minimumMonthly: number },
  students: number,
): number {
  return Math.max(plan.minimumMonthly, plan.pricePerStudent * students);
}

export type Access =
  /** Everything works. */
  | 'full'
  /** The trial has ended or a bill is long overdue: the school can look but not change anything. */
  | 'read_only'
  /** Suspended or cancelled: nobody at the school can sign in. */
  | 'blocked';

export interface SubscriptionState {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  /** Due date of the oldest unpaid invoice, if any. */
  oldestUnpaidDue: Date | null;
}

/** What a school may do right now, given its subscription. */
export function accessFor(
  sub: SubscriptionState,
  now = new Date(),
): { access: Access; reason: string | null } {
  if (
    sub.status === SubscriptionStatus.SUSPENDED ||
    sub.status === SubscriptionStatus.CANCELLED
  ) {
    return {
      access: 'blocked',
      reason:
        'This school’s SchoolSyncer account is suspended. Please contact SchoolSyncer.',
    };
  }
  if (
    sub.status === SubscriptionStatus.TRIAL &&
    sub.trialEndsAt &&
    sub.trialEndsAt < now
  ) {
    return {
      access: 'read_only',
      reason: 'The free trial has ended. Choose a plan to keep making changes.',
    };
  }
  if (sub.oldestUnpaidDue) {
    const cutoff = new Date(
      sub.oldestUnpaidDue.getTime() + GRACE_DAYS * 86_400_000,
    );
    if (cutoff < now) {
      return {
        access: 'read_only',
        reason:
          'A SchoolSyncer bill is overdue. Please pay it to keep making changes.',
      };
    }
  }
  return { access: 'full', reason: null };
}

/**
 * Bill numbers run per month: "SS-202610-0001". Takes the highest number used
 * so far, since bills of deleted schools leave gaps.
 */
export function nextInvoiceNumber(period: string, last: string | null): string {
  const prefix = `SS-${period.replace('-', '')}-`;
  const seq = last?.startsWith(prefix) ? Number(last.slice(prefix.length)) : 0;
  return `${prefix}${String(seq + 1).padStart(4, '0')}`;
}
