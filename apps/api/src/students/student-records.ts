import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { z } from 'zod';
import { cnicField, nameKey, phoneField, sameName } from '../common/identity.js';

export const guardianInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneField,
  email: z.email().toLowerCase().optional(),
  cnic: cnicField.optional(),
  occupation: z.string().trim().max(80).optional(),
  relation: z.string().trim().min(2).max(30),
  isPrimary: z.boolean().default(false),
});
export type GuardianInput = z.infer<typeof guardianInputSchema>;

export interface NewStudent {
  schoolId: string;
  sectionId: string;
  admissionNo?: string;
  rollNo?: number;
  firstName: string;
  lastName?: string;
  gender: Gender;
  dateOfBirth?: Date;
  bFormNo?: string;
  address?: string;
  medicalNotes?: string;
  guardians: GuardianInput[];
  /** A campus-limited admin's campuses: the section must be at one of them. */
  campuses?: string[] | null;
  /** The user saw the warnings (guardian name clash, likely duplicate) and wants to save anyway. */
  confirmed?: boolean;
}

/**
 * Something to check before a student is saved (SCHOOL-123). A guardian name
 * clash means the phone already belongs to a guardian with another name:
 * saving links this student to that guardian (siblings) and keeps their name;
 * otherwise the user corrects the name or phone. A duplicate is an existing
 * student with the same name, date of birth and guardian phone.
 */
export type StudentWarning =
  | {
      kind: 'guardian_name';
      phone: string;
      givenName: string;
      existingName: string;
      guardianId: string;
      /** Students already linked to that guardian. */
      children: string[];
      message: string;
    }
  | {
      kind: 'duplicate';
      studentId: string;
      name: string;
      admissionNo: string;
      message: string;
    };

const fullName = (s: { firstName: string; lastName?: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

/** Thrown when a save needs the user to confirm warnings first; the body carries them. */
export class NeedsConfirmation extends ConflictException {
  constructor(public readonly warnings: StudentWarning[]) {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: 'NEEDS_CONFIRMATION',
      message: warnings.map((w) => w.message).join(' '),
      warnings,
    });
  }
}

/** Guardians whose phone is already on file under a different name. */
export async function guardianNameWarnings(
  tx: Prisma.TransactionClient,
  schoolId: string,
  guardians: { name: string; phone: string }[],
): Promise<StudentWarning[]> {
  if (!guardians.length) return [];
  const existing = await tx.guardian.findMany({
    where: { schoolId, phone: { in: guardians.map((g) => g.phone) } },
    select: {
      id: true,
      name: true,
      phone: true,
      students: { select: { student: { select: { firstName: true, lastName: true } } } },
    },
  });
  const warnings: StudentWarning[] = [];
  for (const g of guardians) {
    const found = existing.find((e) => e.phone === g.phone);
    if (!found || sameName(found.name, g.name)) continue;
    const children = found.students.map((s) => fullName(s.student));
    warnings.push({
      kind: 'guardian_name',
      phone: g.phone,
      givenName: g.name,
      existingName: found.name,
      guardianId: found.id,
      children,
      message:
        `${g.phone} is already saved for ${found.name}` +
        (children.length ? ` (guardian of ${children.join(', ')})` : '') +
        `, not ${g.name}. Confirm to link this student as a sibling, or correct the name or phone.`,
    });
  }
  return warnings;
}

/** Existing students with the same name, date of birth and a guardian phone in common. */
export async function duplicateWarnings(
  tx: Prisma.TransactionClient,
  schoolId: string,
  s: { firstName: string; lastName?: string; dateOfBirth?: Date; phones: string[] },
): Promise<StudentWarning[]> {
  if (!s.dateOfBirth || !s.phones.length) return [];
  const candidates = await tx.student.findMany({
    where: {
      schoolId,
      dateOfBirth: s.dateOfBirth,
      firstName: { equals: s.firstName, mode: 'insensitive' },
      guardians: { some: { guardian: { phone: { in: s.phones } } } },
    },
    select: { id: true, firstName: true, lastName: true, admissionNo: true },
  });
  const name = nameKey(fullName(s));
  return candidates
    .filter((c) => nameKey(fullName(c)) === name)
    .map((c) => ({
      kind: 'duplicate' as const,
      studentId: c.id,
      name: fullName(c),
      admissionNo: c.admissionNo,
      message: `${fullName(c)} (${c.admissionNo}) has the same name, date of birth and guardian phone. Confirm only if this is a different child.`,
    }));
}

/** Both kinds of warning for one new student. */
export async function studentWarnings(tx: Prisma.TransactionClient, input: NewStudent) {
  return [
    ...(await guardianNameWarnings(tx, input.schoolId, input.guardians)),
    ...(await duplicateWarnings(tx, input.schoolId, {
      ...input,
      phones: input.guardians.map((g) => g.phone),
    })),
  ];
}

/**
 * The same checks for a whole import at once (two queries, not two per row):
 * warning messages by spreadsheet row number.
 */
export async function importWarnings(
  tx: Prisma.TransactionClient,
  schoolId: string,
  rows: { row: number; firstName: string; lastName?: string; dateOfBirth?: Date; guardians: { name: string; phone: string }[] }[],
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  const add = (row: number, message: string) => out.set(row, [...(out.get(row) ?? []), message]);
  const phones = [...new Set(rows.flatMap((r) => r.guardians.map((g) => g.phone)))];
  if (!phones.length) return out;

  const existing = new Map(
    (
      await tx.guardian.findMany({
        where: { schoolId, phone: { in: phones } },
        select: { name: true, phone: true },
      })
    ).map((g) => [g.phone, g.name]),
  );
  for (const r of rows) {
    for (const g of r.guardians) {
      const name = existing.get(g.phone);
      if (name && !sameName(name, g.name)) {
        add(r.row, `Phone ${g.phone} is already saved for ${name}, not ${g.name}; the student will be linked to ${name}`);
      }
    }
  }

  const dated = rows.filter((r) => r.dateOfBirth);
  if (!dated.length) return out;
  const candidates = await tx.student.findMany({
    where: {
      schoolId,
      dateOfBirth: { in: [...new Set(dated.map((r) => r.dateOfBirth!.getTime()))].map((t) => new Date(t)) },
      guardians: { some: { guardian: { phone: { in: phones } } } },
    },
    select: {
      firstName: true,
      lastName: true,
      admissionNo: true,
      dateOfBirth: true,
      guardians: { select: { guardian: { select: { phone: true } } } },
    },
  });
  for (const r of dated) {
    const own = new Set(r.guardians.map((g) => g.phone));
    const name = nameKey(fullName(r));
    const match = candidates.find(
      (c) =>
        c.dateOfBirth?.getTime() === r.dateOfBirth!.getTime() &&
        nameKey(fullName(c)) === name &&
        c.guardians.some((g) => own.has(g.guardian.phone)),
    );
    if (match) add(r.row, `Looks like ${fullName(match)} (${match.admissionNo}), already on file: same name, date of birth and guardian phone`);
  }
  return out;
}

/**
 * Next admission number for the school, e.g. "2026-0042": one more than the
 * highest numbered one this year (compared as numbers, so "2026-10000" follows
 * "2026-9999", and hand-typed numbers such as "2026-A1" are ignored).
 */
async function nextAdmissionNo(tx: Prisma.TransactionClient, schoolId: string) {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const [last] = await tx.$queryRaw<{ seq: bigint | null }[]>`
    SELECT max(substring("admissionNo" from ${prefix.length + 1}::int)::bigint) AS seq
    FROM "Student"
    WHERE "schoolId" = ${schoolId} AND "admissionNo" ~ ${`^${prefix}[0-9]{1,15}$`}`;
  const seq = Number(last?.seq ?? 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * The guardian record for this phone: the existing one (siblings share
 * guardians; blanks on it are filled in, the name is kept) or a new one.
 * Callers check the name first with guardianNameWarnings.
 */
export async function linkGuardian(tx: Prisma.TransactionClient, schoolId: string, g: GuardianInput) {
  const existing = await tx.guardian.findUnique({
    where: { schoolId_phone: { schoolId, phone: g.phone } },
  });
  if (!existing) {
    return tx.guardian.create({
      data: {
        schoolId,
        name: g.name,
        phone: g.phone,
        email: g.email,
        cnic: g.cnic,
        occupation: g.occupation,
      },
    });
  }
  const blanks = {
    ...(!existing.email && g.email ? { email: g.email } : {}),
    ...(!existing.cnic && g.cnic ? { cnic: g.cnic } : {}),
    ...(!existing.occupation && g.occupation ? { occupation: g.occupation } : {}),
  };
  return Object.keys(blanks).length
    ? tx.guardian.update({ where: { id: existing.id }, data: blanks })
    : existing;
}

/** Refuses the same phone twice on one student. */
export function assertDistinctPhones(guardians: { phone: string }[]) {
  if (new Set(guardians.map((g) => g.phone)).size !== guardians.length) {
    throw new BadRequestException('Two guardians have the same phone');
  }
}

/**
 * Holds the school's admission lock until the transaction ends. Admissions
 * read the highest admission and roll numbers and then insert the next ones,
 * so two at once (two office PCs, a double click, an import) would otherwise
 * pick the same numbers.
 */
async function lockAdmissions(tx: Prisma.TransactionClient, schoolId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admission:${schoolId}`}))`;
}

/**
 * Creates a student, links (or reuses, by phone) their guardians and enrolls
 * them in a section for that section's academic year. Runs inside the caller's
 * transaction so admissions can do it together with updating the application.
 * Unless `confirmed`, a guardian name clash or likely duplicate stops the save
 * with NeedsConfirmation.
 */
export async function createStudentRecord(
  tx: Prisma.TransactionClient,
  input: NewStudent,
) {
  const section = await tx.section.findFirst({
    where: { id: input.sectionId, schoolId: input.schoolId },
    include: { class: true },
  });
  if (!section || (input.campuses && !input.campuses.includes(section.class.campusId))) {
    throw new NotFoundException('Section not found');
  }
  assertDistinctPhones(input.guardians);
  if (!input.confirmed) {
    const warnings = await studentWarnings(tx, input);
    if (warnings.length) throw new NeedsConfirmation(warnings);
  }

  await lockAdmissions(tx, input.schoolId);
  if (
    input.admissionNo &&
    (await tx.student.count({ where: { schoolId: input.schoolId, admissionNo: input.admissionNo } }))
  ) {
    throw new ConflictException(`Admission number ${input.admissionNo} is already in use`);
  }
  const admissionNo =
    input.admissionNo ?? (await nextAdmissionNo(tx, input.schoolId));
  const lastRoll = await tx.enrollment.aggregate({
    where: { sectionId: section.id, academicYearId: section.academicYearId },
    _max: { rollNo: true },
  });

  const student = await tx.student.create({
    data: {
      schoolId: input.schoolId,
      campusId: section.class.campusId,
      admissionNo,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      bFormNo: input.bFormNo,
      address: input.address,
      medicalNotes: input.medicalNotes,
      enrollments: {
        create: {
          schoolId: input.schoolId,
          sectionId: section.id,
          academicYearId: section.academicYearId,
          rollNo: input.rollNo ?? (lastRoll._max.rollNo ?? 0) + 1,
        },
      },
    },
  });

  const anyPrimary = input.guardians.some((g) => g.isPrimary);
  for (const [i, g] of input.guardians.entries()) {
    const guardian = await linkGuardian(tx, input.schoolId, g);
    await tx.studentGuardian.create({
      data: {
        studentId: student.id,
        guardianId: guardian.id,
        relation: g.relation,
        isPrimary: anyPrimary ? g.isPrimary : i === 0,
      },
    });
  }
  return student;
}
