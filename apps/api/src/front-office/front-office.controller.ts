import {
  BadRequestException,
  Body,
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
import { ComplaintStatus, PostalDirection, Prisma, StudentStatus } from '@prisma/client';
import { z } from 'zod';
import { campusScope, inScope, SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, daysBefore, localToday, startOfLocalDay } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  canMoveComplaint,
  slipFor,
  upcomingBirthdays,
  visitMinutes,
} from './front-office-rules.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).optional();
const required = (max: number) => z.string().trim().min(1).max(max);

const visitorSchema = z.object({
  name: required(120),
  phone: text(30),
  cnic: text(20),
  purpose: required(200),
  meetingWith: text(120),
  headcount: z.number().int().min(1).max(50).default(1),
  cardNo: text(20),
  note: text(300),
  campusId: z.string().optional(),
});

const postalSchema = z.object({
  direction: z.enum(PostalDirection),
  date: isoDate.optional(),
  party: required(150),
  subject: required(200),
  referenceNo: text(60),
  mode: text(40),
  note: text(300),
  campusId: z.string().optional(),
});

const shortLeaveSchema = z.object({
  studentId: z.string().min(1),
  reason: required(200),
  pickedUpBy: required(120),
  relation: text(40),
});

const complaintSchema = z.object({
  complainant: required(120),
  phone: text(30),
  studentId: z.string().optional(),
  category: required(60),
  description: required(1000),
  campusId: z.string().optional(),
});

const complaintUpdateSchema = z.object({
  status: z.enum(ComplaintStatus),
  resolution: text(1000),
});

const contactSchema = z.object({
  name: required(120),
  organisation: text(120),
  category: text(60),
  phone: z.string().trim().min(3).max(40),
  email: z.email().toLowerCase().optional(),
  address: text(250),
  note: text(300),
});

const localitySchema = z.object({ name: required(80), note: text(200) });

const name = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

/** The front desk: visitor book, post register, short leave, complaints, phone book, birthdays and information slips. */
@Controller('front-office')
@Permission('front_office')
@Roles(...STAFF_ROLES)
export class FrontOfficeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ----- Visitors -----

  @Get('visitors')
  async visitors(
    @CurrentUser() user: AuthUser,
    @Query('date') date?: string,
    @Query('inside') inside?: string,
    @Query('search') search?: string,
  ) {
    const day = date && isoDate.safeParse(date).success ? date : localToday();
    const q = search?.trim();
    const rows = await this.prisma.visitor.findMany({
      where: {
        schoolId: user.schoolId,
        ...this.scoped(user),
        checkedInAt: { gte: startOfLocalDay(day), lt: startOfLocalDay(daysBefore(day, -1)) },
        ...(inside === '1' ? { checkedOutAt: null } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { meetingWith: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { checkedInAt: 'desc' },
      take: 500,
    });
    return rows.map((v) => ({ ...v, minutes: visitMinutes(v.checkedInAt, v.checkedOutAt) }));
  }

  @Post('visitors')
  async addVisitor(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(visitorSchema)) body: z.infer<typeof visitorSchema>,
  ) {
    const campusId = await this.campusFor(user, body.campusId);
    const visitor = await this.prisma.visitor.create({
      data: { ...body, campusId, schoolId: user.schoolId, createdById: user.sub },
    });
    await this.audit.record(user, 'front_office.visitor.create', 'Visitor', visitor.id, { after: visitor });
    return visitor;
  }

  @Patch('visitors/:id/checkout')
  async checkOut(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const visitor = await this.prisma.visitor.findFirst({
      where: { id, schoolId: user.schoolId, ...this.scoped(user) },
    });
    if (!visitor) throw new NotFoundException('Visitor not found');
    if (visitor.checkedOutAt) throw new BadRequestException('This visitor is already checked out');
    return this.prisma.visitor.update({ where: { id }, data: { checkedOutAt: new Date() } });
  }

  // ----- Postal register -----

  @Get('postal')
  async postal(
    @CurrentUser() user: AuthUser,
    @Query('direction') direction?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    const q = search?.trim();
    const dir = z.enum(PostalDirection).safeParse(direction);
    const range = {
      ...(from && isoDate.safeParse(from).success ? { gte: dayStart(from) } : {}),
      ...(to && isoDate.safeParse(to).success ? { lte: dayStart(to) } : {}),
    };
    return this.prisma.postalRecord.findMany({
      where: {
        schoolId: user.schoolId,
        ...this.scoped(user),
        ...(dir.success ? { direction: dir.data } : {}),
        ...(Object.keys(range).length ? { date: range } : {}),
        ...(q
          ? {
              OR: [
                { party: { contains: q, mode: 'insensitive' } },
                { subject: { contains: q, mode: 'insensitive' } },
                { referenceNo: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  @Post('postal')
  async addPostal(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(postalSchema)) body: z.infer<typeof postalSchema>,
  ) {
    const campusId = await this.campusFor(user, body.campusId);
    const record = await this.prisma.postalRecord.create({
      data: {
        ...body,
        date: dayStart(body.date ?? localToday()),
        campusId,
        schoolId: user.schoolId,
        createdById: user.sub,
      },
    });
    await this.audit.record(user, 'front_office.postal.create', 'PostalRecord', record.id, { after: record });
    return record;
  }

  // ----- Short leave -----

  @Get('short-leaves')
  async shortLeaves(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const day = date && isoDate.safeParse(date).success ? date : localToday();
    const rows = await this.prisma.studentShortLeave.findMany({
      where: { schoolId: user.schoolId, ...this.scoped(user), date: dayStart(day) },
      orderBy: { leftAt: 'desc' },
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            admissionNo: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              select: { section: { select: { name: true, class: { select: { name: true } } } } },
            },
          },
        },
      },
    });
    return rows.map(({ student, ...r }) => ({
      ...r,
      studentName: name(student),
      admissionNo: student.admissionNo,
      className: student.enrollments[0]
        ? `${student.enrollments[0].section.class.name} ${student.enrollments[0].section.name}`
        : null,
    }));
  }

  @Post('short-leaves')
  async addShortLeave(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(shortLeaveSchema)) body: z.infer<typeof shortLeaveSchema>,
  ) {
    const student = await this.studentInScope(user, body.studentId);
    if (student.status !== StudentStatus.ACTIVE) throw new BadRequestException('This student is not enrolled');
    const leave = await this.prisma.studentShortLeave.create({
      data: {
        ...body,
        schoolId: user.schoolId,
        campusId: student.campusId,
        date: dayStart(localToday()),
        approvedById: user.sub,
      },
    });
    await this.audit.record(user, 'front_office.short_leave.create', 'StudentShortLeave', leave.id, { after: leave });
    return leave;
  }

  @Patch('short-leaves/:id/return')
  async returned(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const leave = await this.prisma.studentShortLeave.findFirst({
      where: { id, schoolId: user.schoolId, ...this.scoped(user) },
    });
    if (!leave) throw new NotFoundException('Short leave not found');
    if (leave.returnedAt) throw new BadRequestException('This student is already marked back');
    return this.prisma.studentShortLeave.update({ where: { id }, data: { returnedAt: new Date() } });
  }

  // ----- Complaints -----

  @Get('complaints')
  async complaints(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    const parsed = z.enum(ComplaintStatus).safeParse(status);
    const rows = await this.prisma.complaint.findMany({
      where: {
        schoolId: user.schoolId,
        ...this.scoped(user),
        ...(parsed.success ? { status: parsed.data } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    });
    return rows.map(({ student, ...c }) => ({
      ...c,
      studentName: student ? name(student) : null,
      admissionNo: student?.admissionNo ?? null,
    }));
  }

  @Post('complaints')
  async addComplaint(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(complaintSchema)) body: z.infer<typeof complaintSchema>,
  ) {
    let campusId = await this.campusFor(user, body.campusId);
    if (body.studentId) campusId = (await this.studentInScope(user, body.studentId)).campusId;
    const complaint = await this.prisma.complaint.create({
      data: { ...body, campusId, schoolId: user.schoolId, createdById: user.sub },
    });
    await this.audit.record(user, 'front_office.complaint.create', 'Complaint', complaint.id, { after: complaint });
    return complaint;
  }

  @Patch('complaints/:id')
  async updateComplaint(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(complaintUpdateSchema)) body: z.infer<typeof complaintUpdateSchema>,
  ) {
    const before = await this.prisma.complaint.findFirst({
      where: { id, schoolId: user.schoolId, ...this.scoped(user) },
    });
    if (!before) throw new NotFoundException('Complaint not found');
    if (!canMoveComplaint(before.status, body.status)) {
      throw new BadRequestException('A complaint can only move forward: open, in progress, resolved');
    }
    if (body.status === ComplaintStatus.RESOLVED && !body.resolution) {
      throw new BadRequestException('Say how it was resolved');
    }
    const after = await this.prisma.complaint.update({
      where: { id },
      data: {
        status: body.status,
        resolution: body.resolution ?? before.resolution,
        resolvedAt: body.status === ComplaintStatus.RESOLVED ? new Date() : null,
      },
    });
    await this.audit.record(user, 'front_office.complaint.update', 'Complaint', id, { before, after });
    return after;
  }

  // ----- Phone book -----

  @Get('contacts')
  contacts(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('category') category?: string) {
    const q = search?.trim();
    return this.prisma.contactEntry.findMany({
      where: {
        schoolId: user.schoolId,
        ...(category ? { category } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { organisation: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 500,
    });
  }

  @Post('contacts')
  async addContact(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(contactSchema)) body: z.infer<typeof contactSchema>,
  ) {
    const contact = await this.prisma.contactEntry.create({ data: { ...body, schoolId: user.schoolId } });
    await this.audit.record(user, 'front_office.contact.create', 'ContactEntry', contact.id, { after: contact });
    return contact;
  }

  @Patch('contacts/:id')
  async updateContact(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contactSchema.partial())) body: Partial<z.infer<typeof contactSchema>>,
  ) {
    const before = await this.prisma.contactEntry.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new NotFoundException('Contact not found');
    const after = await this.prisma.contactEntry.update({ where: { id }, data: body });
    await this.audit.record(user, 'front_office.contact.update', 'ContactEntry', id, { before, after });
    return after;
  }

  @Delete('contacts/:id')
  async deleteContact(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const before = await this.prisma.contactEntry.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new NotFoundException('Contact not found');
    await this.prisma.contactEntry.delete({ where: { id } });
    await this.audit.record(user, 'front_office.contact.delete', 'ContactEntry', id, { before });
    return { deleted: true };
  }

  // ----- Birthdays -----

  /** Students whose birthday falls today or in the next `days` days (default 30). */
  @Get('birthdays')
  async birthdays(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    const window = Math.min(Math.max(Number(days) || 30, 0), 366);
    const scope = campusScope(user);
    const students = await this.prisma.student.findMany({
      where: {
        schoolId: user.schoolId,
        status: StudentStatus.ACTIVE,
        dateOfBirth: { not: null },
        ...(scope ? { campusId: { in: scope } } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        enrollments: {
          where: { status: 'ACTIVE' },
          select: { section: { select: { name: true, class: { select: { name: true } } } } },
        },
      },
    });
    const byId = new Map(students.map((s) => [s.id, s]));
    return upcomingBirthdays(
      students.map((s) => ({ id: s.id, name: name(s), dateOfBirth: s.dateOfBirth as Date })),
      localToday(),
      window,
    ).map((b) => {
      const e = byId.get(b.id)?.enrollments[0];
      return { ...b, className: e ? `${e.section.class.name} ${e.section.name}` : null };
    });
  }

  // ----- Student information slips -----

  /** One printable slip per student in a section, for parents to check and correct. */
  @Get('slips')
  async slips(@CurrentUser() user: AuthUser, @Query('sectionId') sectionId?: string) {
    if (!sectionId) throw new BadRequestException('Choose a class section');
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId },
      select: { name: true, class: { select: { name: true, campusId: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');
    if (!inScope(campusScope(user), section.class.campusId)) {
      throw new ForbiddenException('That class is at another campus');
    }
    const enrollments = await this.prisma.enrollment.findMany({
      where: { schoolId: user.schoolId, sectionId, status: 'ACTIVE', student: { status: StudentStatus.ACTIVE } },
      orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
      include: {
        student: {
          include: {
            locality: { select: { name: true } },
            guardians: { include: { guardian: { select: { name: true, phone: true } } } },
          },
        },
      },
    });
    return {
      className: `${section.class.name} ${section.name}`,
      printedOn: localToday(),
      slips: enrollments.map((e) =>
        slipFor({
          admissionNo: e.student.admissionNo,
          rollNo: e.rollNo,
          name: name(e.student),
          gender: e.student.gender,
          dateOfBirth: e.student.dateOfBirth,
          address: e.student.address,
          locality: e.student.locality?.name ?? null,
          guardians: e.student.guardians.map((g) => ({
            name: g.guardian.name,
            phone: g.guardian.phone,
            relation: g.relation,
            isPrimary: g.isPrimary,
          })),
        }),
      ),
    };
  }

  // ----- Localities (setup) -----

  @Get('localities')
  async localities(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.locality.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { students: true } } },
    });
    return rows.map(({ _count, ...l }) => ({ ...l, students: _count.students }));
  }

  @Post('localities')
  @Roles(...SETUP_ROLES)
  async addLocality(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(localitySchema)) body: z.infer<typeof localitySchema>,
  ) {
    try {
      const locality = await this.prisma.locality.create({ data: { ...body, schoolId: user.schoolId } });
      await this.audit.record(user, 'locality.create', 'Locality', locality.id, { after: locality });
      return locality;
    } catch (e) {
      throw this.duplicate(e);
    }
  }

  @Patch('localities/:id')
  @Roles(...SETUP_ROLES)
  async updateLocality(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(localitySchema.partial())) body: Partial<z.infer<typeof localitySchema>>,
  ) {
    const before = await this.prisma.locality.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new NotFoundException('Locality not found');
    try {
      const after = await this.prisma.locality.update({ where: { id }, data: body });
      await this.audit.record(user, 'locality.update', 'Locality', id, { before, after });
      return after;
    } catch (e) {
      throw this.duplicate(e);
    }
  }

  /** Students in a deleted locality keep their address text and just lose the area. */
  @Delete('localities/:id')
  @Roles(...SETUP_ROLES)
  async deleteLocality(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const before = await this.prisma.locality.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new NotFoundException('Locality not found');
    await this.prisma.locality.delete({ where: { id } });
    await this.audit.record(user, 'locality.delete', 'Locality', id, { before });
    return { deleted: true };
  }

  // ----- helpers -----

  /** Rows of the campuses this user works at; school-wide staff see all. */
  private scoped(user: AuthUser): { campusId?: { in: string[] } } {
    const scope = campusScope(user);
    return scope ? { campusId: { in: scope } } : {};
  }

  /** The campus a new row belongs to: the one asked for, or the user's only campus, within their reach. */
  private async campusFor(user: AuthUser, requested?: string): Promise<string | null> {
    const scope = campusScope(user);
    const campusId = requested ?? (scope?.length === 1 ? scope[0] : null);
    if (scope && !inScope(scope, campusId)) {
      throw new ForbiddenException(campusId ? 'That campus is not yours to manage' : 'Choose your campus');
    }
    if (campusId) {
      const campus = await this.prisma.campus.findFirst({ where: { id: campusId, schoolId: user.schoolId } });
      if (!campus) throw new BadRequestException('No such campus');
    }
    return campusId;
  }

  private async studentInScope(user: AuthUser, studentId: string) {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, schoolId: user.schoolId } });
    if (!student) throw new NotFoundException('Student not found');
    if (!inScope(campusScope(user), student.campusId)) throw new ForbiddenException('Student is at another campus');
    return student;
  }

  private duplicate(e: unknown): unknown {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
      ? new BadRequestException('That locality already exists')
      : e;
  }
}
