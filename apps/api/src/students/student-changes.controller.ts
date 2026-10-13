import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { StudentStatus } from '@prisma/client';
import { z } from 'zod';
import { adminScope, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { cnicField, phoneField } from '../common/identity.js';
import { UserStatusService } from '../common/user-status.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  guardianInputSchema,
  guardianNameWarnings,
  linkGuardian,
  NeedsConfirmation,
} from './student-records.js';

/** Most guardians one student can have (same as admission). */
const MAX_GUARDIANS = 4;

const updateGuardianSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: phoneField.optional(),
    email: z.email().toLowerCase().nullable().optional(),
    cnic: cnicField.nullable().optional(),
    occupation: z.string().trim().max(80).nullable().optional(),
    /** How this guardian is related to this student (the guardian may have other children). */
    relation: z.string().trim().min(2).max(30).optional(),
    /** Make this the student's primary guardian (the one fee and attendance messages go to first). */
    isPrimary: z.literal(true).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');
type UpdateGuardianInput = z.infer<typeof updateGuardianSchema>;

const addGuardianSchema = guardianInputSchema.extend({
  /** Link to the guardian already saved with this phone despite a different name (siblings). */
  confirmed: z.boolean().default(false),
});
type AddGuardianInput = z.infer<typeof addGuardianSchema>;

const moveSchema = z.object({
  sectionId: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
});
type MoveInput = z.infer<typeof moveSchema>;

const sectionLabel = (s: { name: string; class: { name: string } }) => `${s.class.name} ${s.name}`;

/**
 * Changes to an admitted student's record (SCHOOL-139): their guardians and
 * moving them to another section during the year. Campus-limited admins
 * work only with students on their campuses.
 */
@Controller('students')
@Permission('students')
@Roles(...SETUP_ROLES)
export class StudentChangesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly userStatus: UserStatusService,
  ) {}

  /**
   * Edits a guardian: their own details (shared by every child they are
   * guardian of) and how they relate to this student. A new phone is also
   * the parent's login, so it moves to their account too.
   */
  @Patch(':id/guardians/:guardianId')
  async updateGuardian(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
    @Body(new ZodValidationPipe(updateGuardianSchema)) body: UpdateGuardianInput,
  ) {
    const link = await this.findLink(user, id, guardianId);
    const before = link.guardian;
    const { relation, isPrimary, ...details } = body;
    if (details.phone && details.phone !== before.phone) {
      const taken = await this.prisma.guardian.findFirst({
        where: { schoolId: user.schoolId, phone: details.phone, id: { not: guardianId } },
        select: { name: true },
      });
      if (taken) {
        throw new ConflictException(
          `${details.phone} is already saved for ${taken.name}. Add them as this student's guardian instead.`,
        );
      }
      if (before.userId) {
        const login = await this.prisma.user.findFirst({
          where: { schoolId: user.schoolId, phone: details.phone, id: { not: before.userId } },
          select: { id: true },
        });
        if (login) throw new ConflictException(`Someone at this school already signs in with ${details.phone}`);
      }
    }
    const after = await this.prisma.$transaction(async (tx) => {
      const guardian = await tx.guardian.update({ where: { id: guardianId }, data: details });
      if (before.userId && (details.phone || details.name)) {
        await tx.user.update({ where: { id: before.userId }, data: { phone: details.phone, name: details.name } });
      }
      if (isPrimary) {
        await tx.studentGuardian.updateMany({ where: { studentId: id }, data: { isPrimary: false } });
      }
      const updated = await tx.studentGuardian.update({
        where: { studentId_guardianId: { studentId: id, guardianId } },
        data: { relation, ...(isPrimary ? { isPrimary: true } : {}) },
      });
      return { ...updated, guardian };
    });
    if (before.userId) this.userStatus.forget(before.userId);
    await this.audit.record(user, 'guardian.update', 'Guardian', guardianId, {
      before: { ...before, relation: link.relation, isPrimary: link.isPrimary },
      after: { ...after.guardian, relation: after.relation, isPrimary: after.isPrimary },
    });
    return after;
  }

  /** Adds another guardian (a mother as well as a father, say), or links a sibling's guardian by phone. */
  @Post(':id/guardians')
  async addGuardian(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addGuardianSchema)) body: AddGuardianInput,
  ) {
    const student = await this.findStudent(user, id);
    const links = await this.prisma.studentGuardian.findMany({
      where: { studentId: id },
      include: { guardian: { select: { phone: true } } },
    });
    if (links.length >= MAX_GUARDIANS) {
      throw new BadRequestException(`A student can have up to ${MAX_GUARDIANS} guardians`);
    }
    if (links.some((l) => l.guardian.phone === body.phone)) {
      throw new ConflictException(`${body.phone} is already one of this student's guardians`);
    }
    const { confirmed, ...input } = body;
    const link = await this.prisma.$transaction(async (tx) => {
      if (!confirmed) {
        const warnings = await guardianNameWarnings(tx, user.schoolId, [input]);
        if (warnings.length) throw new NeedsConfirmation(warnings);
      }
      const guardian = await linkGuardian(tx, user.schoolId, input);
      const primary = input.isPrimary || links.length === 0;
      if (primary) {
        await tx.studentGuardian.updateMany({ where: { studentId: id }, data: { isPrimary: false } });
      }
      const created = await tx.studentGuardian.create({
        data: { studentId: student.id, guardianId: guardian.id, relation: input.relation, isPrimary: primary },
      });
      return { ...created, guardian };
    });
    await this.audit.record(user, 'guardian.add', 'Student', id, {
      after: { guardianId: link.guardianId, name: link.guardian.name, phone: link.guardian.phone, relation: link.relation },
    });
    return link;
  }

  /**
   * Removes a guardian from this student. The student keeps at least one; a
   * guardian left with no children and no login is deleted.
   */
  @Delete(':id/guardians/:guardianId')
  async removeGuardian(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('guardianId') guardianId: string) {
    const link = await this.findLink(user, id, guardianId);
    const others = await this.prisma.studentGuardian.findMany({
      where: { studentId: id, guardianId: { not: guardianId } },
      orderBy: { guardian: { createdAt: 'asc' } },
    });
    if (!others.length) {
      throw new BadRequestException('A student needs at least one guardian. Add the new guardian first.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.studentGuardian.delete({ where: { studentId_guardianId: { studentId: id, guardianId } } });
      if (link.isPrimary && !others.some((o) => o.isPrimary)) {
        await tx.studentGuardian.update({
          where: { studentId_guardianId: { studentId: id, guardianId: others[0].guardianId } },
          data: { isPrimary: true },
        });
      }
      const stillLinked = await tx.studentGuardian.count({ where: { guardianId } });
      if (!stillLinked && !link.guardian.userId) await tx.guardian.delete({ where: { id: guardianId } });
    });
    await this.audit.record(user, 'guardian.remove', 'Student', id, {
      before: { guardianId, name: link.guardian.name, phone: link.guardian.phone, relation: link.relation },
    });
    return { removed: true };
  }

  /**
   * Moves a student to another section of the same academic year (a wrong
   * section at admission, splitting a class). The year's enrollment is moved,
   * so attendance, marks and fees already recorded stay with the student; the
   * move itself is kept in the audit log and shown on the profile.
   */
  @Post(':id/move')
  async move(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(moveSchema)) body: MoveInput) {
    const student = await this.findStudent(user, id);
    if (student.status !== StudentStatus.ACTIVE) {
      throw new BadRequestException('Only current students can be moved');
    }
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId: id, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: { section: { include: { class: true } } },
    });
    if (!enrollment) throw new BadRequestException('This student is not in a class this year');
    const target = await this.prisma.section.findFirst({
      where: { id: body.sectionId, schoolId: user.schoolId },
      include: { class: true },
    });
    const scope = adminScope(user);
    if (!target || (scope && !scope.includes(target.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    if (target.id === enrollment.sectionId) throw new BadRequestException('The student is already in this section');
    if (target.academicYearId !== enrollment.academicYearId) {
      throw new BadRequestException('Students move between sections of the same year; use promotions for next year');
    }
    const after = await this.prisma.$transaction(async (tx) => {
      // A free roll number at the end of the new section.
      const last = await tx.enrollment.aggregate({
        where: { sectionId: target.id, academicYearId: target.academicYearId },
        _max: { rollNo: true },
      });
      const moved = await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { sectionId: target.id, rollNo: (last._max.rollNo ?? 0) + 1 },
      });
      if (target.class.campusId !== student.campusId) {
        await tx.student.update({ where: { id }, data: { campusId: target.class.campusId } });
      }
      return moved;
    });
    await this.audit.record(user, 'student.move', 'Student', id, {
      before: {
        sectionId: enrollment.sectionId,
        section: sectionLabel(enrollment.section),
        campusId: student.campusId,
        rollNo: enrollment.rollNo,
      },
      after: {
        sectionId: target.id,
        section: sectionLabel(target),
        campusId: target.class.campusId,
        rollNo: after.rollNo,
        reason: body.reason ?? null,
      },
    });
    return { ...after, section: { id: target.id, name: target.name, class: { name: target.class.name } } };
  }

  private async findStudent(user: AuthUser, id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId },
      select: { id: true, campusId: true, status: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    const scope = adminScope(user);
    if (scope && !scope.includes(student.campusId)) {
      throw new ForbiddenException('Student is at another campus');
    }
    return student;
  }

  private async findLink(user: AuthUser, id: string, guardianId: string) {
    await this.findStudent(user, id);
    const link = await this.prisma.studentGuardian.findUnique({
      where: { studentId_guardianId: { studentId: id, guardianId } },
      include: { guardian: true },
    });
    if (!link) throw new NotFoundException('Guardian not found');
    return link;
  }
}
