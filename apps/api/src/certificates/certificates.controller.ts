import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  CertificateType,
  EnrollmentStatus,
  InvoiceStatus,
  Prisma,
  StaffStatus,
  StudentStatus,
} from '@prisma/client';
import { z } from 'zod';
import {
  campusScope,
  SETUP_ROLES,
  STAFF_ROLES,
} from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import {
  CurrentUser,
  Public,
  RequiresFeature,
  Roles,
} from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type CertificateDetails,
  certificateDetails,
  classLabel,
  fullName,
  guardianOf,
  iso,
  studentInclude,
} from './certificate-details.js';
import { nextSerial, verifyCode } from './certificate-rules.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const CONDUCT = ['Excellent', 'Very good', 'Good', 'Satisfactory'];

const issueSchema = z.object({
  studentId: z.string().min(1),
  type: z.enum(CertificateType),
  issuedOn: isoDate.optional(),
  conduct: z.enum(CONDUCT as [string, ...string[]]).default('Good'),
  remarks: z.string().trim().max(300).nullable().optional(),
  // Leaving certificates only.
  leavingOn: isoDate.optional(),
  reason: z.string().trim().max(200).nullable().optional(),
  allowDues: z.boolean().default(false),
});
type IssueInput = z.infer<typeof issueSchema>;

const cancelSchema = z.object({ reason: z.string().trim().min(3).max(200) });

/** Certificates (leaving, character, enrolment) and ID cards. */
@Controller('certificates')
@RequiresFeature('certificates')
@Roles(...STAFF_ROLES)
export class CertificatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: CertificateType,
    @Query('search') search?: string,
  ) {
    const campuses = campusScope(user);
    const serial = search && /^[A-Z]+-\d{4}-\d+$/i.test(search.trim());
    const rows = await this.prisma.certificate.findMany({
      where: {
        schoolId: user.schoolId,
        ...(type && type in CertificateType ? { type } : {}),
        ...(serial ? { serialNo: search!.trim().toUpperCase() } : {}),
        student: {
          ...(campuses ? { campusId: { in: campuses } } : {}),
          ...(search && !serial
            ? {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                  { admissionNo: { contains: search } },
                ],
              }
            : {}),
        },
      },
      orderBy: [{ issuedOn: 'desc' }, { serialNo: 'desc' }],
      take: 300,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
          },
        },
        issuedBy: { select: { name: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      type: c.type,
      serialNo: c.serialNo,
      issuedOn: iso(c.issuedOn),
      cancelled: Boolean(c.cancelledAt),
      student: { ...c.student, name: fullName(c.student) },
      className: (c.details as unknown as CertificateDetails).className,
      issuedBy: c.issuedBy.name,
    }));
  }

  /**
   * What a certificate for this student would say, and anything standing in
   * the way of a leaving certificate (fees owed, library books out).
   */
  @Get('students/:id/draft')
  async draft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.student(user, id);
    const [owed, books, issued] = await Promise.all([
      this.duesOwed(id),
      this.booksOut(id),
      this.prisma.certificate.findMany({
        where: { studentId: id },
        orderBy: { issuedOn: 'desc' },
        select: {
          id: true,
          type: true,
          serialNo: true,
          issuedOn: true,
          cancelledAt: true,
        },
      }),
    ]);
    return {
      details: certificateDetails(student, { conduct: 'Good', remarks: null }),
      status: student.status,
      duesOwed: owed,
      booksOut: books,
      issued: issued.map((c) => ({
        ...c,
        issuedOn: iso(c.issuedOn),
        cancelled: Boolean(c.cancelledAt),
      })),
    };
  }

  @Post()
  @Roles(...SETUP_ROLES)
  async issue(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(issueSchema)) body: IssueInput,
  ) {
    const student = await this.student(user, body.studentId);
    const today = localToday();
    const issuedOn = body.issuedOn ?? today;
    const details = certificateDetails(student, body);

    if (body.type === CertificateType.ENROLMENT) {
      if (student.status !== StudentStatus.ACTIVE)
        throw new ConflictException(
          `${details.studentName} is not studying here now, so an enrolment certificate can't be issued`,
        );
    }

    if (body.type === CertificateType.LEAVING) {
      const earlier = await this.prisma.certificate.findFirst({
        where: {
          studentId: student.id,
          type: CertificateType.LEAVING,
          cancelledAt: null,
        },
      });
      if (earlier)
        throw new ConflictException(
          `A leaving certificate (${earlier.serialNo}) was already issued; cancel it to issue a new one`,
        );
      const books = await this.booksOut(student.id);
      if (books.length)
        throw new ConflictException(
          `Library book${books.length > 1 ? 's' : ''} not returned: ${books.join(', ')}`,
        );
      const owed = await this.duesOwed(student.id);
      if (owed > 0 && !body.allowDues)
        throw new ConflictException(
          `Rs ${owed.toLocaleString('en-PK')} in fees is still owed`,
        );
      details.leavingOn = body.leavingOn ?? issuedOn;
      details.reason = body.reason ?? null;
      details.duesOwed = owed;
    }

    const certificate = await this.withSerial(async (tx) => {
      const year = Number(issuedOn.slice(0, 4));
      const prefixed = await tx.certificate.findMany({
        where: { schoolId: user.schoolId, type: body.type },
        select: { serialNo: true },
      });
      const created = await tx.certificate.create({
        data: {
          schoolId: user.schoolId,
          studentId: student.id,
          type: body.type,
          serialNo: nextSerial(
            body.type,
            year,
            prefixed.map((p) => p.serialNo),
          ),
          verifyCode: verifyCode(),
          issuedOn: dayStart(issuedOn),
          details: details as unknown as Prisma.InputJsonValue,
          issuedById: user.sub,
        },
      });

      // Leaving: the student leaves their class and stops riding the van.
      if (body.type === CertificateType.LEAVING) {
        const leavingOn = details.leavingOn!;
        await tx.student.update({
          where: { id: student.id },
          data: { status: StudentStatus.LEFT },
        });
        await tx.enrollment.updateMany({
          where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
          data: { status: EnrollmentStatus.LEFT },
        });
        await tx.transportAssignment.updateMany({
          where: {
            studentId: student.id,
            OR: [{ endsOn: null }, { endsOn: { gt: dayStart(leavingOn) } }],
          },
          data: { endsOn: dayStart(leavingOn) },
        });
      }
      return created;
    });

    await this.audit.record(
      user,
      'certificate.issue',
      'Certificate',
      certificate.id,
      { after: certificate },
    );
    return this.get(user, certificate.id);
  }

  /** Everything a printed certificate needs, including the school's letterhead. */
  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const campuses = campusScope(user);
    const c = await this.prisma.certificate.findFirst({
      where: {
        id,
        schoolId: user.schoolId,
        ...(campuses ? { student: { campusId: { in: campuses } } } : {}),
      },
      include: {
        school: {
          select: {
            name: true,
            city: true,
            phone: true,
            email: true,
            logoUrl: true,
          },
        },
        student: {
          select: {
            id: true,
            photoUrl: true,
            campus: { select: { name: true, address: true, phone: true } },
          },
        },
        issuedBy: { select: { name: true } },
      },
    });
    if (!c) throw new NotFoundException('Certificate not found');
    return {
      id: c.id,
      type: c.type,
      serialNo: c.serialNo,
      verifyCode: c.verifyCode,
      issuedOn: iso(c.issuedOn),
      cancelledAt: c.cancelledAt,
      cancelReason: c.cancelReason,
      details: c.details as unknown as CertificateDetails,
      school: c.school,
      campus: c.student.campus,
      studentId: c.student.id,
      photoUrl: c.student.photoUrl,
      issuedBy: c.issuedBy.name,
    };
  }

  /** A certificate issued by mistake stops verifying. The student's record is left as it is. */
  @Post(':id/cancel')
  @Roles(...SETUP_ROLES)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSchema)) body: { reason: string },
  ) {
    const before = await this.get(user, id);
    if (before.cancelledAt)
      throw new ConflictException('This certificate is already cancelled');
    const after = await this.prisma.certificate.update({
      where: { id },
      data: { cancelledAt: new Date(), cancelReason: body.reason },
    });
    await this.audit.record(user, 'certificate.cancel', 'Certificate', id, {
      before: { cancelledAt: null },
      after: { cancelledAt: after.cancelledAt, reason: body.reason },
    });
    return this.get(user, id);
  }

  /** Student ID cards for a section, or for chosen students. */
  @Get('id-cards/students')
  async studentCards(
    @CurrentUser() user: AuthUser,
    @Query('sectionId') sectionId?: string,
    @Query('studentIds') studentIds?: string,
  ) {
    const ids = studentIds?.split(',').filter(Boolean);
    if (!sectionId && !ids?.length) return { school: null, cards: [] };
    const campuses = campusScope(user);
    const [school, students] = await Promise.all([
      this.letterhead(user.schoolId),
      this.prisma.student.findMany({
        where: {
          schoolId: user.schoolId,
          status: StudentStatus.ACTIVE,
          ...(campuses ? { campusId: { in: campuses } } : {}),
          ...(ids?.length ? { id: { in: ids } } : {}),
          ...(sectionId
            ? { enrollments: { some: { sectionId, status: 'ACTIVE' } } }
            : {}),
        },
        include: {
          ...studentInclude,
          enrollments: {
            ...studentInclude.enrollments,
            where: { status: EnrollmentStatus.ACTIVE },
          },
        },
      }),
    ]);
    const cards = students.map((s) => {
      const enrolment = s.enrollments[0];
      const guardian = guardianOf(s);
      return {
        id: s.id,
        name: fullName(s),
        admissionNo: s.admissionNo,
        className: classLabel(enrolment?.section),
        rollNo: enrolment?.rollNo ?? null,
        dateOfBirth: iso(s.dateOfBirth),
        photoUrl: s.photoUrl,
        guardianName: guardian?.name ?? null,
        guardianPhone: guardian?.phone ?? null,
        address: s.address,
        campus: s.campus.name,
        campusPhone: s.campus.phone,
        validUntil: iso(enrolment?.academicYear.endsOn),
      };
    });
    cards.sort(
      (a, b) =>
        (a.rollNo ?? 999) - (b.rollNo ?? 999) || a.name.localeCompare(b.name),
    );
    return { school, cards };
  }

  /** Staff ID cards, for everyone on the payroll at a campus or the whole school. */
  @Get('id-cards/staff')
  @Roles(...SETUP_ROLES)
  async staffCards(
    @CurrentUser() user: AuthUser,
    @Query('campusId') campusId?: string,
  ) {
    const campuses = campusScope(user);
    const wanted = campusId
      ? campuses && !campuses.includes(campusId)
        ? []
        : [campusId]
      : campuses;
    const [school, staff] = await Promise.all([
      this.letterhead(user.schoolId),
      this.prisma.staffProfile.findMany({
        where: {
          schoolId: user.schoolId,
          status: StaffStatus.ACTIVE,
          user: {
            isActive: true,
            ...(wanted
              ? { roles: { some: { campusId: { in: wanted } } } }
              : {}),
          },
        },
        orderBy: { employeeNo: 'asc' },
        include: {
          user: {
            select: {
              name: true,
              phone: true,
              roles: { select: { campus: { select: { name: true } } } },
            },
          },
        },
      }),
    ]);
    return {
      school,
      cards: staff.map((p) => ({
        id: p.id,
        name: p.user.name,
        employeeNo: p.employeeNo,
        designation: p.designation,
        department: p.department,
        phone: p.user.phone,
        cnic: p.cnic,
        joinedOn: iso(p.joinedOn),
        campus:
          [
            ...new Set(p.user.roles.map((r) => r.campus?.name).filter(Boolean)),
          ].join(', ') || null,
      })),
    };
  }

  private letterhead(schoolId: string) {
    return this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { name: true, city: true, phone: true, logoUrl: true },
    });
  }

  private async student(user: AuthUser, id: string) {
    const campuses = campusScope(user);
    const student = await this.prisma.student.findFirst({
      where: {
        id,
        schoolId: user.schoolId,
        ...(campuses ? { campusId: { in: campuses } } : {}),
      },
      include: studentInclude,
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  /** Fees billed and not yet paid, in rupees. */
  private async duesOwed(studentId: string) {
    const unpaid = await this.prisma.invoice.findMany({
      where: {
        studentId,
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
      },
      select: { total: true, paid: true },
    });
    return unpaid.reduce((sum, i) => sum + Math.max(0, i.total - i.paid), 0);
  }

  private async booksOut(studentId: string) {
    const loans = await this.prisma.bookLoan.findMany({
      where: { studentId, returnedOn: null, lost: false },
      select: { copy: { select: { book: { select: { title: true } } } } },
    });
    return loans.map((l) => l.copy.book.title);
  }

  /** Two desks issuing at once can race for a serial: try again with the next one. */
  private async withSerial<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(run);
      } catch (e) {
        const clash =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002';
        if (!clash || attempt >= 2) throw e;
      }
    }
  }
}

/** Anyone holding a certificate (another school, an employer) can check it is real. */
@Controller('verify')
export class VerifyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':code')
  @Public()
  async verify(@Param('code') code: string) {
    const c = await this.prisma.certificate.findUnique({
      where: { verifyCode: code.trim().toUpperCase() },
      include: { school: { select: { name: true, city: true } } },
    });
    if (!c) return { found: false };
    const d = c.details as unknown as CertificateDetails;
    return {
      found: true,
      valid: !c.cancelledAt,
      type: c.type,
      serialNo: c.serialNo,
      issuedOn: iso(c.issuedOn),
      school: c.school,
      studentName: d.studentName,
      guardianName: d.guardianName,
      admissionNo: d.admissionNo,
      className: d.className,
      leavingOn: d.leavingOn ?? null,
      cancelledOn: iso(c.cancelledAt),
    };
  }
}
