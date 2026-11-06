import { normalizeCnic, normalizePhone } from '../common/identity.js';

/** What the controller loads for the school's current year; the checks below are pure. */
export interface HealthSnapshot {
  students: {
    id: string;
    name: string;
    admissionNo: string;
    dateOfBirth: Date | null;
    bFormNo: string | null;
    /** Active enrollment in a current-year section. */
    enrolled: boolean;
    guardianPhones: string[];
  }[];
  enrollments: { studentId: string; sectionId: string; rollNo: number | null }[];
  sections: {
    id: string;
    name: string;
    capacity: number | null;
    enrolled: number;
    hasClassTeacher: boolean;
    subjectsWithoutTeacher: string[];
    lessons: number;
  }[];
  /** Null when the school has not set up fee structures at all (nothing to check). */
  classesWithoutFees: string[] | null;
  /** False when the school has no timetable at all (nothing to check). */
  usesTimetable: boolean;
  staff: { id: string; name: string; phone: string | null }[];
  overpaid: { id: string; voucherNo: string; total: number; paid: number }[];
}

export interface HealthItem {
  id: string;
  label: string;
  detail?: string;
}

export interface HealthCheck {
  key: string;
  title: string;
  /** error: something is wrong or unusable; warning: worth tidying. */
  severity: 'error' | 'warning';
  count: number;
  /** The first few, so the page stays short. */
  items: HealthItem[];
  /** Where in the app it is fixed. */
  href: string;
  help: string;
}

export const SAMPLE_SIZE = 10;

const dupKey = (s: { name: string; dateOfBirth: Date | null }) =>
  s.dateOfBirth ? `${s.name.toLowerCase().replace(/\s+/g, ' ').trim()}|${s.dateOfBirth.toISOString().slice(0, 10)}` : null;

function check(
  key: string,
  title: string,
  severity: HealthCheck['severity'],
  all: HealthItem[],
  href: string,
  help: string,
): HealthCheck {
  return { key, title, severity, count: all.length, items: all.slice(0, SAMPLE_SIZE), href, help };
}

export function runHealthChecks(d: HealthSnapshot): HealthCheck[] {
  const who = (s: HealthSnapshot['students'][number]) => ({ id: s.id, label: s.name, detail: s.admissionNo });
  const sec = (s: HealthSnapshot['sections'][number]) => ({ id: s.id, label: s.name });

  const dupes = new Map<string, HealthSnapshot['students']>();
  for (const s of d.students) {
    const k = dupKey(s);
    if (k) dupes.set(k, [...(dupes.get(k) ?? []), s]);
  }
  const duplicateStudents = [...dupes.values()].filter((g) => g.length > 1).flat();

  const rolls = new Map<string, string[]>();
  for (const e of d.enrollments) {
    if (e.rollNo === null) continue;
    const k = `${e.sectionId}|${e.rollNo}`;
    rolls.set(k, [...(rolls.get(k) ?? []), e.studentId]);
  }
  const names = new Map(d.students.map((s) => [s.id, s]));
  const rollClashes = [...rolls.entries()]
    .filter(([, ids]) => ids.length > 1)
    .flatMap(([k, ids]) => ids.map((id) => ({ id, label: names.get(id)?.name ?? id, detail: `Roll no. ${k.split('|')[1]} is used twice in one section` })));

  const checks: HealthCheck[] = [
    check(
      'students-not-enrolled',
      'Active students with no class this year',
      'error',
      d.students.filter((s) => !s.enrolled).map(who),
      '/students',
      'They do not appear in attendance, exams or fee runs. Enrol them in a section or mark them as left.',
    ),
    check(
      'students-no-guardian',
      'Students with no parent or guardian',
      'error',
      d.students.filter((s) => !s.guardianPhones.length).map(who),
      '/students',
      'Without a guardian there is nobody to message and no parent login.',
    ),
    check(
      'guardian-phone-invalid',
      'Parent phone numbers that are not mobile numbers',
      'warning',
      d.students.filter((s) => s.guardianPhones.length && !s.guardianPhones.some((p) => normalizePhone(p))).map(who),
      '/students',
      'Messages and parent logins need a number like 0300 1234567.',
    ),
    check(
      'student-dob-missing',
      'Students with no date of birth',
      'warning',
      d.students.filter((s) => !s.dateOfBirth).map(who),
      '/students',
      'Certificates and ID cards use the date of birth.',
    ),
    check(
      'student-bform-invalid',
      'Students with a malformed B-Form number',
      'warning',
      d.students.filter((s) => s.bFormNo && !normalizeCnic(s.bFormNo)).map(who),
      '/students',
      'A B-Form number has 13 digits, like 35202-1234567-1.',
    ),
    check(
      'student-duplicates',
      'Possible duplicate students (same name and birth date)',
      'warning',
      duplicateStudents.map(who),
      '/students',
      'Check these are different children, and remove the extra record if not.',
    ),
    check('roll-clashes', 'Roll numbers used twice in a section', 'warning', rollClashes, '/classes', 'Renumber the section on the Classes screen.'),
    check(
      'sections-no-class-teacher',
      'Sections with no class teacher',
      'warning',
      d.sections.filter((s) => !s.hasClassTeacher).map(sec),
      '/classes',
      'The class teacher marks attendance and sees the section by default.',
    ),
    check(
      'sections-subject-no-teacher',
      'Subjects with no teacher in a section',
      'warning',
      d.sections.filter((s) => s.subjectsWithoutTeacher.length).map((s) => ({ ...sec(s), detail: s.subjectsWithoutTeacher.join(', ') })),
      '/classes',
      'Marks entry and the timetable need a teacher for each subject.',
    ),
    check(
      'sections-over-capacity',
      'Sections over their capacity',
      'warning',
      d.sections.filter((s) => s.capacity !== null && s.enrolled > s.capacity).map((s) => ({ ...sec(s), detail: `${s.enrolled} students, capacity ${s.capacity}` })),
      '/classes',
      'Raise the capacity or move students to another section.',
    ),
    check(
      'staff-no-phone',
      'Staff with no phone number',
      'warning',
      d.staff.filter((s) => !s.phone || !normalizePhone(s.phone)).map((s) => ({ id: s.id, label: s.name })),
      '/staff',
      'Payslip and leave alerts go to this number.',
    ),
    check(
      'invoices-overpaid',
      'Vouchers paid for more than they are worth',
      'error',
      d.overpaid.map((i) => ({ id: i.id, label: i.voucherNo, detail: `Rs ${i.paid} paid of Rs ${i.total}` })),
      '/fees',
      'Refund or adjust the voucher so the accounts balance.',
    ),
  ];

  if (d.classesWithoutFees)
    checks.push(
      check(
        'classes-no-fee-structure',
        'Classes with no fee structure this year',
        'error',
        d.classesWithoutFees.map((name) => ({ id: name, label: name })),
        '/fees',
        'Monthly vouchers for these classes will be empty.',
      ),
    );
  if (d.usesTimetable)
    checks.push(
      check(
        'sections-no-timetable',
        'Sections with no timetable',
        'warning',
        d.sections.filter((s) => s.lessons === 0).map(sec),
        '/timetable',
        'Use Auto-generate on the Timetable screen.',
      ),
    );
  return checks;
}

/** 100 when every check is clean; each failing check costs more when it is an error or touches many records. */
export function healthScore(checks: HealthCheck[], students: number): number {
  const penalty = checks.reduce((sum, c) => {
    if (!c.count) return sum;
    const weight = c.severity === 'error' ? 12 : 4;
    const spread = students ? Math.min(1, c.count / Math.max(1, students) * 4) : 1;
    return sum + weight * (0.5 + 0.5 * spread);
  }, 0);
  return Math.max(0, Math.round(100 - penalty));
}
