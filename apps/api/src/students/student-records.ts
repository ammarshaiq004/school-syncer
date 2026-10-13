import { NotFoundException } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { z } from 'zod';

export const guardianInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(10).max(20),
  email: z.email().toLowerCase().optional(),
  cnic: z.string().trim().max(20).optional(),
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
}

/** Next admission number for the school, e.g. "2026-0042". */
async function nextAdmissionNo(tx: Prisma.TransactionClient, schoolId: string) {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const last = await tx.student.findFirst({
    where: { schoolId, admissionNo: { startsWith: prefix } },
    orderBy: { admissionNo: 'desc' },
    select: { admissionNo: true },
  });
  const seq = last ? Number(last.admissionNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Creates a student, links (or reuses, by phone) their guardians and enrolls
 * them in a section for that section's academic year. Runs inside the caller's
 * transaction so admissions can do it together with updating the application.
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
    // Siblings share guardians, so the same phone number reuses the record.
    const guardian = await tx.guardian.upsert({
      where: { schoolId_phone: { schoolId: input.schoolId, phone: g.phone } },
      update: {},
      create: {
        schoolId: input.schoolId,
        name: g.name,
        phone: g.phone,
        email: g.email,
        cnic: g.cnic,
        occupation: g.occupation,
      },
    });
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
