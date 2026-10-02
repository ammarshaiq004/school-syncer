// Seeds two demo schools with a term's worth of realistic data.
//
//   pnpm prisma:seed            adds the demo schools if they aren't there
//   pnpm prisma:seed --reset    deletes and rebuilds them (other schools are untouched)
//
// Every login uses the password "password123". See README "Demo data" for the list.
import { Gender, PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { localToday } from '../src/common/dates.js';
import { seedSchool, type SchoolPlan } from './demo/school.js';

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
  },
];

/** Deletes a school and everything under it, money and history included. */
async function deleteSchool(slug: string) {
  const school = await prisma.school.findUnique({ where: { slug } });
  if (!school) return;
  const schoolId = school.id;
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
  const reset = process.argv.includes('--reset');
  const today = localToday();
  const passwordHash = await bcrypt.hash('password123', 12);
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
        `${summary.attendanceRecords} attendance records in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }
}

await main().finally(() => prisma.$disconnect());
