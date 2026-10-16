// Seeds three demo schools (hybrid, physical and online) with a term's worth of realistic data.
//
//   pnpm prisma:seed            adds the demo schools if they aren't there
//   pnpm prisma:seed --reset    deletes and rebuilds them (other schools are untouched)
//
// Every login uses the password "password123". See README "Demo data" for the list.
// Logins that already exist are never changed, so a password someone set stays.
//
// Demo data has no place in production: with NODE_ENV=production the seed
// refuses to run unless ALLOW_DEMO_SEED=true. The first real console login
// comes from `pnpm --filter api platform:create-admin` instead.
import { Gender, PrismaClient, Role, SchoolMode, SubscriptionStatus, VehicleType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { localToday } from '../src/common/dates.js';
import { CUSTOMER_SCHOOLS, PLATFORM_ADMIN, seedBilling, seedCustomerSchools, seedPlans, seedPlatformAdmin, seedPlatformSettings } from './demo/platform.js';
import { seedSchool, type SchoolPlan } from './demo/school.js';
import { SUPPORT_ADMIN, seedPlatformActivity, seedSchoolAccess, seedSupportAdmin } from './demo/access.js';
import { seedAcademia } from './demo/academia.js';
import { seedOnlinePayments } from './demo/online-payments.js';

const prisma = new PrismaClient();

const grades = (from: number, to: number, sections: string[]) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ name: `Grade ${from + i}`, level: from + i, sections }));

const EARLY_YEARS = [
  { name: 'Playgroup', level: -2, sections: ['A'] },
  { name: 'Nursery', level: -1, sections: ['A'] },
  { name: 'Prep', level: 0, sections: ['A', 'B'] },
];

export const DEMO_SCHOOLS: SchoolPlan[] = [
  {
    name: 'City Grammar School',
    slug: 'demo-school',
    city: 'Lahore',
    phone: '042-35761234',
    email: 'info@citygrammar.pk',
    emailDomain: 'demo.pk',
    // Classes on campus, plus courses, live classes and coursework online for Grades 5 to 8.
    mode: SchoolMode.HYBRID,
    eschool: {
      levels: [5, 8],
      liveSubjects: ['Mathematics', 'Science', 'Computer'],
      logins: 'demo-section',
      demoStudentEmail: 'student@demo.pk',
    },
    campuses: [
      {
        name: 'Model Town campus',
        address: '12-C Model Town, Lahore',
        phone: '042-35761234',
        classes: [...EARLY_YEARS, ...grades(1, 5, ['A', 'B']), ...grades(6, 8, ['A', 'B'])],
        feeFactor: 1,
      },
      {
        name: 'Johar Town campus',
        address: '45-R1 Johar Town, Lahore',
        phone: '042-35302211',
        classes: [{ name: 'Playgroup', level: -2, sections: ['A'] }, { name: 'Prep', level: 0, sections: ['A'] }, ...grades(1, 5, ['A'])],
        feeFactor: 0.85,
      },
    ],
    staff: [
      { name: 'Demo Owner', email: 'owner@demo.pk', role: Role.OWNER, designation: 'Director', salary: 0 },
      { name: 'Nasreen Akhtar', email: 'principal@demo.pk', role: Role.PRINCIPAL, designation: 'Principal', salary: 180000 },
      { name: 'Shahida Parveen', email: 'johar.head@demo.pk', role: Role.PRINCIPAL, campus: 'Johar Town campus', designation: 'Campus head', salary: 120000 },
      { name: 'Usman Ghani', email: 'admin@demo.pk', role: Role.ADMIN, campus: 'Model Town campus', designation: 'Admin officer', salary: 70000 },
      { name: 'Demo Accountant', email: 'accountant@demo.pk', role: Role.ACCOUNTANT, designation: 'Accountant', salary: 75000 },
    ],
    demoTeacher: { name: 'Demo Teacher', email: 'teacher@demo.pk', subject: 'Mathematics' },
    demoFamily: {
      father: 'Imran Khan',
      surname: 'Khan',
      phone: '03001234567',
      children: [
        { name: 'Ahmed', gender: Gender.MALE, className: 'Grade 5' },
        { name: 'Zainab', gender: Gender.FEMALE, className: 'Grade 2' },
        { name: 'Hamza', gender: Gender.MALE, className: 'Prep' },
      ],
    },
    studentsPerSection: [14, 22],
    tuitionBase: 5500,
    tuitionStep: 500,
    annualCharges: 9000,
    phonePrefix: '0300',
    transport: {
      share: 0.25,
      routes: [
        {
          campus: 'Model Town campus',
          name: 'Route 1: Garden Town and Faisal Town',
          fee: 4500,
          vehicle: { registrationNo: 'LEB-2187', type: VehicleType.VAN, capacity: 14 },
          stops: [
            ['Kalma Chowk', '06:55', '14:40'],
            ['Garden Town, Ali Block', '07:05', '14:30'],
            ['Faisal Town, Peco Road', '07:15', '14:20'],
          ],
        },
        {
          campus: 'Model Town campus',
          name: 'Route 2: DHA',
          fee: 6000,
          vehicle: { registrationNo: 'LEC-5530', type: VehicleType.COASTER, capacity: 22 },
          stops: [
            ['DHA Phase 6, Main Boulevard', '06:40', '14:55', 7000],
            ['DHA Phase 5, Y Block', '06:50', '14:45'],
            ['DHA Phase 3, Defence Road', '07:00', '14:35'],
            ['Walton Road', '07:12', '14:25', 5000],
          ],
        },
        {
          campus: 'Model Town campus',
          name: 'Route 3: Township and Green Town',
          fee: 4000,
          vehicle: { registrationNo: 'LED-9042', type: VehicleType.VAN, capacity: 14 },
          stops: [
            ['Green Town', '06:50', '14:45'],
            ['Township, Sector A2', '07:00', '14:35'],
            ['Akbar Chowk', '07:10', '14:25'],
          ],
        },
        {
          campus: 'Johar Town campus',
          name: 'Route 4: Wapda Town and Valencia',
          fee: 4500,
          vehicle: { registrationNo: 'LEA-7716', type: VehicleType.VAN, capacity: 14 },
          stops: [
            ['Valencia Town', '06:55', '14:40', 5500],
            ['Wapda Town roundabout', '07:05', '14:30'],
            ['Shaukat Khanum', '07:15', '14:20'],
          ],
        },
      ],
    },
  },
  {
    // A second, smaller tenant to show schools never see each other's data.
    name: 'Bright Future School',
    slug: 'bright-future',
    city: 'Faisalabad',
    phone: '041-8711122',
    email: 'office@brightfuture.pk',
    emailDomain: 'brightfuture.pk',
    campuses: [
      {
        name: 'Main campus',
        address: 'Susan Road, Madina Town, Faisalabad',
        phone: '041-8711122',
        classes: [{ name: 'Nursery', level: -1, sections: ['A'] }, { name: 'Prep', level: 0, sections: ['A'] }, ...grades(1, 5, ['A'])],
        feeFactor: 1,
      },
    ],
    staff: [
      { name: 'Bright Future Owner', email: 'owner@brightfuture.pk', role: Role.OWNER, designation: 'Owner', salary: 0 },
      { name: 'Rukhsana Bibi', email: 'principal@brightfuture.pk', role: Role.PRINCIPAL, designation: 'Principal', salary: 90000 },
      { name: 'Asad Mehmood', email: 'accounts@brightfuture.pk', role: Role.ACCOUNTANT, designation: 'Accounts clerk', salary: 45000 },
    ],
    studentsPerSection: [12, 20],
    tuitionBase: 2500,
    tuitionStep: 250,
    annualCharges: 5000,
    phonePrefix: '0321',
    transport: {
      share: 0.2,
      routes: [
        {
          campus: 'Main campus',
          name: 'Route 1: Peoples Colony and Madina Town',
          fee: 3500,
          vehicle: { registrationNo: 'FDA-3315', type: VehicleType.VAN, capacity: 12 },
          stops: [
            ['Peoples Colony No. 1', '07:00', '13:50'],
            ['Madina Town, Susan Road', '07:10', '13:40'],
            ['D Ground', '07:18', '13:32'],
          ],
        },
      ],
    },
  },
  {
    // A fully online school: live classes from the timetable, no vans or library.
    name: 'Virtual Learning Academy',
    slug: 'online-academy',
    city: 'Karachi',
    phone: '021-34381200',
    email: 'hello@online-academy.pk',
    emailDomain: 'online-academy.pk',
    mode: SchoolMode.ONLINE,
    campuses: [
      {
        name: 'Online campus',
        address: 'Office 804, Emerald Tower, Clifton Block 5, Karachi',
        phone: '021-34381200',
        classes: grades(6, 10, ['A']),
        feeFactor: 1,
      },
    ],
    staff: [
      { name: 'Farhan Siddiqui', email: 'owner@online-academy.pk', role: Role.OWNER, designation: 'Director', salary: 0 },
      { name: 'Mehwish Raza', email: 'principal@online-academy.pk', role: Role.PRINCIPAL, designation: 'Head of academics', salary: 160000 },
    ],
    demoTeacher: { name: 'Saima Naveed', email: 'teacher@online-academy.pk', subject: 'Mathematics' },
    demoFamily: {
      father: 'Tariq Mehmood',
      surname: 'Mehmood',
      phone: '03331234567',
      children: [{ name: 'Ayesha', gender: Gender.FEMALE, className: 'Grade 8' }],
    },
    studentsPerSection: [10, 15],
    tuitionBase: 3000,
    tuitionStep: 300,
    annualCharges: 4000,
    phonePrefix: '0333',
    eschool: { levels: [6, 10], logins: 'all', demoStudentEmail: 'student@online-academy.pk' },
  },
];

/** How each demo school pays SchoolSyncer. */
const BILLING: Record<string, Parameters<typeof seedBilling>[2]> = {
  // A paying customer for half a year.
  'demo-school': { plan: 'growth', status: SubscriptionStatus.ACTIVE, paidMonths: 6 },
  // Signed up three weeks ago; the trial ends soon.
  'bright-future': { plan: 'growth', status: SubscriptionStatus.TRIAL, trialDays: 9, paidMonths: 0 },
  // Online since the spring.
  'online-academy': { plan: 'growth', status: SubscriptionStatus.ACTIVE, paidMonths: 4 },
};

/** Deletes a school and everything under it, money and history included. */
async function deleteSchool(slug: string) {
  const school = await prisma.school.findUnique({ where: { slug } });
  if (!school) return;
  const schoolId = school.id;
  // Custom roles can't be deleted while held (onDelete Restrict), so free them first.
  await prisma.roleAssignment.deleteMany({ where: { customRoleId: { not: null }, user: { schoolId } } });
  // These are protected from cascading deletes in normal use, so go first.
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.exam.deleteMany({ where: { schoolId } });
  await prisma.payrollRun.deleteMany({ where: { schoolId } });
  await prisma.accountEntry.deleteMany({ where: { schoolId } });
  await prisma.application.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } });
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error(
      'Refusing to seed demo data with NODE_ENV=production: it creates logins with the password "password123" ' +
        'and --reset deletes schools. Create the first console owner with `pnpm --filter api platform:create-admin`. ' +
        'Set ALLOW_DEMO_SEED=true to seed anyway.',
    );
    process.exitCode = 1;
    return;
  }
  const reset = process.argv.includes('--reset');
  const today = localToday();
  const passwordHash = await bcrypt.hash('password123', 12);
  await seedPlans(prisma);
  await seedPlatformAdmin(prisma, passwordHash);
  await seedSupportAdmin(prisma, passwordHash);
  for (const plan of DEMO_SCHOOLS) {
    if (reset) await deleteSchool(plan.slug);
    else if (await prisma.school.findUnique({ where: { slug: plan.slug } })) {
      console.log(`${plan.slug} already exists (run with --reset to rebuild it)`);
      continue;
    }
    const started = Date.now();
    const summary = await seedSchool(prisma, plan, passwordHash, today);
    console.log(
      `Seeded ${plan.slug}: ${summary.students} students, ${summary.staff} staff, ${summary.invoices} invoices, ` +
        `${summary.attendanceRecords} attendance records, ${summary.books} library books, ${summary.loans} loans, ${summary.certificates} certificates in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    const e = summary.eschool;
    if (e) {
      console.log(
        `  e-school: ${e.logins} student logins, ${e.courses} courses with ${e.lessons} lessons, ${e.liveClasses} live classes, ` +
          `${e.assignments} assignments (${e.submissions} submissions), ${e.quizzes} quizzes (${e.attempts} attempts)`,
      );
    }
    await seedBilling(prisma, summary.schoolId, BILLING[plan.slug]);
  }
  if (reset) for (const c of CUSTOMER_SCHOOLS) await deleteSchool(c.slug);
  await seedCustomerSchools(prisma, passwordHash);
  await seedPlatformSettings(prisma);
  // Roles, a switched-off login, a module override and audit history; safe to rerun.
  await seedSchoolAccess(prisma, 'demo-school', passwordHash);
  await seedPlatformActivity(prisma, PLATFORM_ADMIN.email);
  // Lesson plans and parent-teacher chat; each part is skipped if the school already has some.
  for (const plan of DEMO_SCHOOLS) {
    if (!plan.demoTeacher || !plan.demoFamily) continue;
    const a = await seedAcademia(prisma, plan.slug, today, {
      demoTeacherEmail: plan.demoTeacher.email,
      reviewerEmail: plan.staff.find((s) => s.role === Role.PRINCIPAL)!.email,
      demoParent: plan.demoFamily.father,
    });
    if (a.lessonPlans || a.threads) {
      console.log(`  ${plan.slug}: ${a.lessonPlans} lesson plans, ${a.threads} chat threads (${a.messages} messages)`);
    }
  }
  // Online fee checkouts behind the demo schools' wallet and 1Bill receipts.
  for (const plan of DEMO_SCHOOLS) {
    const checkouts = await seedOnlinePayments(prisma, plan.slug);
    if (checkouts) console.log(`  ${plan.slug}: ${checkouts} online fee checkouts`);
  }
  console.log(
    `Seeded ${CUSTOMER_SCHOOLS.length} customer schools and the console logins ${PLATFORM_ADMIN.email} (owner) and ${SUPPORT_ADMIN.email} (support)`,
  );
}

await main().finally(() => prisma.$disconnect());
