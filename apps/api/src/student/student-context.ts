import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { AuthUser } from '../common/auth-user.js';

type Db = Pick<PrismaClient, 'student'>;

/** The signed-in student and where they currently sit. */
export interface StudentContext {
  id: string;
  schoolId: string;
  campusId: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  name: string;
  /** null when the student has no active enrollment (e.g. between years). */
  sectionId: string | null;
  classId: string | null;
  academicYearId: string | null;
  rollNo: number | null;
}

/**
 * Resolves the Student behind a STUDENT login from the token's user id. Every
 * student-facing query filters by this id (and its section), never by an id
 * from the request, so a student can only ever see their own data.
 */
export async function resolveStudent(prisma: Db, user: AuthUser): Promise<StudentContext> {
  const student = await prisma.student.findFirst({
    // Left, graduated or suspended students lose the workspace with their status.
    where: { userId: user.sub, schoolId: user.schoolId, status: 'ACTIVE' },
    select: {
      id: true,
      schoolId: true,
      campusId: true,
      admissionNo: true,
      firstName: true,
      lastName: true,
      enrollments: {
        where: { status: 'ACTIVE' },
        // The current year's enrollment first, then the newest.
        orderBy: [{ academicYear: { isCurrent: 'desc' } }, { createdAt: 'desc' }],
        take: 1,
        select: {
          sectionId: true,
          academicYearId: true,
          rollNo: true,
          section: { select: { classId: true } },
        },
      },
    },
  });
  if (!student) throw new NotFoundException('No current student record is linked to this login');
  const enrollment = student.enrollments[0];
  return {
    id: student.id,
    schoolId: student.schoolId,
    campusId: student.campusId,
    admissionNo: student.admissionNo,
    firstName: student.firstName,
    lastName: student.lastName,
    name: [student.firstName, student.lastName].filter(Boolean).join(' '),
    sectionId: enrollment?.sectionId ?? null,
    classId: enrollment?.section.classId ?? null,
    academicYearId: enrollment?.academicYearId ?? null,
    rollNo: enrollment?.rollNo ?? null,
  };
}
