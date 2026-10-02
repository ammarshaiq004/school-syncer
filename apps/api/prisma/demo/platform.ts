// SchoolSyncer's own side of the demo: plans, the console login, each demo
// school's subscription and bills, and a handful of small customer schools in
// every state so the console has something to show.
import {
  Gender,
  PlatformInvoiceStatus,
  PrismaClient,
  Role,
  StudentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import {
  DEFAULT_PLANS,
  monthlyAmount,
  nextInvoiceNumber,
} from '../../src/platform/plans.js';
import { BOY_NAMES, GIRL_NAMES, SURNAMES } from './names.js';
import { Random } from './random.js';

const DAY = 86_400_000;

export const PLATFORM_ADMIN = {
  email: 'admin@schoolsyncer.pk',
  name: 'SchoolSyncer Support',
};

/** Small schools that exist only as customers in the console. */
export const CUSTOMER_SCHOOLS = [
  {
    slug: 'al-huda-academy',
    name: 'Al-Huda Academy',
    city: 'Multan',
    plan: 'starter',
    status: SubscriptionStatus.ACTIVE,
    students: 210,
    ageDays: 300,
  },
  {
    slug: 'beaconlight-school',
    name: 'Beaconlight School',
    city: 'Rawalpindi',
    plan: 'growth',
    status: SubscriptionStatus.PAST_DUE,
    students: 640,
    ageDays: 240,
  },
  {
    slug: 'green-valley-school',
    name: 'Green Valley School',
    city: 'Peshawar',
    plan: 'starter',
    status: SubscriptionStatus.SUSPENDED,
    students: 150,
    ageDays: 400,
  },
  {
    slug: 'sunrise-montessori',
    name: 'Sunrise Montessori',
    city: 'Islamabad',
    plan: 'growth',
    status: SubscriptionStatus.TRIAL,
    students: 0,
    ageDays: 40,
    trialDays: -10,
  },
  {
    slug: 'iqra-public-school',
    name: 'Iqra Public School',
    city: 'Gujranwala',
    plan: 'growth',
    status: SubscriptionStatus.TRIAL,
    students: 0,
    ageDays: 3,
    trialDays: 27,
  },
] as const;

const month = (d: Date) => d.toISOString().slice(0, 7);
const monthsBack = (from: Date, n: number) =>
  new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - n, 1));
const dueDate = (period: string) => new Date(`${period}-10T00:00:00Z`);

export async function seedPlans(prisma: PrismaClient) {
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { code: p.code },
      create: p,
      update: {},
    });
  }
}

export async function seedPlatformAdmin(
  prisma: PrismaClient,
  passwordHash: string,
) {
  await prisma.platformAdmin.upsert({
    where: { email: PLATFORM_ADMIN.email },
    create: { ...PLATFORM_ADMIN, passwordHash },
    update: { passwordHash, isActive: true },
  });
}

interface Billing {
  plan: string;
  status: SubscriptionStatus;
  /** Days until the trial ends; negative means it already has. */
  trialDays?: number;
  /** Paid monthly bills to create, newest first. */
  paidMonths: number;
  /** Unpaid bills to leave, the oldest of them this many months ago. */
  unpaidMonths?: number;
  /** Students to bill for when the school has no student records. */
  students?: number;
  notes?: string;
}

/** Gives a school its subscription and a billing history. */
export async function seedBilling(
  prisma: PrismaClient,
  schoolId: string,
  b: Billing,
  now = new Date(),
) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: b.plan } });
  await prisma.subscription.upsert({
    where: { schoolId },
    create: {
      schoolId,
      planId: plan.id,
      status: b.status,
      trialEndsAt:
        b.trialDays === undefined
          ? null
          : new Date(now.getTime() + b.trialDays * DAY),
      notes: b.notes,
    },
    update: {
      planId: plan.id,
      status: b.status,
      trialEndsAt:
        b.trialDays === undefined
          ? null
          : new Date(now.getTime() + b.trialDays * DAY),
      notes: b.notes,
    },
  });
  const students =
    b.students ??
    (await prisma.student.count({
      where: { schoolId, status: StudentStatus.ACTIVE },
    }));
  const unpaid = b.unpaidMonths ?? 0;
  // Oldest months first; the most recent `unpaid` of them are still owed.
  for (let i = b.paidMonths + unpaid; i >= 1; i--) {
    const period = month(monthsBack(now, i));
    const paid = i > unpaid;
    const count = Math.max(0, students - i * 3); // schools grow a little each month
    const last = await prisma.platformInvoice.findFirst({
      where: { period },
      orderBy: { number: 'desc' },
    });
    const number = nextInvoiceNumber(period, last?.number ?? null);
    const due = dueDate(period);
    await prisma.platformInvoice.upsert({
      where: { schoolId_period: { schoolId, period } },
      update: {},
      create: {
        number,
        schoolId,
        period,
        planName: plan.name,
        students: count,
        amount: monthlyAmount(plan, count),
        dueDate: due,
        status: paid
          ? PlatformInvoiceStatus.PAID
          : PlatformInvoiceStatus.UNPAID,
        paidAt: paid ? new Date(due.getTime() - 3 * DAY) : null,
        method: paid ? (i % 2 ? 'Bank transfer' : 'JazzCash') : null,
        reference: paid
          ? `TRX${period.replace('-', '')}${schoolId.slice(-3).toUpperCase()}`
          : null,
      },
    });
  }
}

/**
 * Creates the console-only customer schools, each with an owner login and a
 * roll of students (no classes or records) so usage and bills add up.
 */
export async function seedCustomerSchools(
  prisma: PrismaClient,
  passwordHash: string,
  now = new Date(),
) {
  for (const c of CUSTOMER_SCHOOLS) {
    if (await prisma.school.findUnique({ where: { slug: c.slug } })) continue;
    const school = await prisma.school.create({
      data: {
        name: c.name,
        slug: c.slug,
        city: c.city,
        email: `office@${c.slug}.pk`,
        createdAt: new Date(now.getTime() - c.ageDays * DAY),
        campuses: { create: { name: 'Main Campus' } },
        users: {
          create: {
            name: `${c.name} Owner`,
            email: `owner@${c.slug}.pk`,
            passwordHash,
            lastLoginAt: new Date(now.getTime() - Math.min(c.ageDays, 4) * DAY),
            roles: { create: { role: Role.OWNER } },
          },
        },
      },
    });
    const campus = await prisma.campus.findFirstOrThrow({
      where: { schoolId: school.id },
    });
    const rng = new Random(c.slug);
    await prisma.student.createMany({
      data: Array.from({ length: c.students }, (_, i) => {
        const girl = rng.chance(0.5);
        return {
          schoolId: school.id,
          campusId: campus.id,
          admissionNo: String(1001 + i),
          firstName: rng.pick(girl ? GIRL_NAMES : BOY_NAMES),
          lastName: rng.pick(SURNAMES),
          gender: girl ? Gender.FEMALE : Gender.MALE,
        };
      }),
    });
    const months = Math.floor(c.ageDays / 30);
    await seedBilling(
      prisma,
      school.id,
      {
        plan: c.plan,
        status: c.status,
        trialDays: 'trialDays' in c ? c.trialDays : undefined,
        paidMonths:
          c.status === SubscriptionStatus.TRIAL
            ? 0
            : months - (c.status === SubscriptionStatus.ACTIVE ? 0 : 2),
        unpaidMonths:
          c.status === SubscriptionStatus.ACTIVE ||
          c.status === SubscriptionStatus.TRIAL
            ? 0
            : 2,
        notes:
          c.status === SubscriptionStatus.SUSPENDED
            ? 'Suspended after three reminders about the two unpaid bills.'
            : c.status === SubscriptionStatus.PAST_DUE
              ? 'Accounts office says payment is coming after fee collection.'
              : undefined,
      },
      now,
    );
  }
}
