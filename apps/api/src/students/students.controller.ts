import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Gender, Prisma, Role, StudentStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import {
  campusScope,
  SETUP_ROLES,
  STAFF_ROLES,
} from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { checkImportRows, importRowSchema } from './student-import.js';
import { createStudentRecord, guardianInputSchema } from './student-records.js';

const createStudentSchema = z.object({
  sectionId: z.string().min(1),
  admissionNo: z.string().trim().max(30).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  gender: z.enum(Gender),
  dateOfBirth: z.coerce.date().optional(),
  bFormNo: z.string().trim().max(20).optional(),
  address: z.string().trim().max(250).optional(),
  medicalNotes: z.string().trim().max(500).optional(),
  guardians: z.array(guardianInputSchema).min(1).max(4),
});
type CreateStudentInput = z.infer<typeof createStudentSchema>;

const updateStudentSchema = createStudentSchema
  .omit({ sectionId: true, guardians: true, admissionNo: true })
  .partial()
  .extend({ status: z.enum(StudentStatus).optional() });
type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(3000),
  // false checks the rows and reports problems without saving anything.
  commit: z.boolean().default(false),
});
type ImportInput = z.infer<typeof importSchema>;

@Controller('students')
@Roles(...STAFF_ROLES)
export class StudentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('sectionId') sectionId?: string,
    @Query('classId') classId?: string,
    @Query('search') search?: string,
    @Query('status') status: StudentStatus = StudentStatus.ACTIVE,
  ) {
    const campuses = campusScope(user);
    const where: Prisma.StudentWhereInput = {
      schoolId: user.schoolId,
      status,
      ...(campuses ? { campusId: { in: campuses } } : {}),
      ...(sectionId || classId
        ? {
            enrollments: {
              some: {
                status: 'ACTIVE',
                ...(sectionId ? { sectionId } : { section: { classId } }),
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { admissionNo: { contains: search } },
              { guardians: { some: { guardian: { phone: { contains: search } } } } },
            ],
          }
        : {}),
    };
    return this.prisma.student.findMany({
      where,
      orderBy: [{ firstName: 'asc' }],
      take: 500,
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
          },
        },
        guardians: {
          where: { isPrimary: true },
          include: { guardian: { select: { name: true, phone: true } } },
        },
      },
    });
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        campus: { select: { id: true, name: true } },
        guardians: { include: { guardian: true } },
        enrollments: {
          orderBy: { createdAt: 'desc' },
          include: {
            academicYear: { select: { name: true } },
            section: { select: { id: true, name: true, class: { select: { name: true } } } },
          },
        },
        invoices: { orderBy: { period: 'desc' }, take: 12 },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    const scope = campusScope(user);
    if (scope && !scope.includes(student.campusId)) {
      throw new ForbiddenException('Student is at another campus');
    }
    const attendance = await this.prisma.attendanceRecord.groupBy({
      by: ['status'],
      where: { studentId: id },
      _count: true,
    });
    return {
      ...student,
      attendanceSummary: Object.fromEntries(attendance.map((a) => [a.status, a._count])),
    };
  }

  @Post()
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createStudentSchema)) body: CreateStudentInput,
  ) {
    const student = await this.prisma.$transaction((tx) =>
      createStudentRecord(tx, { ...body, schoolId: user.schoolId }),
    );
    await this.audit.record(user, 'student.create', 'Student', student.id, { after: student });
    return student;
  }

  /**
   * Bulk admission from a spreadsheet, for moving a school over from another
   * system. All rows go in together or none do, so a half-imported class never
   * needs cleaning up.
   */
  @Post('import')
  @Roles(...SETUP_ROLES)
  async import(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importSchema)) body: ImportInput,
  ) {
    const campuses = campusScope(user);
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        academicYear: { isCurrent: true },
        ...(campuses ? { class: { campusId: { in: campuses } } } : {}),
      },
      select: {
        id: true,
        name: true,
        class: { select: { name: true, campus: { select: { name: true } } } },
      },
    });
    const given = body.rows.map((r) => r.admissionNo).filter(Boolean);
    const taken = await this.prisma.student.findMany({
      where: { schoolId: user.schoolId, admissionNo: { in: given } },
      select: { admissionNo: true },
    });
    const rolls = await this.prisma.enrollment.findMany({
      where: { sectionId: { in: sections.map((s) => s.id) }, status: 'ACTIVE', rollNo: { not: null } },
      select: { sectionId: true, rollNo: true },
    });
    const rows = checkImportRows(
      body.rows,
      sections.map((s) => ({
        id: s.id,
        campusName: s.class.campus.name,
        className: s.class.name,
        sectionName: s.name,
      })),
      new Set(taken.map((t) => t.admissionNo)),
      new Set(rolls.map((r) => `${r.sectionId}|${r.rollNo}`)),
    );
    const invalid = rows.filter((r) => r.errors.length).length;
    const summary = {
      valid: rows.length - invalid,
      invalid,
      rows: rows.map(({ row, name, classSection, errors }) => ({ row, name, classSection, errors })),
    };
    if (!body.commit || invalid) return { ...summary, imported: 0 };

    // Rows with their own admission numbers go first, so a generated number
    // never takes one that a later row asks for.
    const students = rows
      .map((r) => r.student!)
      .sort((a, b) => Number(!a.admissionNo) - Number(!b.admissionNo));
    await this.prisma.$transaction(
      async (tx) => {
        for (const s of students) await createStudentRecord(tx, { ...s, schoolId: user.schoolId });
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
    await this.audit.record(user, 'student.import', 'Student', null, { after: { count: students.length } });
    return { ...summary, imported: students.length };
  }

  @Patch(':id')
  @Roles(...SETUP_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStudentSchema)) body: UpdateStudentInput,
  ) {
    const before = await this.prisma.student.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new NotFoundException('Student not found');
    const after = await this.prisma.student.update({ where: { id }, data: body });
    if (body.status && body.status !== StudentStatus.ACTIVE) {
      await this.prisma.enrollment.updateMany({
        where: { studentId: id, status: 'ACTIVE' },
        data: { status: 'LEFT' },
      });
    }
    await this.audit.record(user, 'student.update', 'Student', id, { before, after });
    return after;
  }

  /** Gives a guardian a parent-portal login and sends it to them on WhatsApp. */
  @Post(':id/guardians/:guardianId/invite')
  @Roles(...SETUP_ROLES)
  async inviteGuardian(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
  ) {
    const link = await this.prisma.studentGuardian.findFirst({
      where: { studentId: id, guardianId, student: { schoolId: user.schoolId } },
      include: { guardian: true, student: { include: { school: true } } },
    });
    if (!link) throw new NotFoundException('Guardian not found');
    if (link.guardian.userId) return { invited: false, reason: 'Already has a login' };

    const existing = await this.prisma.user.findUnique({
      where: { schoolId_phone: { schoolId: user.schoolId, phone: link.guardian.phone } },
      include: { roles: true },
    });
    if (existing) {
      // Already signs in (e.g. a staff member who is also a parent): add the role only.
      if (!existing.roles.some((r) => r.role === Role.PARENT)) {
        await this.prisma.roleAssignment.create({ data: { userId: existing.id, role: Role.PARENT } });
      }
      await this.prisma.guardian.update({ where: { id: guardianId }, data: { userId: existing.id } });
      await this.audit.record(user, 'guardian.invite', 'Guardian', guardianId, {});
      return { invited: true, usesExistingLogin: true };
    }

    const password = String(randomInt(10_000_000, 99_999_999));
    const parent = await this.prisma.user.create({
      data: {
        schoolId: user.schoolId,
        name: link.guardian.name,
        phone: link.guardian.phone,
        passwordHash: await bcrypt.hash(password, 12),
        roles: { create: { role: Role.PARENT } },
      },
    });
    await this.prisma.guardian.update({ where: { id: guardianId }, data: { userId: parent.id } });

    const school = link.student.school;
    await this.notifications.send(user.schoolId, [
      {
        to: link.guardian.phone,
        template: 'parent.invite',
        params: { schoolName: school.name, schoolCode: school.slug, login: link.guardian.phone, password },
      },
    ]);
    await this.audit.record(user, 'guardian.invite', 'Guardian', guardianId, {});
    return { invited: true, usesExistingLogin: false };
  }
}
