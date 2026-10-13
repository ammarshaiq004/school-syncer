// Who can do what in the demo: a custom role on City Grammar, a former staff
// member whose login is switched off, the console's second (support) login, a
// module override on one customer school, and some history in both audit logs
// so the audit pages have something to show.
//
// Everything here is safe to run again: rows are upserted or looked up first,
// and audit entries have fixed ids, so a plain reseed changes nothing and a
// `--reset` (which deletes the schools) builds them again.
import {
  PlatformRole,
  Prisma,
  PrismaClient,
  Role,
  StaffStatus,
} from '@prisma/client';
import {
  DEFAULT_PERMISSIONS,
  diffMatrix,
  type PermissionMatrix,
} from '../../src/common/permissions.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const SUPPORT_ADMIN = {
  email: 'support@schoolsyncer.pk',
  name: 'Hira Baig',
};

export const EXAM_COORDINATOR = {
  role: 'Exam coordinator',
  description:
    'Runs exam schedules and marks entry; can see students but not attendance registers or fees.',
  email: 'exams@demo.pk',
};

export const FORMER_STAFF = {
  name: 'Kashif Mehmood',
  email: 'former.staff@demo.pk',
  designation: 'Computer teacher',
};

/** Module override shown on a customer school: Starter has no library. */
export const FEATURE_OVERRIDE = {
  slug: 'al-huda-academy',
  added: ['library'],
  removed: [] as string[],
};

/** The custom role's matrix: a teacher who runs exams and can look up students, with no attendance or fees access. */
const examCoordinatorMatrix = (): PermissionMatrix => ({
  ...DEFAULT_PERMISSIONS[Role.TEACHER],
  exams: 'manage',
  students: 'view',
  attendance: 'none',
  fees: 'none',
});

/** City Grammar's roles and access history. Call after the school is seeded. */
export async function seedSchoolAccess(
  prisma: PrismaClient,
  slug: string,
  passwordHash: string,
  now = new Date(),
) {
  const school = await prisma.school.findUniqueOrThrow({ where: { slug } });
  const schoolId = school.id;
  const byEmail = (email: string) =>
    prisma.user.findFirstOrThrow({ where: { schoolId, email } });
  const owner = await byEmail('owner@demo.pk');
  const principal = await byEmail('principal@demo.pk');
  const admin = await byEmail('admin@demo.pk');
  const demoTeacher = await byEmail('teacher@demo.pk');
  const modelTown = await prisma.campus.findFirstOrThrow({
    where: { schoolId, name: 'Model Town campus' },
  });
  const johar = await prisma.campus.findFirstOrThrow({
    where: { schoolId, name: 'Johar Town campus' },
  });
  const ago = (days: number, hours = 0) =>
    new Date(now.getTime() - days * DAY - hours * HOUR);

  // ----- Custom role -----
  const permissions = diffMatrix(
    DEFAULT_PERMISSIONS[Role.TEACHER],
    examCoordinatorMatrix(),
  ) as Prisma.InputJsonValue;
  const role = await prisma.customRole.upsert({
    where: { schoolId_name: { schoolId, name: EXAM_COORDINATOR.role } },
    create: {
      schoolId,
      name: EXAM_COORDINATOR.role,
      description: EXAM_COORDINATOR.description,
      baseRole: Role.TEACHER,
      permissions,
      createdAt: ago(9, 3),
    },
    update: {
      description: EXAM_COORDINATOR.description,
      baseRole: Role.TEACHER,
      permissions,
    },
  });

  // One of the generated Model Town teachers becomes the exam coordinator: their
  // plain teacher grant is swapped for the custom role (same base role and campus).
  let coordinator = await prisma.user.findFirst({
    where: { schoolId, email: EXAM_COORDINATOR.email },
    include: { roles: true },
  });
  if (!coordinator) {
    const teacher = await prisma.user.findFirstOrThrow({
      where: {
        schoolId,
        id: { not: demoTeacher.id },
        email: { not: null },
        roles: {
          some: {
            role: Role.TEACHER,
            campusId: modelTown.id,
            customRoleId: null,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    coordinator = await prisma.user.update({
      where: { id: teacher.id },
      data: { email: EXAM_COORDINATOR.email },
      include: { roles: true },
    });
  }
  if (!coordinator.roles.some((r) => r.customRoleId === role.id)) {
    await prisma.$transaction([
      prisma.roleAssignment.deleteMany({
        where: {
          userId: coordinator.id,
          role: Role.TEACHER,
          customRoleId: null,
        },
      }),
      prisma.roleAssignment.create({
        data: {
          userId: coordinator.id,
          role: Role.TEACHER,
          campusId: modelTown.id,
          customRoleId: role.id,
        },
      }),
    ]);
  }
  const grant = (customRoleId: string | null) => [
    { role: Role.TEACHER, campusId: modelTown.id, customRoleId },
  ];

  // ----- A former staff member, login switched off -----
  let former = await prisma.user.findFirst({
    where: { schoolId, email: FORMER_STAFF.email },
  });
  if (!former) {
    const last = await prisma.staffProfile.findFirst({
      where: { schoolId },
      orderBy: { employeeNo: 'desc' },
    });
    const next = Number(last?.employeeNo.replace(/\D/g, '') ?? 0) + 1;
    former = await prisma.user.create({
      data: {
        schoolId,
        name: FORMER_STAFF.name,
        email: FORMER_STAFF.email,
        phone: '03009990001',
        passwordHash,
        isActive: false,
        lastLoginAt: ago(8, 5),
        createdAt: ago(400),
        roles: { create: { role: Role.TEACHER, campusId: modelTown.id } },
        staffProfile: {
          create: {
            schoolId,
            employeeNo: `EMP-${String(next).padStart(4, '0')}`,
            designation: FORMER_STAFF.designation,
            department: 'Academics',
            joinedOn: new Date(Date.UTC(now.getUTCFullYear() - 2, 7, 1)),
            basicSalary: 45000,
            status: StaffStatus.LEFT,
          },
        },
      },
    });
  }

  // ----- School audit log -----
  const support = await prisma.platformAdmin.findUnique({
    where: { email: SUPPORT_ADMIN.email },
  });
  const entries: Omit<Prisma.AuditLogCreateManyInput, 'schoolId'>[] = [
    {
      userId: owner.id,
      action: 'school.update',
      entity: 'School',
      entityId: schoolId,
      before: { lateFeePerDay: 10, feeDueDay: 15 },
      after: { lateFeePerDay: 20, feeDueDay: 10 },
      createdAt: ago(21, 4),
    },
    {
      userId: principal.id,
      action: 'campus.update',
      entity: 'Campus',
      entityId: johar.id,
      before: { phone: '042-35302200' },
      after: { phone: johar.phone },
      createdAt: ago(16, 2),
    },
    {
      userId: owner.id,
      action: 'role.create',
      entity: 'CustomRole',
      entityId: role.id,
      after: {
        name: role.name,
        description: role.description,
        baseRole: role.baseRole,
        permissions,
      },
      createdAt: ago(9, 3),
    },
    {
      userId: owner.id,
      action: 'user.update',
      entity: 'User',
      entityId: coordinator.id,
      before: {
        name: coordinator.name,
        email: coordinator.email,
        phone: coordinator.phone,
        isActive: true,
        roles: grant(null),
      },
      after: {
        name: coordinator.name,
        email: coordinator.email,
        phone: coordinator.phone,
        isActive: true,
        roles: grant(role.id),
      },
      createdAt: ago(9, 2),
    },
    {
      userId: principal.id,
      action: 'user.deactivate',
      entity: 'User',
      entityId: former.id,
      before: { isActive: true },
      after: { isActive: false },
      createdAt: ago(6, 6),
    },
    {
      userId: admin.id,
      action: 'user.reset_password',
      entity: 'User',
      entityId: demoTeacher.id,
      createdAt: ago(4, 1),
    },
  ];
  if (support) {
    entries.push({
      userId: null,
      action: 'platform.support_login',
      entity: 'School',
      entityId: schoolId,
      after: {
        by: support.name,
        byAdminId: support.id,
        reason: 'Owner asked why the October vouchers show the old late fee.',
      },
      createdAt: ago(2, 3),
    });
  }
  await prisma.auditLog.createMany({
    data: entries.map((e, i) => ({
      ...e,
      id: `seed-audit-${slug}-${i + 1}`,
      schoolId,
    })),
    skipDuplicates: true,
  });
}

/** The console's support login (the owner login comes from seedPlatformAdmin). */
export async function seedSupportAdmin(
  prisma: PrismaClient,
  passwordHash: string,
) {
  await prisma.platformAdmin.upsert({
    where: { email: SUPPORT_ADMIN.email },
    create: { ...SUPPORT_ADMIN, passwordHash, role: PlatformRole.SUPPORT },
    // Create-only: an existing account (and its password) is left as it is.
    update: {},
  });
}

/**
 * The module override on a customer school and a few weeks of console history.
 * Run after every school exists. Entries are upserted by fixed id, so a reset
 * points them at the rebuilt schools.
 */
export async function seedPlatformActivity(
  prisma: PrismaClient,
  ownerEmail: string,
  now = new Date(),
) {
  const ago = (days: number, hours = 0) =>
    new Date(now.getTime() - days * DAY - hours * HOUR);
  const owner = await prisma.platformAdmin.findUniqueOrThrow({
    where: { email: ownerEmail },
  });
  const support = await prisma.platformAdmin.findUniqueOrThrow({
    where: { email: SUPPORT_ADMIN.email },
  });
  const schoolBySlug = (slug: string) =>
    prisma.school.findUniqueOrThrow({ where: { slug } });

  const alHuda = await schoolBySlug(FEATURE_OVERRIDE.slug);
  await prisma.subscription.update({
    where: { schoolId: alHuda.id },
    data: {
      featuresAdded: FEATURE_OVERRIDE.added,
      featuresRemoved: FEATURE_OVERRIDE.removed,
    },
  });

  const demo = await schoolBySlug('demo-school');
  const demoOwner = await prisma.user.findFirstOrThrow({
    where: { schoolId: demo.id, email: 'owner@demo.pk' },
  });
  const greenValley = await schoolBySlug('green-valley-school');
  const beaconlight = await schoolBySlug('beaconlight-school');
  const iqra = await schoolBySlug('iqra-public-school');
  const alHudaOwner = await prisma.user.findFirstOrThrow({
    where: { schoolId: alHuda.id, email: 'owner@al-huda-academy.pk' },
  });
  const paid = await prisma.platformInvoice.findFirst({
    where: { schoolId: demo.id, status: 'PAID' },
    orderBy: { period: 'desc' },
  });

  const entries: {
    adminId: string;
    action: string;
    schoolId: string | null;
    details: Prisma.InputJsonValue;
    createdAt: Date;
  }[] = [
    {
      adminId: owner.id,
      action: 'staff.create',
      schoolId: null,
      details: {
        staffId: support.id,
        email: support.email,
        role: PlatformRole.SUPPORT,
      },
      createdAt: ago(45, 2),
    },
    {
      adminId: owner.id,
      action: 'school.suspend',
      schoolId: greenValley.id,
      details: {
        reason:
          'Two bills unpaid after three reminders; owner not answering calls.',
        before: { status: 'PAST_DUE' },
        after: { status: 'SUSPENDED' },
      },
      createdAt: ago(18, 5),
    },
    {
      adminId: support.id,
      action: 'subscription.update',
      schoolId: beaconlight.id,
      details: {
        before: { plan: 'growth', status: 'ACTIVE', trialEndsAt: null },
        after: { plan: 'growth', status: 'PAST_DUE', trialEndsAt: null },
      },
      createdAt: ago(14, 1),
    },
    {
      adminId: owner.id,
      action: 'school.features',
      schoolId: alHuda.id,
      details: {
        before: { added: [], removed: [] },
        after: {
          added: FEATURE_OVERRIDE.added,
          removed: FEATURE_OVERRIDE.removed,
        },
      },
      createdAt: ago(11, 3),
    },
    {
      adminId: support.id,
      action: 'school.user.reset_password',
      schoolId: alHuda.id,
      details: { userId: alHudaOwner.id },
      createdAt: ago(7, 2),
    },
    {
      adminId: support.id,
      action: 'school.create',
      schoolId: iqra.id,
      details: { name: iqra.name, plan: 'growth', status: 'TRIAL' },
      createdAt: ago(3, 4),
    },
    {
      adminId: support.id,
      action: 'school.support_login',
      schoolId: demo.id,
      details: {
        as: demoOwner.id,
        reason: 'Owner asked why the October vouchers show the old late fee.',
        expiresAt: ago(2, 2).toISOString(),
      },
      createdAt: ago(2, 3),
    },
  ];
  if (paid) {
    entries.push({
      adminId: owner.id,
      action: 'invoice.pay',
      schoolId: demo.id,
      details: {
        number: paid.number,
        amount: paid.amount,
        method: paid.method ?? 'Bank transfer',
      },
      createdAt: paid.paidAt ?? ago(25),
    });
  }
  for (const [i, e] of entries.entries()) {
    const id = `seed-platform-audit-${i + 1}`;
    await prisma.platformAuditLog.upsert({
      where: { id },
      create: { id, ...e },
      update: e,
    });
  }
}
