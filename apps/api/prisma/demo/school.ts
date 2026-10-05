// Builds one demo school with a term's worth of realistic activity: staff,
// students and families, timetables, attendance, fees and payments, exams,
// homework, payroll and accounts. Everything is relative to today, so the
// data always looks current.
import {
  ApplicationStage,
  AttendanceStatus,
  Audience,
  Channel,
  ConcessionType,
  EntryKind,
  EntryMethod,
  ExamStatus,
  FeeFrequency,
  Gender,
  InvoiceStatus,
  LeaveStatus,
  LeaveType,
  NotificationStatus,
  PaymentMethod,
  PayItemType,
  PayrollStatus,
  Prisma,
  PrismaClient,
  Role,
  SchoolMode,
  VehicleType,
} from '@prisma/client';
import { DEFAULT_BANDS, positions, studentResult } from '../../src/exams/result-calculator.js';
import { invoiceLines, type InvoiceLineDraft } from '../../src/fees/fee-calculator.js';
import { calculatePayslip, workingDays } from '../../src/hr/payroll-calculator.js';
import { daysBefore } from '../../src/common/dates.js';
import { ridesDuring } from '../../src/transport/transport-rules.js';
import { seedCertificates } from './certificates.js';
import { seedEschool, type EschoolPlan, type EschoolSummary } from './eschool.js';
import { seedLibrary } from './library.js';
import {
  BOY_NAMES,
  FATHER_NAMES,
  GIRL_NAMES,
  HOMEWORK,
  MOTHER_NAMES,
  OCCUPATIONS,
  STREETS,
  SURNAMES,
  TEACHER_REMARKS,
  TEACHER_TITLES,
} from './names.js';
import { Random } from './random.js';

export interface ClassPlan {
  name: string;
  /** -2 Playgroup, -1 Nursery, 0 Prep, 1 to 10 for grades. */
  level: number;
  sections: string[];
}

export interface CampusPlan {
  name: string;
  address: string;
  phone: string;
  classes: ClassPlan[];
  /** Fees here are this share of the school's rates, e.g. 0.9. */
  feeFactor: number;
}

export interface StaffLogin {
  name: string;
  email: string;
  role: Role;
  /** Campus name for a campus-scoped role; school-wide when left out. */
  campus?: string;
  designation: string;
  salary: number;
}

export interface SchoolPlan {
  name: string;
  slug: string;
  city: string;
  phone: string;
  email: string;
  emailDomain: string;
  campuses: CampusPlan[];
  /** Named logins for trying each role; teachers are generated on top. */
  staff: StaffLogin[];
  /** The first teacher of this subject at the first campus gets this login. */
  demoTeacher?: { name: string; email: string; subject: string };
  /** A family with children at the first campus and a parent login. */
  demoFamily?: { father: string; surname: string; phone: string; children: { name: string; gender: Gender; className: string }[] };
  studentsPerSection: [number, number];
  /** Monthly tuition for Playgroup; each level above adds `tuitionStep`. */
  tuitionBase: number;
  tuitionStep: number;
  annualCharges: number;
  /** A fixed start for phone numbers so schools don't collide, e.g. "0300". */
  phonePrefix: string;
  /** School vans: about this share of families at the route's campus ride one. */
  transport?: { share: number; routes: RoutePlan[] };
  /** PHYSICAL when left out. An ONLINE school has no rooms, canteen, guards or library. */
  mode?: SchoolMode;
  /** Courses, live classes, coursework and student logins (online and hybrid schools). */
  eschool?: EschoolPlan;
}

export interface RoutePlan {
  campus: string;
  name: string;
  fee: number;
  vehicle: { registrationNo: string; type: VehicleType; capacity: number };
  /** Name, pick-up time, drop time and, for far stops, their own fee. */
  stops: [string, string, string, number?][];
}

export interface SeedSummary {
  schoolId: string;
  certificates: number;
  books: number;
  loans: number;
  students: number;
  staff: number;
  invoices: number;
  attendanceRecords: number;
  eschool: EschoolSummary | null;
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * DAY));
const weekday = (s: string) => day(s).getUTCDay();
const monthOf = (s: string) => s.slice(0, 7);
const at = (s: string, hour: number, minute = 0) =>
  new Date(`${s}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+05:00`);

/** Public holidays a Pakistani school closes for (approximate for Islamic dates). */
const HOLIDAYS = new Set([
  '2026-02-05', '2026-03-23', '2026-03-20', '2026-03-21', '2026-03-22', '2026-05-01', '2026-05-27',
  '2026-05-28', '2026-05-29', '2026-08-14', '2026-08-26', '2026-11-09', '2026-12-25',
  '2027-02-05', '2027-03-10', '2027-03-11', '2027-03-23', '2027-05-01',
]);

/** Summer vacation runs through June and July. */
const isSchoolDay = (s: string) =>
  weekday(s) >= 1 && weekday(s) <= 5 && !HOLIDAYS.has(s) && !['06', '07'].includes(s.slice(5, 7));

function subjectsFor(level: number): [string, number][] {
  // Subject and periods a week, adding up to 30 (six a day, Monday to Friday).
  if (level <= 0) {
    return [['English', 8], ['Urdu', 7], ['Mathematics', 8], ['Nazra Quran', 7]];
  }
  return [
    ['English', 5], ['Urdu', 5], ['Mathematics', 5], ['Science', 4],
    ['Islamiat', 4], ['Social Studies', 4], ['Computer', 3],
  ];
}

const chunk = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

export async function seedSchool(
  prisma: PrismaClient,
  plan: SchoolPlan,
  passwordHash: string,
  today: string,
): Promise<SeedSummary> {
  const rng = new Random(plan.slug);
  let phoneSeq = 1;
  const phone = () => `${plan.phonePrefix}${String(phoneSeq++).padStart(7, '0')}`;
  const cnic = () => `35202-${rng.digits(7)}-${rng.int(1, 9)}`;

  // ----- School, campuses and the academic year -----
  const startYear = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
  const yearStart = `${startYear}-04-01`;
  const school = await prisma.school.create({
    data: {
      name: plan.name,
      slug: plan.slug,
      city: plan.city,
      phone: plan.phone,
      email: plan.email,
      lateFeePerDay: 20,
      feeDueDay: 10,
      mode: plan.mode ?? SchoolMode.PHYSICAL,
    },
  });
  const online = plan.mode === SchoolMode.ONLINE;
  const schoolId = school.id;
  const year = await prisma.academicYear.create({
    data: {
      schoolId,
      name: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
      startsOn: day(yearStart),
      endsOn: day(`${startYear + 1}-03-31`),
      isCurrent: true,
    },
  });
  // Last year exists so history screens have something to show.
  await prisma.academicYear.create({
    data: {
      schoolId,
      name: `${startYear - 1}-${String(startYear % 100).padStart(2, '0')}`,
      startsOn: day(`${startYear - 1}-04-01`),
      endsOn: day(`${startYear}-03-31`),
    },
  });
  const campuses = [];
  for (const c of plan.campuses) {
    campuses.push(
      await prisma.campus.create({ data: { schoolId, name: c.name, address: c.address, phone: c.phone } }),
    );
  }
  const campusByName = new Map(campuses.map((c) => [c.name, c]));

  // ----- Subjects -----
  const subjectNames = [...new Set(plan.campuses.flatMap((c) => c.classes.flatMap((k) => subjectsFor(k.level).map(([s]) => s))))];
  const subjects = await prisma.subject.createManyAndReturn({
    data: subjectNames.map((name) => ({ schoolId, name, code: name.slice(0, 3).toUpperCase() })),
  });
  const subjectId = new Map(subjects.map((s) => [s.name, s.id]));

  // ----- Named staff logins -----
  interface StaffMember {
    id: string;
    name: string;
    designation: string;
    department: string;
    salary: number;
    campusId: string | null;
    joinedOn: string;
  }
  const staff: StaffMember[] = [];
  const createUser = async (
    name: string,
    email: string | null,
    roles: { role: Role; campusId?: string | null }[],
  ) =>
    prisma.user.create({
      data: {
        schoolId,
        name,
        email,
        phone: phone(),
        passwordHash,
        roles: { create: roles.map((r) => ({ role: r.role, campusId: r.campusId ?? null })) },
      },
    });
  const joined = () => `${rng.int(2014, startYear)}-${String(rng.int(1, 12)).padStart(2, '0')}-01`;

  for (const s of plan.staff) {
    const campusId = s.campus ? campusByName.get(s.campus)!.id : null;
    const user = await createUser(s.name, s.email, [{ role: s.role, campusId }]);
    if (s.role !== Role.OWNER) {
      staff.push({
        id: user.id,
        name: s.name,
        designation: s.designation,
        department: 'Administration',
        salary: s.salary,
        campusId,
        joinedOn: joined(),
      });
    }
  }

  // ----- Classes and sections -----
  interface SectionInfo {
    id: string;
    classId: string;
    className: string;
    name: string;
    level: number;
    campusId: string;
    campusIndex: number;
    feeFactor: number;
  }
  const sections: SectionInfo[] = [];
  const classIds = new Map<string, { id: string; level: number; campusId: string; feeFactor: number }>();
  for (const [ci, c] of plan.campuses.entries()) {
    const campus = campuses[ci];
    for (const [order, k] of c.classes.entries()) {
      const cls = await prisma.class.create({
        data: {
          schoolId,
          campusId: campus.id,
          name: k.name,
          sortOrder: order,
          sections: {
            create: k.sections.map((name) => ({ schoolId, academicYearId: year.id, name, capacity: 30 })),
          },
        },
        include: { sections: true },
      });
      classIds.set(`${campus.id}|${k.name}`, { id: cls.id, level: k.level, campusId: campus.id, feeFactor: c.feeFactor });
      for (const s of cls.sections) {
        sections.push({
          id: s.id,
          classId: cls.id,
          className: k.name,
          name: s.name,
          level: k.level,
          campusId: campus.id,
          campusIndex: ci,
          feeFactor: c.feeFactor,
        });
      }
    }
  }

  // ----- Teachers: enough subject specialists per campus for every period -----
  const PERIODS_PER_TEACHER = 25;
  interface Teacher extends StaffMember {
    subject: string;
    load: number;
  }
  const teachers: Teacher[] = [];
  const usedNames = new Set<string>();
  const personName = (female: boolean) => {
    for (;;) {
      const n = `${rng.pick(female ? GIRL_NAMES : BOY_NAMES)} ${rng.pick(SURNAMES)}`;
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
  };
  const emailFor = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${plan.emailDomain}`;

  for (const [ci, campus] of campuses.entries()) {
    const load = new Map<string, number>();
    for (const s of sections.filter((x) => x.campusIndex === ci)) {
      for (const [subject, periods] of subjectsFor(s.level)) load.set(subject, (load.get(subject) ?? 0) + periods);
    }
    for (const [subject, periods] of load) {
      const count = Math.ceil(periods / PERIODS_PER_TEACHER);
      for (let i = 0; i < count; i++) {
        const demo = ci === 0 && i === 0 && plan.demoTeacher?.subject === subject ? plan.demoTeacher : undefined;
        // Most primary teachers in Pakistani private schools are women.
        const name = demo?.name ?? personName(rng.chance(subject === 'Nazra Quran' ? 0.2 : 0.75));
        const user = await createUser(name, demo?.email ?? emailFor(name), [{ role: Role.TEACHER, campusId: campus.id }]);
        teachers.push({
          id: user.id,
          name,
          designation: TEACHER_TITLES[subject] ?? 'Teacher',
          department: subject === 'Nazra Quran' ? 'Islamic studies' : 'Academics',
          salary: rng.int(7, 12) * 5000,
          campusId: campus.id,
          joinedOn: joined(),
          subject,
          load: 0,
        });
      }
    }
  }
  staff.push(...teachers);

  // Support staff, on payroll without much to do in the portal.
  const support = online
    ? ([['Office assistant', 28000], ['IT support officer', 55000]] as const)
    : ([['Office assistant', 28000], ['Security guard', 32000], ['Driver', 35000], ['Cleaner', 25000]] as const);
  for (const [title, salary] of support) {
    const name = personName(title === 'Cleaner' && rng.chance(0.5));
    const user = await createUser(name, null, [{ role: Role.STAFF, campusId: campuses[0].id }]);
    staff.push({ id: user.id, name, designation: title, department: 'Support', salary, campusId: campuses[0].id, joinedOn: joined() });
  }

  // ----- Who teaches what, and class teachers -----
  const teacherOf = new Map<string, Teacher>(); // `${sectionId}|${subject}`
  for (const s of sections) {
    for (const [subject, periods] of subjectsFor(s.level)) {
      const pool = teachers.filter((t) => t.campusId === s.campusId && t.subject === subject);
      const t = pool.reduce((a, b) => (b.load < a.load ? b : a));
      t.load += periods;
      teacherOf.set(`${s.id}|${subject}`, t);
    }
  }
  await prisma.sectionSubject.createMany({
    data: sections.flatMap((s) =>
      subjectsFor(s.level).map(([subject]) => ({
        schoolId,
        sectionId: s.id,
        subjectId: subjectId.get(subject)!,
        teacherId: teacherOf.get(`${s.id}|${subject}`)!.id,
      })),
    ),
  });
  // The English (or early-years English) teacher is the class teacher; one section each.
  const classTeacher = new Map<string, Teacher>();
  const busy = new Set<string>();
  for (const s of sections) {
    const candidates = subjectsFor(s.level)
      .map(([subject]) => teacherOf.get(`${s.id}|${subject}`)!)
      .filter((t) => !busy.has(t.id));
    const t = candidates[0];
    if (!t) continue;
    busy.add(t.id);
    classTeacher.set(s.id, t);
    await prisma.section.update({ where: { id: s.id }, data: { classTeacherId: t.id } });
  }
  if (plan.demoTeacher) {
    // The demo teacher is class teacher of the first section they teach, for trying remarks.
    const demo = teachers.find((t) => t.name === plan.demoTeacher!.name)!;
    const own = sections.find((s) => teacherOf.get(`${s.id}|${demo.subject}`) === demo && classTeacher.get(s.id) !== demo);
    if (own && ![...classTeacher.values()].includes(demo)) {
      classTeacher.set(own.id, demo);
      await prisma.section.update({ where: { id: own.id }, data: { classTeacherId: demo.id } });
    }
  }

  // ----- Bell schedule and timetable -----
  const bell = [
    ['Period 1', '08:00', '08:40'],
    ['Period 2', '08:40', '09:20'],
    ['Period 3', '09:20', '10:00'],
    ['Break', '10:00', '10:30'],
    ['Period 4', '10:30', '11:10'],
    ['Period 5', '11:10', '11:50'],
    ['Period 6', '11:50', '12:30'],
  ] as const;
  const teachingPeriods = new Map<string, string[]>();
  for (const campus of campuses) {
    const periods = await prisma.period.createManyAndReturn({
      data: bell.map(([name, startTime, endTime], i) => ({
        schoolId,
        campusId: campus.id,
        name,
        startTime,
        endTime,
        sortOrder: i + 1,
        isBreak: name === 'Break',
      })),
    });
    teachingPeriods.set(
      campus.id,
      periods.filter((p) => !p.isBreak).sort((a, b) => a.sortOrder - b.sortOrder).map((p) => p.id),
    );
  }
  const teacherBusy = new Set<string>(); // `${teacherId}|${day}|${periodId}`
  const slots: Prisma.TimetableSlotCreateManyInput[] = [];
  for (const s of sections) {
    const periodIds = teachingPeriods.get(s.campusId)!;
    const free = [1, 2, 3, 4, 5].flatMap((d) => periodIds.map((p, k) => ({ d, p, k })));
    // Spread each subject across the week: English and Maths early in the day.
    const queue = subjectsFor(s.level).flatMap(([subject, n]) => Array.from({ length: n }, () => subject));
    const placed = new Set<string>();
    for (const subject of queue) {
      const t = teacherOf.get(`${s.id}|${subject}`)!;
      const options = rng.shuffle(free.filter((f) => !placed.has(`${f.d}|${f.p}`)));
      const sameDay = (d: number) => slots.filter((x) => x.sectionId === s.id && x.dayOfWeek === d && x.subjectId === subjectId.get(subject)).length;
      const good =
        options.find((f) => !teacherBusy.has(`${t.id}|${f.d}|${f.p}`) && sameDay(f.d) === 0) ??
        options.find((f) => !teacherBusy.has(`${t.id}|${f.d}|${f.p}`)) ??
        options[0];
      const withTeacher = !teacherBusy.has(`${t.id}|${good.d}|${good.p}`);
      if (withTeacher) teacherBusy.add(`${t.id}|${good.d}|${good.p}`);
      placed.add(`${good.d}|${good.p}`);
      slots.push({
        schoolId,
        sectionId: s.id,
        dayOfWeek: good.d,
        periodId: good.p,
        subjectId: subjectId.get(subject)!,
        teacherId: withTeacher ? t.id : null,
        room: online ? null : `Room ${s.level + 3}${s.name}`,
      });
    }
  }
  await prisma.timetableSlot.createMany({ data: slots });

  // ----- Families and students -----
  interface Kid {
    id: string;
    name: string;
    sectionId: string;
    level: number;
    familyIndex: number;
    ability: number;
    absentRate: number;
  }
  interface Family {
    guardianId: string;
    father: string;
    phone: string;
    defaulter: boolean;
    staffChild: boolean;
  }
  const families: Family[] = [];
  const kids: Kid[] = [];

  // Seats per section, then fill them family by family so siblings land in different classes.
  const seats = sections.flatMap((s) => {
    const n = rng.int(plan.studentsPerSection[0], plan.studentsPerSection[1]);
    return Array.from({ length: n }, () => s);
  });
  let open = rng.shuffle(seats);
  const admissionSeq = new Map<number, number>();
  const admissionNo = (admitYear: number) => {
    const n = (admissionSeq.get(admitYear) ?? 0) + 1;
    admissionSeq.set(admitYear, n);
    return `${admitYear}-${String(n).padStart(4, '0')}`;
  };

  interface PendingKid {
    first: string;
    gender: Gender;
    section: SectionInfo;
  }
  const familyPlans: { father: string; surname: string; phone?: string; kids: PendingKid[] }[] = [];
  if (plan.demoFamily) {
    const demoKids = plan.demoFamily.children.map((c) => {
      const section = sections.find((s) => s.campusIndex === 0 && s.className === c.className)!;
      const seat = open.indexOf(section);
      if (seat >= 0) open.splice(seat, 1);
      return { first: c.name, gender: c.gender, section };
    });
    familyPlans.push({ father: plan.demoFamily.father, surname: plan.demoFamily.surname, phone: plan.demoFamily.phone, kids: demoKids });
  }
  while (open.length) {
    const size = Math.min(open.length, rng.chance(0.7) ? 1 : rng.chance(0.8) ? 2 : 3);
    const picked: SectionInfo[] = [];
    for (const seat of open) {
      if (picked.length === size) break;
      // Siblings go to the same campus, different classes.
      if (picked.length && (seat.campusId !== picked[0].campusId || picked.some((p) => p.classId === seat.classId))) continue;
      picked.push(seat);
    }
    for (const p of picked) open.splice(open.indexOf(p), 1);
    const surname = rng.pick(SURNAMES);
    familyPlans.push({
      father: `${rng.pick(FATHER_NAMES)} ${surname}`,
      surname,
      kids: picked.map((section) => {
        const gender = rng.chance(0.5) ? Gender.MALE : Gender.FEMALE;
        return { first: rng.pick(gender === Gender.MALE ? BOY_NAMES : GIRL_NAMES), gender, section };
      }),
    });
  }
  open = [];

  const guardianRows = familyPlans.map((f) => ({
    schoolId,
    name: f.father,
    phone: f.phone ?? phone(),
    cnic: cnic(),
    occupation: rng.pick(OCCUPATIONS),
  }));
  const mothers = familyPlans.map((f) => ({
    schoolId,
    name: `${rng.pick(MOTHER_NAMES)} ${f.surname}`,
    phone: phone(),
  }));
  const guardians = await prisma.guardian.createManyAndReturn({ data: guardianRows });
  const motherGuardians = await prisma.guardian.createManyAndReturn({ data: mothers });
  const guardianByPhone = new Map(guardians.map((g) => [g.phone, g]));
  const motherByPhone = new Map(motherGuardians.map((g) => [g.phone, g]));

  const studentRows: Prisma.StudentCreateManyInput[] = [];
  const pending: { familyIndex: number; section: SectionInfo; first: string }[] = [];
  for (const [fi, f] of familyPlans.entries()) {
    const address = `House ${rng.int(1, 450)}, Block ${rng.pick(['A', 'B', 'C', 'D', 'E', 'G', 'J', 'K'])}, ${rng.pick(STREETS)}, ${plan.city}`;
    families.push({
      guardianId: guardianByPhone.get(guardianRows[fi].phone)!.id,
      father: f.father,
      phone: guardianRows[fi].phone,
      defaulter: fi > 0 && rng.chance(0.07),
      staffChild: fi > 0 && rng.chance(0.03),
    });
    for (const k of f.kids) {
      const age = k.section.level + 5;
      const born = `${startYear - age}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
      const admitYear = Math.max(startYear - (k.section.level + 2) + rng.int(0, 2), startYear - 10, 2016);
      const admitted = Math.min(admitYear, startYear);
      studentRows.push({
        schoolId,
        campusId: k.section.campusId,
        admissionNo: admissionNo(admitted),
        firstName: k.first,
        lastName: f.surname,
        gender: k.gender,
        dateOfBirth: day(born),
        bFormNo: `${rng.digits(5)}-${rng.digits(7)}-${rng.int(1, 9)}`,
        address,
        medicalNotes: rng.chance(0.04) ? rng.pick(['Asthma; keeps an inhaler in the bag', 'Allergic to peanuts', 'Wears glasses']) : null,
        admittedOn: day(admitted === startYear ? yearStart : `${admitted}-04-01`),
      });
      pending.push({ familyIndex: fi, section: k.section, first: k.first });
    }
  }
  const students = await prisma.student.createManyAndReturn({
    data: studentRows,
    select: { id: true, firstName: true, lastName: true, admissionNo: true },
  });

  // Roll numbers in alphabetical order within each section, as registers are kept.
  const bySection = new Map<string, number[]>();
  pending.forEach((p, i) => bySection.set(p.section.id, [...(bySection.get(p.section.id) ?? []), i]));
  const enrollments: Prisma.EnrollmentCreateManyInput[] = [];
  for (const [sectionId, idx] of bySection) {
    idx.sort((a, b) => `${students[a].firstName} ${students[a].lastName}`.localeCompare(`${students[b].firstName} ${students[b].lastName}`));
    idx.forEach((i, n) => enrollments.push({ schoolId, studentId: students[i].id, sectionId, academicYearId: year.id, rollNo: n + 1 }));
  }
  await prisma.enrollment.createMany({ data: enrollments });
  await prisma.studentGuardian.createMany({
    data: pending.flatMap((p, i) => [
      { studentId: students[i].id, guardianId: families[p.familyIndex].guardianId, relation: 'Father', isPrimary: true },
      {
        studentId: students[i].id,
        guardianId: motherByPhone.get(mothers[p.familyIndex].phone)!.id,
        relation: 'Mother',
        isPrimary: false,
      },
    ]),
  });
  const familyRank = (familyIndex: number, index: number) =>
    pending.slice(0, index).filter((x) => x.familyIndex === familyIndex).length;
  pending.forEach((p, i) => {
    const chronic = rng.chance(0.05);
    kids.push({
      id: students[i].id,
      name: `${students[i].firstName} ${students[i].lastName}`,
      sectionId: p.section.id,
      level: p.section.level,
      familyIndex: p.familyIndex,
      // The demo family's children do well, so their report cards are worth showing.
      ability:
        plan.demoFamily && p.familyIndex === 0
          ? [0.88, 0.8, 0.74][familyRank(p.familyIndex, i)] ?? 0.8
          : Math.min(0.97, Math.max(0.3, rng.normal(0.7, 0.13))),
      absentRate: chronic ? rng.int(12, 25) / 100 : rng.int(1, 5) / 100,
    });
  });

  // Parent logins for a handful of families, the demo family first.
  const loginFamilies = families.slice(0, plan.demoFamily ? 1 : 0).concat(rng.shuffle(families.slice(1)).slice(0, 5));
  for (const f of loginFamilies) {
    const parent = await createUser(f.father, null, [{ role: Role.PARENT }]);
    await prisma.user.update({ where: { id: parent.id }, data: { phone: f.phone } });
    await prisma.guardian.update({ where: { id: f.guardianId }, data: { userId: parent.id } });
  }

  // ----- Transport: vans, routes and the families who use them -----
  // A family rides from one stop; rides are billed on every voucher below.
  const rides = new Map<string, { startsOn: string; endsOn: string | null; fee: number }>();
  if (plan.transport) {
    const kidsByFamilyIndex = new Map<number, Kid[]>();
    for (const k of kids) kidsByFamilyIndex.set(k.familyIndex, [...(kidsByFamilyIndex.get(k.familyIndex) ?? []), k]);
    const familyCampus = (fi: number) => sections.find((x) => x.id === kidsByFamilyIndex.get(fi)![0].sectionId)!.campusIndex;
    const takenFamilies = new Set<number>();
    for (const r of plan.transport.routes) {
      const campusIndex = plan.campuses.findIndex((c) => c.name === r.campus);
      const vehicle = await prisma.vehicle.create({
        data: {
          schoolId,
          ...r.vehicle,
          driverName: `${rng.pick(FATHER_NAMES)} ${rng.pick(SURNAMES)}`,
          driverPhone: phone(),
          driverCnic: cnic(),
          conductorName: r.vehicle.type === VehicleType.VAN ? null : `${rng.pick(FATHER_NAMES)} ${rng.pick(SURNAMES)}`,
        },
      });
      const route = await prisma.transportRoute.create({
        data: { schoolId, campusId: campuses[campusIndex].id, name: r.name, vehicleId: vehicle.id, monthlyFee: r.fee },
      });
      const stops = await prisma.routeStop.createManyAndReturn({
        data: r.stops.map(([name, pickupTime, dropTime, fee], position) => ({
          routeId: route.id,
          name,
          position,
          pickupTime,
          dropTime,
          monthlyFee: fee ?? null,
        })),
      });
      stops.sort((a, b) => a.position - b.position);
      // Fill the van to roughly the school's share, family by family; the demo family rides the first route.
      const candidates = [...kidsByFamilyIndex.keys()].filter((fi) => familyCampus(fi) === campusIndex && !takenFamilies.has(fi));
      const order = [...(candidates.includes(0) && !takenFamilies.size ? [0] : []), ...rng.shuffle(candidates.filter((fi) => fi !== 0))];
      const seats = Math.min(r.vehicle.capacity - 1, Math.round(r.vehicle.capacity * (0.75 + rng.next() * 0.25)));
      const rows: Prisma.TransportAssignmentCreateManyInput[] = [];
      for (const fi of order) {
        const members = kidsByFamilyIndex.get(fi)!;
        if (rows.length + members.length > seats) continue;
        if (fi !== 0 && !rng.chance(plan.transport.share * 3)) continue;
        takenFamilies.add(fi);
        const stop = rng.pick(stops);
        // Most started with the year; some joined later and a few have since stopped.
        const joined = daysBefore(today, rng.int(20, 150));
        const startsOn = rng.chance(0.8) || joined < yearStart ? yearStart : joined;
        const stopped = fi !== 0 && rng.chance(0.06) && startsOn < daysBefore(today, 40);
        const endsOn = stopped ? daysBefore(today, rng.int(10, 35)) : null;
        for (const k of members) {
          rows.push({ schoolId, studentId: k.id, routeId: route.id, stopId: stop.id, startsOn: day(startsOn), endsOn: endsOn ? day(endsOn) : null });
          rides.set(k.id, { startsOn, endsOn, fee: stop.monthlyFee ?? r.fee });
        }
      }
      await prisma.transportAssignment.createMany({ data: rows });
    }
  }
  const transportHead = rides.size ? await prisma.feeHead.create({ data: { schoolId, name: 'Transport' } }) : null;

  // ----- Fees -----
  const tuition = await prisma.feeHead.create({ data: { schoolId, name: 'Tuition' } });
  const annual = await prisma.feeHead.create({ data: { schoolId, name: 'Annual charges', frequency: FeeFrequency.ANNUAL } });
  const lab = await prisma.feeHead.create({ data: { schoolId, name: 'Computer lab' } });
  await prisma.feeHead.create({ data: { schoolId, name: 'Admission', frequency: FeeFrequency.ONE_TIME } });
  const structures: { classId: string; feeHeadId: string; feeHeadName: string; frequency: FeeFrequency; amount: number }[] = [];
  for (const cls of classIds.values()) {
    const tuitionAmount = Math.round(((plan.tuitionBase + (cls.level + 2) * plan.tuitionStep) * cls.feeFactor) / 100) * 100;
    structures.push({ classId: cls.id, feeHeadId: tuition.id, feeHeadName: 'Tuition', frequency: FeeFrequency.MONTHLY, amount: tuitionAmount });
    structures.push({ classId: cls.id, feeHeadId: annual.id, feeHeadName: 'Annual charges', frequency: FeeFrequency.ANNUAL, amount: plan.annualCharges });
    if (cls.level >= 3) {
      structures.push({ classId: cls.id, feeHeadId: lab.id, feeHeadName: 'Computer lab', frequency: FeeFrequency.MONTHLY, amount: 500 });
    }
  }
  await prisma.feeStructure.createMany({
    data: structures.map((s) => ({ schoolId, classId: s.classId, feeHeadId: s.feeHeadId, academicYearId: year.id, amount: s.amount })),
  });

  // Concessions: siblings, staff children and a few merit scholarships.
  const concessions: Prisma.ConcessionCreateManyInput[] = [];
  const kidsByFamily = new Map<number, Kid[]>();
  for (const k of kids) kidsByFamily.set(k.familyIndex, [...(kidsByFamily.get(k.familyIndex) ?? []), k]);
  for (const [fi, members] of kidsByFamily) {
    members.forEach((k, n) => {
      if (families[fi].staffChild) {
        concessions.push({ studentId: k.id, feeHeadId: tuition.id, type: ConcessionType.PERCENT, value: 50, reason: 'Staff child' });
      } else if (n > 0) {
        concessions.push({ studentId: k.id, feeHeadId: tuition.id, type: ConcessionType.PERCENT, value: 10, reason: 'Sibling discount' });
      } else if (k.ability > 0.9 && rng.chance(0.4)) {
        concessions.push({ studentId: k.id, feeHeadId: tuition.id, type: ConcessionType.PERCENT, value: 25, reason: 'Merit scholarship' });
      }
    });
  }
  await prisma.concession.createMany({ data: concessions });

  const accountant = staff.find((s) => plan.staff.some((p) => p.role === Role.ACCOUNTANT && p.name === s.name));
  const months: string[] = [];
  for (let m = monthOf(yearStart); m <= monthOf(today); ) {
    months.push(m);
    const [y, mm] = m.split('-').map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  }
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const code = (n: number) => Array.from({ length: n }, () => '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[rng.int(0, 31)]).join('');
  const invoiceRows: Prisma.InvoiceCreateManyInput[] = [];
  const invoiceLinesByIndex: InvoiceLineDraft[][] = [];
  const paymentsByIndex: Omit<Prisma.PaymentCreateManyInput, 'invoiceId'>[][] = [];
  const reference = new Set<string>();
  const methods: [PaymentMethod, number][] = [
    [PaymentMethod.CASH, 0.48], [PaymentMethod.BANK, 0.24], [PaymentMethod.JAZZCASH, 0.13],
    [PaymentMethod.EASYPAISA, 0.09], [PaymentMethod.ONEBILL, 0.06],
  ];
  const method = () => {
    let r = rng.next();
    for (const [m, p] of methods) if ((r -= p) < 0) return m;
    return PaymentMethod.CASH;
  };
  const studentConcessions = new Map<string, Prisma.ConcessionCreateManyInput[]>();
  for (const c of concessions) studentConcessions.set(c.studentId, [...(studentConcessions.get(c.studentId) ?? []), c]);

  for (const k of kids) {
    const section = sectionById.get(k.sectionId)!;
    const family = families[k.familyIndex];
    const unpaidFrom = family.defaulter ? months.length - 1 - rng.int(1, 3) : Infinity;
    for (const [mi, period] of months.entries()) {
      const ride = rides.get(k.id);
      const rode = ride && ridesDuring({ startsOn: day(ride.startsOn), endsOn: ride.endsOn ? day(ride.endsOn) : null }, period);
      const lines = invoiceLines(
        structures
          .filter((s) => s.classId === section.classId)
          .concat(rode && transportHead ? [{ classId: section.classId, feeHeadId: transportHead.id, feeHeadName: 'Transport', frequency: FeeFrequency.MONTHLY, amount: ride.fee }] : []),
        (studentConcessions.get(k.id) ?? []).map((c) => ({ feeHeadId: c.feeHeadId, type: c.type, value: c.value })),
        mi === 0,
      );
      const total = lines.reduce((sum, l) => sum + l.amount, 0);
      const dueDate = `${period}-10`;
      const isCurrent = period === monthOf(today);
      const payments: Omit<Prisma.PaymentCreateManyInput, 'invoiceId'>[] = [];
      let paid = 0;
      const pay = (amount: number, date: string) => {
        const m = method();
        let ref: string | null = null;
        if (m !== PaymentMethod.CASH) {
          do ref = `${m === PaymentMethod.BANK ? 'FT' : 'TX'}${rng.digits(10)}`;
          while (reference.has(ref));
          reference.add(ref);
        }
        payments.push({
          schoolId,
          amount,
          method: m,
          reference: ref,
          receiptNo: `R-${code(8)}`,
          receivedAt: date === today ? at(date, 8, rng.int(0, 30)) : at(date, rng.int(8, 13), rng.int(0, 59)),
          receivedById: m === PaymentMethod.CASH ? accountant?.id : null,
        });
        paid += amount;
      };
      if (isCurrent) {
        // The month has just been billed; early payers only.
        const dayOfMonth = Number(today.slice(8, 10));
        if (rng.chance(Math.min(0.85, dayOfMonth * 0.07))) {
          pay(total, `${period}-${String(rng.int(1, dayOfMonth)).padStart(2, '0')}`);
        }
      } else if (mi >= unpaidFrom) {
        // Defaulting family: nothing paid lately.
      } else if (rng.chance(0.04)) {
        pay(Math.round((total * rng.int(3, 7)) / 1000) * 100, `${period}-${String(rng.int(3, 12)).padStart(2, '0')}`);
      } else {
        const late = rng.chance(0.12);
        pay(total, `${period}-${String(late ? rng.int(11, 25) : rng.int(1, 10)).padStart(2, '0')}`);
      }
      invoiceRows.push({
        schoolId,
        studentId: k.id,
        voucherNo: `${period.replace('-', '')}-${code(6)}`,
        period,
        issueDate: day(`${period}-01`),
        dueDate: day(dueDate),
        total,
        paid,
        status: paid >= total ? InvoiceStatus.PAID : paid > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.UNPAID,
        createdAt: at(`${period}-01`, 7),
      });
      invoiceLinesByIndex.push(lines);
      paymentsByIndex.push(payments);
    }
  }
  const invoiceIds: string[] = [];
  for (const part of chunk(invoiceRows, 2000)) {
    invoiceIds.push(...(await prisma.invoice.createManyAndReturn({ data: part, select: { id: true } })).map((i) => i.id));
  }
  for (const part of chunk(invoiceIds.flatMap((id, i) => invoiceLinesByIndex[i].map((l) => ({ ...l, invoiceId: id }))), 5000)) {
    await prisma.invoiceLine.createMany({ data: part });
  }
  for (const part of chunk(invoiceIds.flatMap((id, i) => paymentsByIndex[i].map((p) => ({ ...p, invoiceId: id }))), 5000)) {
    await prisma.payment.createMany({ data: part });
  }

  // ----- Student attendance -----
  const schoolDays: string[] = [];
  for (let d = yearStart; d <= today; d = addDays(d, 1)) if (isSchoolDay(d)) schoolDays.push(d);
  const sessionRows: Prisma.AttendanceSessionCreateManyInput[] = [];
  for (const d of schoolDays) {
    for (const s of sections) {
      // Today, the registers are still coming in.
      if (d === today && rng.chance(0.3)) continue;
      sessionRows.push({
        schoolId,
        sectionId: s.id,
        date: day(d),
        takenById: classTeacher.get(s.id)?.id ?? null,
        takenAt: at(d, 8, rng.int(5, 40)),
      });
    }
  }
  const sessions: { id: string; sectionId: string; date: Date }[] = [];
  for (const part of chunk(sessionRows, 3000)) {
    sessions.push(...(await prisma.attendanceSession.createManyAndReturn({ data: part, select: { id: true, sectionId: true, date: true } })));
  }
  const kidsBySection = new Map<string, Kid[]>();
  for (const k of kids) kidsBySection.set(k.sectionId, [...(kidsBySection.get(k.sectionId) ?? []), k]);
  const records: Prisma.AttendanceRecordCreateManyInput[] = [];
  const absences: { kid: Kid; date: string }[] = [];
  for (const session of sessions) {
    const date = iso(session.date);
    // Monday after a long weekend and the day before Eid see more absences.
    const bump = weekday(date) === 1 ? 0.015 : 0;
    for (const k of kidsBySection.get(session.sectionId) ?? []) {
      const r = rng.next();
      let status: AttendanceStatus = AttendanceStatus.PRESENT;
      if (r < k.absentRate + bump) status = AttendanceStatus.ABSENT;
      else if (r < k.absentRate + bump + 0.025) status = AttendanceStatus.LATE;
      else if (r < k.absentRate + bump + 0.035) status = AttendanceStatus.LEAVE;
      records.push({
        sessionId: session.id,
        studentId: k.id,
        status,
        note: status === AttendanceStatus.LEAVE ? rng.pick(['Sick', 'Family wedding', 'Doctor’s appointment']) : null,
      });
      if (status === AttendanceStatus.ABSENT) absences.push({ kid: k, date });
    }
  }
  for (const part of chunk(records, 10000)) await prisma.attendanceRecord.createMany({ data: part });

  // ----- Exams: a published first term and a monthly test still being marked -----
  const firstTermEnd = addDays(today, -12);
  const firstTerm = await prisma.exam.create({
    data: {
      schoolId,
      academicYearId: year.id,
      name: `First Term ${startYear}`,
      startsOn: day(addDays(firstTermEnd, -11)),
      endsOn: day(firstTermEnd),
      status: ExamStatus.PUBLISHED,
      publishedAt: at(addDays(today, -4), 15),
    },
  });
  const monthly = await prisma.exam.create({
    data: {
      schoolId,
      academicYearId: year.id,
      name: `Monthly Test ${new Date(day(today)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${today.slice(0, 4)}`,
      startsOn: day(addDays(today, -3)),
      endsOn: day(addDays(today, 4)),
    },
  });
  const resultRows: Prisma.ExamResultCreateManyInput[] = [];
  const markRows: Prisma.MarkCreateManyInput[] = [];
  for (const cls of classIds.values()) {
    const clsSections = sections.filter((s) => s.classId === cls.id);
    const subjectList = subjectsFor(cls.level).map(([s]) => s).sort();
    const termPapers = await prisma.examPaper.createManyAndReturn({
      data: subjectList.map((subject, i) => ({
        examId: firstTerm.id,
        classId: cls.id,
        subjectId: subjectId.get(subject)!,
        maxMarks: 100,
        passMarks: 33,
        date: day(addDays(firstTermEnd, -11 + i)),
      })),
    });
    const monthlyPapers = await prisma.examPaper.createManyAndReturn({
      data: subjectList.slice(0, 3).map((subject) => ({
        examId: monthly.id,
        classId: cls.id,
        subjectId: subjectId.get(subject)!,
        maxMarks: 25,
        passMarks: 9,
      })),
    });
    const subjectOfPaper = new Map(termPapers.map((p) => [p.id, subjects.find((s) => s.id === p.subjectId)!.name]));
    for (const s of clsSections) {
      const sectionKids = kidsBySection.get(s.id) ?? [];
      const sectionMarks = sectionKids.map((k) => ({
        kid: k,
        marks: termPapers.map((p) => {
          const absent = rng.chance(0.008);
          const value = Math.round(Math.min(100, Math.max(8, 100 * rng.normal(k.ability, 0.08))));
          return { paperId: p.id, marks: absent ? null : value, isAbsent: absent };
        }),
      }));
      for (const m of sectionMarks) {
        for (const x of m.marks) {
          markRows.push({
            paperId: x.paperId,
            studentId: m.kid.id,
            marks: x.marks,
            isAbsent: x.isAbsent,
            enteredById: teacherOf.get(`${s.id}|${subjectOfPaper.get(x.paperId)}`)?.id,
          });
        }
      }
      const results = sectionMarks.map((m) => ({
        kid: m.kid,
        ...studentResult(
          termPapers.map((p) => ({ id: p.id, subject: subjectOfPaper.get(p.id)!, maxMarks: p.maxMarks, passMarks: p.passMarks })),
          m.marks,
          DEFAULT_BANDS,
        ),
      }));
      const ranks = positions(results.map((r) => ({ id: r.kid.id, percent: r.percent })));
      for (const r of results) {
        const band = r.percent >= 80 ? 'high' : r.percent >= 55 ? 'mid' : 'low';
        resultRows.push({
          examId: firstTerm.id,
          studentId: r.kid.id,
          sectionId: s.id,
          obtained: r.obtained,
          maxTotal: r.maxTotal,
          percent: r.percent,
          grade: r.grade,
          position: ranks.get(r.kid.id)!,
          passed: r.passed,
          subjects: r.subjects as unknown as Prisma.InputJsonValue,
          teacherRemark: rng.chance(0.8) ? rng.pick(TEACHER_REMARKS[band]) : null,
          principalRemark: ranks.get(r.kid.id)! <= 3 ? 'Congratulations on an excellent result.' : null,
        });
      }
      // Monthly test: the first subject is fully marked, the second half done, the third not started.
      for (const [pi, p] of monthlyPapers.entries()) {
        const share = [1, 0.5, 0][pi];
        for (const k of sectionKids.slice(0, Math.round(sectionKids.length * share))) {
          markRows.push({
            paperId: p.id,
            studentId: k.id,
            marks: Math.round(Math.min(25, Math.max(3, 25 * rng.normal(k.ability, 0.1)))),
          });
        }
      }
    }
  }
  for (const part of chunk(markRows, 10000)) await prisma.mark.createMany({ data: part });
  await prisma.examResult.createMany({ data: resultRows });

  // ----- Homework for the last two weeks -----
  const homework: Prisma.HomeworkCreateManyInput[] = [];
  const recentDays = schoolDays.filter((d) => d <= today).slice(-10);
  const fill = (text: string) =>
    text.replace('{p}', String(rng.int(12, 140))).replace('{n}', String(rng.int(1, 9))).replace('{m}', String(rng.int(1, 6))).replace('{t}', String(rng.int(8, 15)));
  for (const d of recentDays) {
    for (const s of sections) {
      const todays = rng.shuffle(subjectsFor(s.level).map(([x]) => x)).slice(0, rng.int(1, 2));
      for (const subject of todays) {
        let due = addDays(d, 1);
        while (!isSchoolDay(due)) due = addDays(due, 1);
        homework.push({
          schoolId,
          sectionId: s.id,
          subjectId: subjectId.get(subject)!,
          assignedById: teacherOf.get(`${s.id}|${subject}`)!.id,
          title: fill(rng.pick(HOMEWORK[subject])),
          details: rng.chance(0.3) ? 'Do it neatly in the homework copy.' : null,
          dueDate: day(due),
          createdAt: at(d, 12, rng.int(0, 59)),
        });
      }
    }
  }
  await prisma.homework.createMany({ data: homework });

  // ----- HR: staff records, attendance, leave and payroll -----
  const profiles = [];
  for (const [i, s] of staff.entries()) {
    const items: { name: string; type: PayItemType; amount: number }[] = [];
    if (s.salary >= 35000) {
      items.push({ name: 'House rent', type: PayItemType.ALLOWANCE, amount: Math.round((s.salary * 0.2) / 500) * 500 });
      items.push({ name: 'Conveyance', type: PayItemType.ALLOWANCE, amount: 3000 });
      items.push({ name: 'Provident fund', type: PayItemType.DEDUCTION, amount: Math.round((s.salary * 0.05) / 50) * 50 });
    }
    if (s.salary >= 60000) items.push({ name: 'Income tax', type: PayItemType.DEDUCTION, amount: Math.round((s.salary * 0.03) / 50) * 50 });
    items.push({ name: 'EOBI', type: PayItemType.DEDUCTION, amount: 370 });
    profiles.push(
      await prisma.staffProfile.create({
        data: {
          schoolId,
          userId: s.id,
          employeeNo: `EMP-${String(i + 1).padStart(4, '0')}`,
          designation: s.designation,
          department: s.department,
          joinedOn: day(s.joinedOn),
          cnic: cnic(),
          basicSalary: s.salary,
          bankName: rng.pick(['Meezan Bank', 'HBL', 'UBL', 'Allied Bank', 'Bank Alfalah', 'MCB']),
          bankAccount: `PK${rng.digits(2)}XXXX${rng.digits(16)}`,
          payItems: { create: items },
        },
        include: { payItems: true },
      }),
    );
  }

  const leaves: Prisma.LeaveRequestCreateManyInput[] = [];
  const onLeave = new Map<string, LeaveType>(); // `${userId}|${date}`
  for (const s of rng.shuffle(staff).slice(0, Math.max(4, Math.round(staff.length * 0.3)))) {
    const from = rng.pick(schoolDays.filter((d) => d < addDays(today, -3)));
    const days = rng.int(1, 3);
    const to = addDays(from, days - 1);
    const type = rng.pick([LeaveType.CASUAL, LeaveType.CASUAL, LeaveType.SICK, LeaveType.UNPAID]);
    leaves.push({
      schoolId,
      userId: s.id,
      type,
      fromDate: day(from),
      toDate: day(to),
      reason: rng.pick(['Family wedding', 'Fever', 'Child unwell', 'Personal work', 'Out of city']),
      status: LeaveStatus.APPROVED,
      decidedAt: at(addDays(from, -2), 11),
      createdAt: at(addDays(from, -3), 9),
    });
    for (let d = from; d <= to; d = addDays(d, 1)) onLeave.set(`${s.id}|${d}`, type);
  }
  for (const s of rng.shuffle(staff).slice(0, 3)) {
    const from = addDays(today, rng.int(2, 9));
    leaves.push({
      schoolId,
      userId: s.id,
      type: rng.pick([LeaveType.CASUAL, LeaveType.ANNUAL, LeaveType.SICK]),
      fromDate: day(from),
      toDate: day(addDays(from, rng.int(0, 2))),
      reason: rng.pick(['Sister’s wedding', 'Medical check-up', 'Travelling to village']),
      createdAt: at(addDays(today, -1), 10),
    });
  }
  await prisma.leaveRequest.createMany({ data: leaves });

  const staffAttendance: Prisma.StaffAttendanceCreateManyInput[] = [];
  const unpaid = new Map<string, number>(); // `${userId}|${period}`
  const admin = staff.find((s) => plan.staff.some((p) => p.role === Role.ADMIN && p.name === s.name));
  for (const d of schoolDays) {
    if (d === today) continue;
    for (const s of staff) {
      const leave = onLeave.get(`${s.id}|${d}`);
      const r = rng.next();
      const status = leave ? AttendanceStatus.LEAVE : r < 0.02 ? AttendanceStatus.ABSENT : r < 0.07 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
      staffAttendance.push({ schoolId, userId: s.id, date: day(d), status, markedById: admin?.id ?? null });
      if (status === AttendanceStatus.ABSENT || leave === LeaveType.UNPAID) {
        unpaid.set(`${s.id}|${monthOf(d)}`, (unpaid.get(`${s.id}|${monthOf(d)}`) ?? 0) + 1);
      }
    }
  }
  for (const part of chunk(staffAttendance, 10000)) await prisma.staffAttendance.createMany({ data: part });

  for (const period of months.filter((m) => m < monthOf(today))) {
    const [y, m] = period.split('-').map(Number);
    const paidOn = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const run = await prisma.payrollRun.create({
      data: { schoolId, period, status: PayrollStatus.FINALIZED, createdAt: at(`${period}-27`, 10), finalizedAt: at(`${period}-28`, 16) },
    });
    const total = workingDays(period).length;
    await prisma.payslip.createMany({
      data: profiles.map((p) => {
        const slip = calculatePayslip({
          basic: p.basicSalary,
          items: p.payItems,
          unpaidDays: unpaid.get(`${p.userId}|${period}`) ?? 0,
          workingDays: total,
        });
        return {
          runId: run.id,
          userId: p.userId,
          basic: p.basicSalary,
          allowances: slip.allowances,
          deductions: slip.deductions,
          unpaidDays: slip.unpaidDays,
          unpaidDeduction: slip.unpaidDeduction,
          net: slip.net,
          lines: slip.lines as unknown as Prisma.InputJsonValue,
          paidAt: paidOn <= today ? at(paidOn, 11) : null,
          paymentMethod: paidOn <= today ? 'BANK' : null,
        };
      }),
    });
  }

  // ----- Accounts: running costs and other income -----
  const category = async (name: string, kind: EntryKind) =>
    (await prisma.accountCategory.create({ data: { schoolId, name, kind } })).id;
  const cat = {
    electricity: await category('Electricity', EntryKind.EXPENSE),
    gas: await category('Gas', EntryKind.EXPENSE),
    internet: await category('Internet and phone', EntryKind.EXPENSE),
    repairs: await category('Repairs and maintenance', EntryKind.EXPENSE),
    stationery: await category('Stationery and printing', EntryKind.EXPENSE),
    cleaning: await category('Cleaning supplies', EntryKind.EXPENSE),
    events: await category('Events and functions', EntryKind.EXPENSE),
    fuel: await category('Fuel', EntryKind.EXPENSE),
    rent: await category('Building rent', EntryKind.EXPENSE),
    canteen: await category('Canteen rent', EntryKind.INCOME),
    uniform: await category('Uniform and book sales', EntryKind.INCOME),
    forms: await category('Admission forms', EntryKind.INCOME),
  };
  const entries: Prisma.AccountEntryCreateManyInput[] = [];
  const entry = (categoryId: string, kind: EntryKind, amount: number, date: string, party: string, m: EntryMethod = EntryMethod.CASH, campusId: string | null = null) => {
    if (date > today) return;
    entries.push({
      schoolId,
      campusId,
      categoryId,
      kind,
      amount: Math.round(amount / 10) * 10,
      date: day(date),
      party,
      method: m,
      reference: m === EntryMethod.CASH ? null : `${m === EntryMethod.CHEQUE ? 'CHQ' : 'FT'}-${rng.digits(6)}`,
      createdById: accountant?.id ?? null,
      createdAt: at(date, 14),
    });
  };
  for (const period of months) {
    const summer = ['05', '06', '07', '08', '09'].includes(period.slice(5, 7));
    for (const campus of campuses) {
      const size = sections.filter((s) => s.campusId === campus.id).length;
      const power = plan.city === 'Karachi' ? 'K-Electric' : plan.city === 'Faisalabad' ? 'FESCO' : 'LESCO';
      entry(cat.electricity, EntryKind.EXPENSE, size * (summer ? rng.int(9000, 13000) : rng.int(4000, 6000)), `${period}-0${rng.int(5, 9)}`, power, EntryMethod.BANK, campus.id);
      if (online) {
        // An online school's running costs are the office, video and the internet.
        entry(cat.internet, EntryKind.EXPENSE, 18500, `${period}-12`, 'Nayatel business fibre', EntryMethod.BANK, campus.id);
        entry(cat.repairs, EntryKind.EXPENSE, rng.int(4000, 15000), `${period}-${rng.int(11, 26)}`, 'Laptop and headset repairs', EntryMethod.CASH, campus.id);
        continue;
      }
      if (!summer) entry(cat.gas, EntryKind.EXPENSE, size * rng.int(600, 1200), `${period}-1${rng.int(0, 4)}`, 'SNGPL', EntryMethod.BANK, campus.id);
      entry(cat.internet, EntryKind.EXPENSE, 6500, `${period}-12`, 'PTCL Flash Fiber', EntryMethod.BANK, campus.id);
      entry(cat.cleaning, EntryKind.EXPENSE, rng.int(3000, 6000), `${period}-0${rng.int(2, 8)}`, 'Al-Fatah Store', EntryMethod.CASH, campus.id);
      entry(cat.canteen, EntryKind.INCOME, size * 1500, `${period}-05`, 'Canteen contractor', EntryMethod.CASH, campus.id);
      if (rng.chance(0.6)) entry(cat.repairs, EntryKind.EXPENSE, rng.int(2500, 25000), `${period}-${rng.int(11, 26)}`, rng.pick(['Plumber', 'Electrician', 'Carpenter', 'AC technician', 'Painter']), EntryMethod.CASH, campus.id);
      if (campus !== campuses[0]) entry(cat.rent, EntryKind.EXPENSE, 180000, `${period}-01`, 'Building owner', EntryMethod.CHEQUE, campus.id);
    }
    entry(cat.stationery, EntryKind.EXPENSE, rng.int(8000, 20000), `${period}-${rng.int(10, 20)}`, 'Urdu Bazar stationers');
    if (!online) entry(cat.fuel, EntryKind.EXPENSE, rng.int(25000, 40000), `${period}-${rng.int(15, 25)}`, 'PSO petrol pump');
    if (!online && (period.endsWith('-04') || period.endsWith('-08'))) {
      entry(cat.uniform, EntryKind.INCOME, kids.length * rng.int(300, 600), `${period}-0${rng.int(2, 6)}`, 'Uniform counter');
      entry(cat.forms, EntryKind.INCOME, rng.int(40, 90) * 1000, `${period}-1${rng.int(0, 5)}`, 'Front office');
    }
    if (!online && period.endsWith('-08')) entry(cat.events, EntryKind.EXPENSE, 65000, `${period}-13`, 'Independence Day function');
  }
  await prisma.accountEntry.createMany({ data: entries });

  // ----- Admissions pipeline for next session and mid-year joiners -----
  const stages: ApplicationStage[] = [
    ApplicationStage.ENQUIRY, ApplicationStage.ENQUIRY, ApplicationStage.ENQUIRY, ApplicationStage.ENQUIRY,
    ApplicationStage.TEST_SCHEDULED, ApplicationStage.TEST_SCHEDULED, ApplicationStage.TEST_SCHEDULED,
    ApplicationStage.TEST_DONE, ApplicationStage.TEST_DONE, ApplicationStage.INTERVIEW, ApplicationStage.OFFERED,
    ApplicationStage.OFFERED, ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN,
  ];
  const allClasses = [...classIds.values()];
  await prisma.application.createMany({
    data: Array.from({ length: Math.round(kids.length / 25) + stages.length / 2 }, (_, i) => {
      const cls = rng.pick(allClasses);
      const gender = rng.chance(0.5) ? Gender.MALE : Gender.FEMALE;
      const surname = rng.pick(SURNAMES);
      const stage = stages[i % stages.length];
      const created = addDays(today, -rng.int(1, 40));
      return {
        schoolId,
        campusId: cls.campusId,
        classId: cls.id,
        childName: `${rng.pick(gender === Gender.MALE ? BOY_NAMES : GIRL_NAMES)} ${surname}`,
        gender,
        dateOfBirth: day(`${startYear - cls.level - 5}-0${rng.int(1, 9)}-1${rng.int(0, 9)}`),
        previousSchool: cls.level > 0 && rng.chance(0.6) ? rng.pick(['The City School', 'Beaconhouse', 'Allied School', 'Dar-e-Arqam', 'Govt. Primary School']) : null,
        guardianName: `${rng.pick(FATHER_NAMES)} ${surname}`,
        guardianPhone: phone(),
        relation: 'Father',
        source: rng.pick(['Walk-in', 'Facebook', 'Referral', 'Website', 'Banner', 'Instagram']),
        stage,
        testDate: ([ApplicationStage.TEST_SCHEDULED, ApplicationStage.TEST_DONE, ApplicationStage.INTERVIEW, ApplicationStage.OFFERED] as ApplicationStage[]).includes(stage)
          ? at(addDays(today, stage === ApplicationStage.TEST_SCHEDULED ? rng.int(1, 6) : -rng.int(1, 10)), 9)
          : null,
        testScore: ([ApplicationStage.TEST_DONE, ApplicationStage.INTERVIEW, ApplicationStage.OFFERED, ApplicationStage.REJECTED] as ApplicationStage[]).includes(stage)
          ? (stage === ApplicationStage.REJECTED ? rng.int(20, 40) : rng.int(55, 95))
          : null,
        createdAt: at(created, rng.int(9, 15)),
      };
    }),
  });

  // ----- Announcements and the message log -----
  const owner = await prisma.user.findFirst({ where: { schoolId, roles: { some: { role: Role.OWNER } } } });
  const notices: [string, string, Audience, number][] = [
    ['Parent-teacher meeting', 'PTM for all classes will be held on Saturday from 9 am to 12 pm. Report cards of the first term will be shared.', Audience.SCHOOL, 3],
    ['First term examinations', 'First term exams start next Monday. Date sheets have been sent home with students.', Audience.SCHOOL, 26],
    ['Independence Day celebrations', 'Students should come in green and white dress. School will close at 11 am.', Audience.SCHOOL, 50],
    ['Fee submission reminder', 'Kindly clear the fee by the 10th to avoid a late fee of Rs 20 per day.', Audience.SCHOOL, 1],
    ['Dengue awareness', 'Please make sure children wear full sleeves and use mosquito repellent.', Audience.SCHOOL, 15],
  ];
  const onlineNotices: [string, string, Audience, number][] = [
    ['Parent-teacher meeting online', 'Parent-teacher meetings will be held on video call on Saturday from 10 am to 1 pm. Class teachers will share the link.', Audience.SCHOOL, 3],
    ['First term examinations', 'First term exams will be taken online with cameras on. The date sheet is on the noticeboard.', Audience.SCHOOL, 26],
    ['Check your headset and internet', 'Please test your microphone and camera before the first live class each morning.', Audience.SCHOOL, 15],
    ['Fee submission reminder', 'Kindly clear the fee by the 10th to avoid a late fee of Rs 20 per day.', Audience.SCHOOL, 1],
    ['Recordings of live classes', 'Teachers add recordings to past live classes when available, so you can revise anything you missed.', Audience.SCHOOL, 8],
  ];
  await prisma.announcement.createMany({
    data: (online ? onlineNotices : notices).map(([title, body, audience, ago]) => ({
      schoolId,
      title,
      body,
      audience,
      createdById: owner?.id,
      createdAt: at(addDays(today, -ago), 10),
    })),
  });
  const logs: Prisma.NotificationLogCreateManyInput[] = [];
  for (const a of absences.filter((a) => a.date >= addDays(today, -7))) {
    const f = families[a.kid.familyIndex];
    logs.push({
      schoolId,
      channel: Channel.WHATSAPP,
      to: f.phone,
      template: 'attendance.absent',
      body: `Dear parent, ${a.kid.name} was marked absent on ${a.date}. - ${plan.name}`,
      status: rng.chance(0.96) ? NotificationStatus.SENT : NotificationStatus.FAILED,
      error: null,
      createdAt: at(a.date, 9, rng.int(0, 30)),
      sentAt: at(a.date, 9, rng.int(30, 59)),
    });
  }
  await prisma.notificationLog.createMany({ data: logs });

  // ----- Library (not for online schools) -----
  const library = online ? { copies: 0, loans: 0 } : await seedLibrary(
    prisma,
    rng,
    schoolId,
    kids.map((k) => ({ id: k.id, level: k.level, ability: k.ability })),
    rng.shuffle(staff.filter((m) => m.salary > 0).map((m) => m.id)),
    yearStart,
    today,
    { loanDays: 14, finePerDay: 5 },
  );

  // ----- Certificates -----
  const office =
    (await prisma.user.findFirst({ where: { schoolId, roles: { some: { role: Role.PRINCIPAL } } } })) ?? owner;
  const certificates = await seedCertificates(prisma, rng, {
    schoolId,
    issuedById: office!.id,
    academicYearId: year.id,
    yearStart,
    today,
    phone,
  });

  // ----- E-school: logins, courses, live classes, coursework -----
  const eschool = plan.eschool
    ? await seedEschool(prisma, plan.eschool, {
        schoolId,
        slug: plan.slug,
        academicYearId: year.id,
        today,
        now: new Date(),
        passwordHash,
        sections: sections.map((s) => ({ id: s.id, className: s.className, name: s.name, level: s.level })),
        subjectId,
        teacherOf: (sectionId, subject) => teacherOf.get(`${sectionId}|${subject}`)?.id,
        kids: kids.map((k, i) => ({ id: k.id, name: k.name, sectionId: k.sectionId, ability: k.ability, admissionNo: students[i].admissionNo })),
        demoStudentId: plan.demoFamily ? kids[0].id : undefined,
        isSchoolDay,
      })
    : null;

  return {
    schoolId,
    eschool,
    certificates: certificates.certificates,
    books: library.copies,
    loans: library.loans,
    students: kids.length,
    staff: staff.length,
    invoices: invoiceRows.length,
    attendanceRecords: records.length,
  };
}
