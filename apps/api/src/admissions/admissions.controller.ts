import {
  BadRequestException,
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
import { ApplicationStage, Gender, Prisma } from '@prisma/client';
import { z } from 'zod';
import { adminScope, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Public, RequiresFeature, Roles } from '../common/decorators.js';
import { RateLimit } from '../common/rate-limit.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createStudentRecord } from '../students/student-records.js';

const enquirySchema = z.object({
  campusId: z.string().min(1),
  classId: z.string().min(1),
  childName: z.string().trim().min(2).max(120),
  gender: z.enum(Gender),
  dateOfBirth: z.coerce.date().optional(),
  previousSchool: z.string().trim().max(120).optional(),
  guardianName: z.string().trim().min(2).max(120),
  guardianPhone: z.string().trim().min(10).max(20),
  guardianEmail: z.email().toLowerCase().optional(),
  relation: z.string().trim().min(2).max(30).default('Father'),
  source: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
});
type EnquiryInput = z.infer<typeof enquirySchema>;

const updateSchema = z.object({
  stage: z.enum(ApplicationStage).exclude(['ADMITTED']).optional(),
  testDate: z.coerce.date().nullable().optional(),
  testScore: z.number().min(0).max(1000).nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});
type UpdateInput = z.infer<typeof updateSchema>;

const admitSchema = z.object({
  sectionId: z.string().min(1),
  admissionNo: z.string().trim().max(30).optional(),
});
type AdmitInput = z.infer<typeof admitSchema>;

/** Enquiries one address may send in 10 minutes (a family may enquire for several children). */
export const ENQUIRY_LIMIT = 10;

@Controller()
@Permission('admissions')
@RequiresFeature('admissions')
export class AdmissionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** Online enquiry form on the school's public admission page. */
  @Public()
  @Post('public/:schoolSlug/enquiries')
  @RateLimit('enquiry', ENQUIRY_LIMIT, 10 * 60_000)
  async publicEnquiry(
    @Param('schoolSlug') slug: string,
    @Body(new ZodValidationPipe(enquirySchema)) body: EnquiryInput,
  ) {
    const school = await this.prisma.school.findUnique({ where: { slug } });
    if (!school) throw new NotFoundException('School not found');
    await this.assertTakingEnquiries(school.id, true);
    await this.assertClassAtCampus(school.id, body.campusId, body.classId);
    await this.prisma.application.create({
      data: { ...body, schoolId: school.id, source: body.source ?? 'Website' },
    });
    return { received: true };
  }

  /** Campuses and classes a public enquiry form can offer. */
  @Public()
  @Get('public/:schoolSlug/admission-options')
  async publicOptions(@Param('schoolSlug') slug: string) {
    const school = await this.prisma.school.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        campuses: {
          select: { id: true, name: true, classes: { select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    if (!school) throw new NotFoundException('School not found');
    await this.assertTakingEnquiries(school.id, false);
    const { id: _id, ...options } = school;
    return options;
  }

  @Get('applications')
  @Roles(...SETUP_ROLES)
  list(
    @CurrentUser() user: AuthUser,
    @Query('stage', new ZodValidationPipe(z.enum(ApplicationStage).optional())) stage?: ApplicationStage,
  ) {
    return this.prisma.application.findMany({
      where: { ...this.scoped(user), ...(stage ? { stage } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        campus: { select: { name: true } },
        class: { select: { name: true } },
      },
    });
  }

  /** Count of applications in each stage, for the admissions funnel. */
  @Get('applications/funnel')
  @Roles(...SETUP_ROLES)
  async funnel(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.application.groupBy({
      by: ['stage'],
      where: this.scoped(user),
      _count: true,
    });
    return Object.values(ApplicationStage).map((stage) => ({
      stage,
      count: rows.find((r) => r.stage === stage)?._count ?? 0,
    }));
  }

  @Post('applications')
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(enquirySchema)) body: EnquiryInput,
  ) {
    const scope = adminScope(user);
    if (scope && !scope.includes(body.campusId)) {
      throw new ForbiddenException('That campus is not yours to manage');
    }
    await this.assertClassAtCampus(user.schoolId, body.campusId, body.classId);
    const application = await this.prisma.application.create({
      data: { ...body, schoolId: user.schoolId, source: body.source ?? 'Walk-in' },
    });
    await this.audit.record(user, 'application.create', 'Application', application.id, {
      after: application,
    });
    return application;
  }

  @Patch('applications/:id')
  @Roles(...SETUP_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateInput,
  ) {
    const before = await this.findOwned(user, id);
    if (before.stage === ApplicationStage.ADMITTED) {
      throw new BadRequestException('This applicant is already admitted');
    }
    const after = await this.prisma.application.update({ where: { id }, data: body });
    await this.audit.record(user, 'application.update', 'Application', id, { before, after });
    return after;
  }

  /** Turns an application into a student enrolled in the chosen section. */
  @Post('applications/:id/admit')
  @Roles(...SETUP_ROLES)
  async admit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(admitSchema)) body: AdmitInput,
  ) {
    const application = await this.findOwned(user, id);
    if (application.stage === ApplicationStage.ADMITTED) {
      throw new BadRequestException('This applicant is already admitted');
    }
    await this.subscriptions.assertStudentRoom(user.schoolId, 1);
    const [firstName, ...rest] = application.childName.split(/\s+/);
    const student = await this.prisma.$transaction(async (tx) => {
      const created = await createStudentRecord(tx, {
        schoolId: user.schoolId,
        sectionId: body.sectionId,
        campuses: adminScope(user),
        admissionNo: body.admissionNo,
        firstName,
        lastName: rest.join(' ') || undefined,
        gender: application.gender,
        dateOfBirth: application.dateOfBirth ?? undefined,
        guardians: [
          {
            name: application.guardianName,
            phone: application.guardianPhone,
            email: application.guardianEmail ?? undefined,
            relation: application.relation,
            isPrimary: true,
          },
        ],
      });
      await tx.application.update({
        where: { id },
        data: { stage: ApplicationStage.ADMITTED, studentId: created.id },
      });
      return created;
    });
    await this.audit.record(user, 'application.admit', 'Application', id, {
      after: { studentId: student.id },
    });
    return student;
  }

  /** The caller's school, narrowed to their campuses for a campus-limited admin. */
  private scoped(user: AuthUser): Prisma.ApplicationWhereInput {
    const scope = adminScope(user);
    return { schoolId: user.schoolId, ...(scope ? { campusId: { in: scope } } : {}) };
  }

  /**
   * Public routes skip the subscription guard, so they apply the plan here: a
   * suspended school, or one without admissions on its plan, takes no
   * enquiries, and a read-only school shows its form but cannot save one.
   */
  private async assertTakingEnquiries(schoolId: string, saving: boolean) {
    const plan = await this.subscriptions.forSchool(schoolId);
    if (
      plan.access === 'blocked' ||
      !plan.features.includes('admissions') ||
      (saving && plan.access === 'read_only')
    ) {
      throw new NotFoundException('This school is not taking enquiries online');
    }
  }

  private async findOwned(user: AuthUser, id: string) {
    const application = await this.prisma.application.findFirst({
      where: { id, ...this.scoped(user) },
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  private async assertClassAtCampus(schoolId: string, campusId: string, classId: string) {
    const found = await this.prisma.class.findFirst({
      where: { id: classId, campusId, schoolId },
    });
    if (!found) throw new NotFoundException('Class not found at that campus');
  }
}
