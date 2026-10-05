import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { LessonPlanStatus, Prisma } from '@prisma/client';
import {
  ATTENDANCE_ROLES,
  campusScope,
  hasAnyRole,
  SETUP_ROLES,
} from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  canReview,
  canSubmit,
  createLessonPlanSchema,
  isEditable,
  listLessonPlansSchema,
  mondayOf,
  reviewLessonPlanSchema,
  updateLessonPlanSchema,
  type CreateLessonPlan,
  type ListLessonPlans,
  type ReviewLessonPlan,
  type UpdateLessonPlan,
} from './lesson-plan-rules.js';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const STALE = 'This plan was changed by someone else. Reload and try again.';

const planSelect = {
  id: true,
  sectionId: true,
  subjectId: true,
  teacherId: true,
  weekStart: true,
  topic: true,
  objectives: true,
  activities: true,
  resources: true,
  homework: true,
  status: true,
  submittedAt: true,
  reviewerNote: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  section: {
    select: { name: true, class: { select: { name: true, campusId: true } } },
  },
  subject: { select: { name: true } },
  teacher: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
} satisfies Prisma.LessonPlanSelect;

type PlanRow = Prisma.LessonPlanGetPayload<{ select: typeof planSelect }>;

function toDto(p: PlanRow, me: string) {
  return {
    id: p.id,
    sectionId: p.sectionId,
    sectionName: `${p.section.class.name} ${p.section.name}`,
    subjectId: p.subjectId,
    subjectName: p.subject.name,
    teacher: p.teacher,
    weekStart: iso(p.weekStart),
    topic: p.topic,
    objectives: p.objectives,
    activities: p.activities,
    resources: p.resources,
    homework: p.homework,
    status: p.status,
    submittedAt: p.submittedAt,
    reviewerNote: p.reviewerNote,
    reviewedBy: p.reviewedBy,
    reviewedAt: p.reviewedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    mine: p.teacherId === me,
    editable: p.teacherId === me && isEditable(p.status),
  };
}

/**
 * Weekly lesson plans. Teachers write, edit, delete and submit their own plans
 * for sections and subjects they teach (subject teacher, or class teacher of
 * the section). Setup roles see every plan in their campus scope and review
 * submitted ones (approve or send back with a note). Other school -> 404.
 */
@Controller('lesson-plans')
@Permission('lesson_plans')
@Roles(...ATTENDANCE_ROLES)
export class LessonPlansController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Sections and subjects this user may plan for (current academic year). */
  @Get('sections')
  async sections(@CurrentUser() user: AuthUser) {
    const admin = hasAnyRole(user, SETUP_ROLES);
    const scope = campusScope(user);
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        academicYear: { isCurrent: true },
        ...(scope ? { class: { campusId: { in: scope } } } : {}),
        ...(admin
          ? {}
          : {
              OR: [
                { classTeacherId: user.sub },
                { subjects: { some: { teacherId: user.sub } } },
              ],
            }),
      },
      orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        classTeacherId: true,
        class: { select: { name: true } },
        subjects: {
          orderBy: { subject: { name: 'asc' } },
          select: {
            teacherId: true,
            subject: { select: { id: true, name: true } },
          },
        },
      },
    });
    return sections.map((s) => {
      const all = admin || s.classTeacherId === user.sub;
      return {
        id: s.id,
        name: `${s.class.name} ${s.name}`,
        isClassTeacher: s.classTeacherId === user.sub,
        subjects: s.subjects
          .filter((x) => all || x.teacherId === user.sub)
          .map((x) => ({
            id: x.subject.id,
            name: x.subject.name,
            teachesIt: x.teacherId === user.sub,
          })),
      };
    });
  }

  /**
   * Plans, newest week first. Teachers get only their own; setup roles get
   * every plan in their campus scope (or only their own with mine=true).
   */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listLessonPlansSchema)) q: ListLessonPlans,
  ) {
    const admin = hasAnyRole(user, SETUP_ROLES);
    const scope = campusScope(user);
    const weekStart: Prisma.DateTimeFilter = {};
    if (q.week) weekStart.equals = dayStart(mondayOf(q.week));
    if (q.from) weekStart.gte = dayStart(mondayOf(q.from));
    if (q.to) weekStart.lte = dayStart(q.to);
    const plans = await this.prisma.lessonPlan.findMany({
      where: {
        schoolId: user.schoolId,
        ...(admin && q.mine !== 'true' ? {} : { teacherId: user.sub }),
        ...(admin && q.teacherId ? { teacherId: q.teacherId } : {}),
        ...(scope ? { section: { class: { campusId: { in: scope } } } } : {}),
        ...(q.sectionId ? { sectionId: q.sectionId } : {}),
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(Object.keys(weekStart).length ? { weekStart } : {}),
      },
      orderBy: [{ weekStart: 'desc' }, { createdAt: 'asc' }],
      take: 500,
      select: planSelect,
    });
    return plans.map((p) => toDto(p, user.sub));
  }

  /** Setup roles: submitted plans waiting for review (oldest first) and counts by status. */
  @Get('review-queue')
  @Roles(...SETUP_ROLES)
  async reviewQueue(@CurrentUser() user: AuthUser) {
    const scope = campusScope(user);
    const where: Prisma.LessonPlanWhereInput = {
      schoolId: user.schoolId,
      ...(scope ? { section: { class: { campusId: { in: scope } } } } : {}),
    };
    const [items, groups] = await Promise.all([
      this.prisma.lessonPlan.findMany({
        where: { ...where, status: LessonPlanStatus.SUBMITTED },
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        take: 200,
        select: planSelect,
      }),
      this.prisma.lessonPlan.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);
    const counts = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, NEEDS_CHANGES: 0 };
    for (const g of groups) counts[g.status] = g._count._all;
    return { items: items.map((p) => toDto(p, user.sub)), counts };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return toDto(await this.visible(user, id), user.sub);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createLessonPlanSchema)) body: CreateLessonPlan,
  ) {
    await this.assertCanTeach(user, body.sectionId, body.subjectId);
    const plan = await this.prisma.lessonPlan.create({
      data: {
        schoolId: user.schoolId,
        sectionId: body.sectionId,
        subjectId: body.subjectId,
        teacherId: user.sub,
        weekStart: dayStart(mondayOf(body.weekStart)),
        topic: body.topic,
        objectives: body.objectives ?? null,
        activities: body.activities ?? null,
        resources: body.resources ?? null,
        homework: body.homework ?? null,
      },
      select: planSelect,
    });
    return toDto(plan, user.sub);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLessonPlanSchema)) body: UpdateLessonPlan,
  ) {
    const plan = await this.own(user, id);
    if (!isEditable(plan.status)) {
      throw new ConflictException(
        'Submitted and approved plans cannot be edited',
      );
    }
    const { weekStart, ...rest } = body;
    await this.transition(id, plan.status, {
      ...rest,
      ...(weekStart ? { weekStart: dayStart(mondayOf(weekStart)) } : {}),
    });
    return toDto(await this.load(id), user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const plan = await this.own(user, id);
    if (!isEditable(plan.status)) {
      throw new ConflictException(
        'Submitted and approved plans cannot be deleted',
      );
    }
    const { count } = await this.prisma.lessonPlan.deleteMany({
      where: { id, status: plan.status },
    });
    if (count === 0) throw new ConflictException(STALE);
    await this.audit.record(user, 'lesson_plan.delete', 'LessonPlan', id, {
      before: { status: plan.status },
    });
    return { deleted: true };
  }

  /** Sends a draft (or a plan sent back) to the review queue. */
  @Post(':id/submit')
  @HttpCode(200)
  async submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const plan = await this.own(user, id);
    if (!canSubmit(plan.status))
      throw new ConflictException('This plan has already been submitted');
    await this.transition(id, plan.status, {
      status: LessonPlanStatus.SUBMITTED,
      submittedAt: new Date(),
    });
    return toDto(await this.load(id), user.sub);
  }

  /** Setup roles: approve a submitted plan or send it back with a note. */
  @Post(':id/review')
  @HttpCode(200)
  @Roles(...SETUP_ROLES)
  async review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewLessonPlanSchema)) body: ReviewLessonPlan,
  ) {
    const plan = await this.visible(user, id);
    if (plan.teacherId === user.sub)
      throw new ForbiddenException('You cannot review your own plan');
    if (!canReview(plan.status))
      throw new ConflictException('Only submitted plans can be reviewed');
    await this.transition(id, plan.status, {
      status: body.decision,
      reviewerNote: body.note || null,
      reviewedById: user.sub,
      reviewedAt: new Date(),
    });
    const updated = await this.load(id);
    await this.audit.record(
      user,
      `lesson_plan.${body.decision === 'APPROVED' ? 'approve' : 'needs_changes'}`,
      'LessonPlan',
      id,
      {
        before: { status: plan.status },
        after: { status: body.decision, note: body.note ?? null },
      },
    );
    return toDto(updated, user.sub);
  }

  /**
   * Applies a change only if the plan still has the status the caller checked,
   * so concurrent reviews/submits/edits cannot silently overwrite each other.
   */
  private async transition(
    id: string,
    expected: LessonPlanStatus,
    data: Prisma.LessonPlanUncheckedUpdateManyInput,
  ) {
    const { count } = await this.prisma.lessonPlan.updateMany({
      where: { id, status: expected },
      data,
    });
    if (count === 0) throw new ConflictException(STALE);
  }

  private async load(id: string) {
    return this.prisma.lessonPlan.findUniqueOrThrow({
      where: { id },
      select: planSelect,
    });
  }

  /** A plan this user may read: their own, or any in campus scope for setup roles. */
  private async visible(user: AuthUser, id: string) {
    const plan = await this.prisma.lessonPlan.findFirst({
      where: { id, schoolId: user.schoolId },
      select: planSelect,
    });
    if (!plan) throw new NotFoundException('Lesson plan not found');
    if (plan.teacherId === user.sub) return plan;
    if (!hasAnyRole(user, SETUP_ROLES))
      throw new ForbiddenException('This is not your lesson plan');
    const scope = campusScope(user);
    if (scope && !scope.includes(plan.section.class.campusId)) {
      throw new ForbiddenException('This plan is for another campus');
    }
    return plan;
  }

  /** A plan this user wrote. */
  private async own(user: AuthUser, id: string) {
    const plan = await this.prisma.lessonPlan.findFirst({
      where: { id, schoolId: user.schoolId },
      select: { id: true, teacherId: true, status: true },
    });
    if (!plan) throw new NotFoundException('Lesson plan not found');
    if (plan.teacherId !== user.sub)
      throw new ForbiddenException(
        'Only the teacher who wrote this plan can change it',
      );
    return plan;
  }

  /** Teachers plan only what they teach; setup roles any subject taught in a section in their scope. */
  private async assertCanTeach(
    user: AuthUser,
    sectionId: string,
    subjectId: string,
  ) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId },
      select: {
        classTeacherId: true,
        class: { select: { campusId: true } },
        subjects: { where: { subjectId }, select: { teacherId: true } },
      },
    });
    if (!section) throw new NotFoundException('Section not found');
    const taught = section.subjects[0];
    if (!taught)
      throw new BadRequestException(
        'This subject is not taught in this section',
      );
    const admin = hasAnyRole(user, SETUP_ROLES);
    const scope = campusScope(user);
    const inScope = !scope || scope.includes(section.class.campusId);
    if (admin && inScope) return;
    if (taught.teacherId === user.sub || section.classTeacherId === user.sub)
      return;
    throw new ForbiddenException(
      'You do not teach this subject in this section',
    );
  }
}
