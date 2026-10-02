import { Prisma } from '@prisma/client';
import { dateInWords } from './certificate-rules.js';

export const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;
export const fullName = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');
export const classLabel = (
  section: { name: string; class: { name: string } } | undefined,
) => (section ? `${section.class.name} ${section.name}` : null);

/** What a certificate prints, kept as it was on the day it was issued. */
export interface CertificateDetails {
  studentName: string;
  guardianName: string | null;
  guardianRelation: string | null;
  gender: string;
  /** The student's status when it was issued: "was" or "is" a student. */
  status: string;
  admissionNo: string;
  dateOfBirth: string | null;
  dateOfBirthWords: string | null;
  admittedOn: string;
  classAdmitted: string | null;
  className: string | null;
  session: string | null;
  campus: string;
  conduct: string;
  remarks: string | null;
  leavingOn?: string;
  reason?: string | null;
  duesOwed?: number;
}

export const studentInclude = {
  campus: { select: { id: true, name: true, address: true, phone: true } },
  guardians: { include: { guardian: { select: { name: true, phone: true } } } },
  enrollments: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      academicYear: { select: { name: true, endsOn: true } },
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  },
} satisfies Prisma.StudentInclude;

export type StudentRow = Prisma.StudentGetPayload<{
  include: typeof studentInclude;
}>;

/** The father, if listed, else the primary guardian: what certificates print. */
export function guardianOf(student: StudentRow) {
  const father = student.guardians.find((g) => /father/i.test(g.relation));
  const link =
    father ??
    student.guardians.find((g) => g.isPrimary) ??
    student.guardians[0];
  return link
    ? {
        name: link.guardian.name,
        phone: link.guardian.phone,
        relation: link.relation,
      }
    : null;
}

/** What a certificate says about a student today. */
export function certificateDetails(
  student: StudentRow,
  input: { conduct: string; remarks?: string | null },
): CertificateDetails {
  const first = student.enrollments[0];
  const last = student.enrollments.at(-1);
  const guardian = guardianOf(student);
  const dob = iso(student.dateOfBirth);
  return {
    studentName: fullName(student),
    guardianName: guardian?.name ?? null,
    guardianRelation: guardian?.relation ?? null,
    gender: student.gender,
    status: student.status,
    admissionNo: student.admissionNo,
    dateOfBirth: dob,
    dateOfBirthWords: dob ? dateInWords(dob) : null,
    admittedOn: iso(student.admittedOn)!,
    classAdmitted: first?.section.class.name ?? null,
    className: classLabel(last?.section),
    session: last?.academicYear.name ?? null,
    campus: student.campus.name,
    conduct: input.conduct,
    remarks: input.remarks ?? null,
  };
}
