import {
  Body,
  ConflictException,
  Controller,
  Delete,
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
import { UserStatusService } from '../common/user-status.service.js';
import { PermissionService } from '../common/permission.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { studentSearchWhere } from '../common/student-search.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BULK_BCRYPT_ROUNDS,
  disableStudentLogins,
  STUDENT_BCRYPT_ROUNDS,
  studentUsername,
  tempPassword,
} from './student-login.js';
import { createStudentRecord, guardianInputSchema } from './student-records.js';
import {
  directoryQuerySchema,
  studentDirectory,
  studentPerformance,
  type DirectoryAccess,
  type DirectoryQuery,
} from './student-directory.js';

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

const studentLoginSchema = z.object({
  /** Omitted: a temporary password is generated and returned once. */
  password: z.string().min(8).max(128).optional(),
});
type StudentLoginInput = z.infer<typeof studentLoginSchema>;

const bulkLoginSchema = z.object({
  sectionId: z.string().min(1),
  /** Also give students who already have a login a fresh temporary password. */
  resetExisting: z.boolean().default(false),
});
type BulkLoginInput = z.infer<typeof bulkLoginSchema>;

const fullName = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

@Controller('students')
@Permission('students')
@Roles(...STAFF_ROLES)
export class StudentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionService,
    private readonly userStatus: UserStatusService,
    private readonly permissions: PermissionService,
  ) {}

  /** Which fee/exam/attendance data this viewer may see in the directory and drawer. */
  private async directoryAccess(user: AuthUser): Promise<DirectoryAccess> {
    const perms = await this.permissions.permissionsFor(user);
    return {
      fees: perms.fees !== 'none',
      attendance: perms.attendance !== 'none',
      exams: perms.exams !== 'none',
      examDrafts: perms.exams === 'manage',
    };
  }

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
      ...studentSearchWhere(search, { guardianPhone: true }),
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

  /**
   * The admin student directory: one server-side page with class, attendance
   * rate (current academic year), primary guardian and fee standing per row.
   * Declared before :id so "directory" is not read as a student id.
   */
  @Get('directory')
  @Roles(...SETUP_ROLES, Role.ACCOUNTANT)
  async directory(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(directoryQuerySchema)) query: DirectoryQuery,
  ) {
    return studentDirectory(this.prisma, user.schoolId, campusScope(user), query, await this.directoryAccess(user));
  }

  /** Subject scores, 26 weeks of attendance and fee standing, for the directory drawer. */
  @Get(':id/performance')
  @Roles(...SETUP_ROLES, Role.ACCOUNTANT)
  async performance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return studentPerformance(this.prisma, user.schoolId, campusScope(user), id, await this.directoryAccess(user));
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        campus: { select: { id: true, name: true } },
        // The student's own sign-in, for the "Student login" card.
        user: {
          select: { id: true, username: true, isActive: true, lastLoginAt: true },
        },
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
    await this.subscriptions.assertStudentRoom(user.schoolId, 1);
    const student = await this.prisma.$transaction((tx) =>
      createStudentRecord(tx, { ...body, schoolId: user.schoolId }),
    );
    await this.audit.record(user, 'student.create', 'Student', student.id, { after: student });
    return student;
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
    const leaving = Boolean(body.status && body.status !== StudentStatus.ACTIVE);
    const [after, offUserIds] = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.student.update({ where: { id }, data: body });
      if (!leaving) return [updated, [] as string[]] as const;
      await tx.enrollment.updateMany({
        where: { studentId: id, status: 'ACTIVE' },
        data: { status: 'LEFT' },
      });
      // A student who is no longer current cannot keep signing in.
      return [updated, await disableStudentLogins(tx, [id])] as const;
    });
    for (const userId of offUserIds) this.userStatus.forget(userId);
    await this.audit.record(user, 'student.update', 'Student', id, { before, after });
    return after;
  }

  /**
   * Gives every current student in a section a login and returns the printable
   * list of usernames and temporary passwords, once. Students who already have
   * an active login are listed without a password unless resetExisting is set.
   */
  @Post('logins/bulk')
  @Roles(...SETUP_ROLES)
  async bulkLogins(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(bulkLoginSchema)) body: BulkLoginInput,
  ) {
    const section = await this.prisma.section.findFirst({
      where: { id: body.sectionId, schoolId: user.schoolId },
      select: { id: true, name: true, class: { select: { name: true, campusId: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');
    const scope = campusScope(user);
    if (scope && !scope.includes(section.class.campusId)) {
      throw new ForbiddenException('Section is at another campus');
    }
    const enrollments = await this.prisma.enrollment.findMany({
      where: { sectionId: section.id, status: 'ACTIVE', student: { status: StudentStatus.ACTIVE } },
      orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
      select: {
        rollNo: true,
        student: {
          select: {
            id: true,
            admissionNo: true,
            firstName: true,
            lastName: true,
            userId: true,
            user: { select: { isActive: true } },
          },
        },
      },
    });
    const logins: {
      studentId: string;
      name: string;
      admissionNo: string;
      rollNo: number | null;
      username: string;
      password: string | null;
      status: 'created' | 'reset' | 'existing' | 'conflict';
      error?: string;
    }[] = [];
    for (const { rollNo, student } of enrollments) {
      const base = {
        studentId: student.id,
        name: fullName(student),
        admissionNo: student.admissionNo,
        rollNo,
        username: studentUsername(student.admissionNo),
      };
      if (student.userId && student.user?.isActive && !body.resetExisting) {
        logins.push({ ...base, password: null, status: 'existing' });
        continue;
      }
      const password = tempPassword();
      try {
        const result = await this.issueLogin(user.schoolId, student, password, BULK_BCRYPT_ROUNDS);
        logins.push({ ...base, password, status: result.created ? 'created' : 'reset' });
      } catch (e) {
        // One clash (username used by another account) must not lose the
        // passwords already issued to the rest of the section.
        if (!(e instanceof ConflictException)) throw e;
        logins.push({ ...base, password: null, status: 'conflict', error: e.message });
      }
    }
    await this.audit.record(user, 'student.login.bulk', 'Section', section.id, {
      after: {
        created: logins.filter((l) => l.status === 'created').length,
        reset: logins.filter((l) => l.status === 'reset').length,
      },
    });
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: user.schoolId },
      select: { name: true, slug: true },
    });
    return {
      school: { name: school.name, code: school.slug },
      section: { id: section.id, name: `${section.class.name} ${section.name}` },
      created: logins.filter((l) => l.status === 'created').length,
      reset: logins.filter((l) => l.status === 'reset').length,
      existing: logins.filter((l) => l.status === 'existing').length,
      conflicts: logins.filter((l) => l.status === 'conflict').length,
      logins,
    };
  }

  /**
   * Creates (or re-enables) a student's own login: username = admission number,
   * lowercased. Sets the given password, or generates a temporary one that is
   * returned once and never stored in plain text.
   */
  @Post(':id/login')
  @Roles(...SETUP_ROLES)
  async createLogin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(studentLoginSchema)) body: StudentLoginInput,
  ) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId },
      select: {
        id: true,
        admissionNo: true,
        firstName: true,
        lastName: true,
        userId: true,
        campusId: true,
        status: true,
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    const scope = campusScope(user);
    if (scope && !scope.includes(student.campusId)) {
      throw new ForbiddenException('Student is at another campus');
    }
    if (student.status !== StudentStatus.ACTIVE) {
      throw new ConflictException('Only current students can have a login');
    }
    const password = body.password ?? tempPassword();
    const result = await this.issueLogin(user.schoolId, student, password, STUDENT_BCRYPT_ROUNDS);
    await this.audit.record(user, 'student.login', 'Student', id, {
      after: { username: result.username, created: result.created },
    });
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: user.schoolId },
      select: { slug: true },
    });
    return {
      studentId: id,
      userId: result.userId,
      username: result.username,
      schoolCode: school.slug,
      created: result.created,
      // Only a generated password is echoed back, and only this once.
      tempPassword: body.password ? null : password,
    };
  }

  /** Switches a student's login off; it can be turned back on with POST :id/login. */
  @Delete(':id/login')
  @Roles(...SETUP_ROLES)
  async disableLogin(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId },
      select: { userId: true, campusId: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    const scope = campusScope(user);
    if (scope && !scope.includes(student.campusId)) {
      throw new ForbiddenException('Student is at another campus');
    }
    if (!student.userId) throw new NotFoundException('This student has no login');
    await this.prisma.user.update({ where: { id: student.userId }, data: { isActive: false } });
    this.userStatus.forget(student.userId);
    await this.audit.record(user, 'student.login.disable', 'Student', id, {});
    return { disabled: true };
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

  /** Creates the STUDENT user for a student, or re-enables theirs, with this password. */
  private async issueLogin(
    schoolId: string,
    student: {
      id: string;
      admissionNo: string;
      firstName: string;
      lastName: string | null;
      userId: string | null;
    },
    password: string,
    rounds: number,
  ) {
    const username = studentUsername(student.admissionNo);
    const taken = await this.prisma.user.findUnique({
      where: { schoolId_username: { schoolId, username } },
      select: { id: true },
    });
    if (taken && taken.id !== student.userId) {
      throw new ConflictException(`The username ${username} is used by another account`);
    }
    const passwordHash = await bcrypt.hash(password, rounds);
    if (student.userId) {
      const existing = await this.prisma.user.update({
        where: { id: student.userId },
        data: { username, passwordHash, isActive: true },
        include: { roles: true },
      });
      if (!existing.roles.some((r) => r.role === Role.STUDENT)) {
        await this.prisma.roleAssignment.create({ data: { userId: existing.id, role: Role.STUDENT } });
      }
      this.userStatus.forget(existing.id);
      return { userId: existing.id, username, created: false };
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const login = await tx.user.create({
        data: {
          schoolId,
          name: fullName(student),
          username,
          passwordHash,
          roles: { create: { role: Role.STUDENT } },
        },
      });
      await tx.student.update({ where: { id: student.id }, data: { userId: login.id } });
      return login;
    });
    return { userId: created.id, username, created: true };
  }
}
