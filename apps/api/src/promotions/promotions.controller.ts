import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  ExamStatus,
  Prisma,
  PromotionDecision,
  StudentStatus,
} from '@prisma/client';
import { z } from 'zod';
import { campusScope, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import { UserStatusService } from '../common/user-status.service.js';
import { disableStudentLogins } from '../students/student-login.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  aYearLater,
  type ClassInfo,
  defaultPlan,
  matchingSection,
  nextClass,
  nextYearName,
} from './promotion-rules.js';

const decisionsSchema = z.object({
  decisions: z
    .array(
      z.object({
        studentId: z.string().min(1),
        decision: z.enum(PromotionDecision),
        toSectionId: z.string().nullable().optional(),
      }),
    )
    .max(200),
});
type DecisionsInput = z.infer<typeof decisionsSchema>;

const startSchema = z.object({
  carryTimetable: z.boolean().default(true),
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fullName = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

type Plan = {
  decision: PromotionDecision;
  toSectionId: string | null;
  saved: boolean;
};

/**
 * Year-end: set up next year's sections and fees, decide who moves up, stays
 * back, leaves or graduates, then start the new year in one go.
 */
@Controller('promotions')
@Permission('promotions')
@Roles(...SETUP_ROLES)
export class PromotionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly userStatus: UserStatusService,
  ) {}

  /** This year, next year (if set up) and how far each section's decisions have got. */
  @Get()
  async overview(@CurrentUser() user: AuthUser) {
    const { current, next } = await this.years(user.schoolId);
    if (!current) return { current: null, next: null, sections: [] };
    const campuses = campusScope(user);
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId: user.schoolId,
        academicYearId: current.id,
        ...(campuses ? { class: { campusId: { in: campuses } } } : {}),
      },
      orderBy: [
        { class: { campus: { name: 'asc' } } },
        { class: { sortOrder: 'asc' } },
        { name: 'asc' },
      ],
      include: {
        class: { include: { campus: { select: { name: true } } } },
        enrollments: {
          where: { status: EnrollmentStatus.ACTIVE },
          select: { studentId: true },
        },
      },
    });
    const decided = await this.prisma.promotion.groupBy({
      by: ['decision'],
      where: { fromYearId: current.id },
      _count: true,
    });
    const saved = await this.prisma.promotion.findMany({
      where: { fromYearId: current.id },
      select: { studentId: true },
    });
    const savedIds = new Set(saved.map((s) => s.studentId));
    return {
      current: {
        id: current.id,
        name: current.name,
        endsOn: iso(current.endsOn),
      },
      next: next
        ? {
            id: next.id,
            name: next.name,
            startsOn: iso(next.startsOn),
            sections: await this.prisma.section.count({
              where: { academicYearId: next.id },
            }),
          }
        : null,
      decisions: Object.fromEntries(decided.map((d) => [d.decision, d._count])),
      sections: sections.map((s) => ({
        id: s.id,
        name: `${s.class.name} ${s.name}`,
        campus: s.class.campus.name,
        students: s.enrollments.length,
        decided: s.enrollments.filter((e) => savedIds.has(e.studentId)).length,
      })),
    };
  }

  /**
   * Creates next year with the same classes and sections, class teachers,
   * subject teachers and fee amounts. Running it again only adds what is missing.
   */
  @Post('next-year')
  async prepareNextYear(@CurrentUser() user: AuthUser) {
    this.wholeSchool(user);
    const { current, next: existing } = await this.years(user.schoolId);
    if (!current)
      throw new BadRequestException('Set up the current academic year first');

    const result = await this.prisma.$transaction(async (tx) => {
      const next =
        existing ??
        (await tx.academicYear.create({
          data: {
            schoolId: user.schoolId,
            name: nextYearName(current.name),
            startsOn: aYearLater(current.startsOn),
            endsOn: aYearLater(current.endsOn),
          },
        }));
      const [sections, already, fees] = await Promise.all([
        tx.section.findMany({
          where: { academicYearId: current.id },
          include: { subjects: true },
        }),
        tx.section.findMany({
          where: { academicYearId: next.id },
          select: { classId: true, name: true },
        }),
        tx.feeStructure.findMany({ where: { academicYearId: current.id } }),
      ]);
      const have = new Set(already.map((s) => `${s.classId}/${s.name}`));
      let added = 0;
      for (const s of sections) {
        if (have.has(`${s.classId}/${s.name}`)) continue;
        await tx.section.create({
          data: {
            schoolId: user.schoolId,
            classId: s.classId,
            academicYearId: next.id,
            name: s.name,
            capacity: s.capacity,
            classTeacherId: s.classTeacherId,
            subjects: {
              create: s.subjects.map((sub) => ({
                schoolId: user.schoolId,
                subjectId: sub.subjectId,
                teacherId: sub.teacherId,
              })),
            },
          },
        });
        added++;
      }
      const copied = await tx.feeStructure.createMany({
        data: fees.map((f) => ({
          schoolId: f.schoolId,
          classId: f.classId,
          feeHeadId: f.feeHeadId,
          academicYearId: next.id,
          amount: f.amount,
        })),
        skipDuplicates: true,
      });
      return { next, added, fees: copied.count };
    });
    await this.audit.record(
      user,
      'promotion.prepare',
      'AcademicYear',
      result.next.id,
      { after: { sectionsAdded: result.added, feesCopied: result.fees } },
    );
    return {
      id: result.next.id,
      name: result.next.name,
      startsOn: iso(result.next.startsOn),
      sectionsAdded: result.added,
      feesCopied: result.fees,
    };
  }

  /** A section's students with their final result and what will happen to them. */
  @Get('sections/:sectionId')
  async section(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
  ) {
    const { current, next } = await this.years(user.schoolId);
    if (!current || !next)
      throw new ConflictException('Set up next year first');
    const section = await this.currentSection(user, sectionId, current.id);
    const [plans, classes, nextSections, exam] = await Promise.all([
      this.plans(current.id, next.id, [section]),
      this.classes(user.schoolId),
      this.prisma.section.findMany({
        where: { academicYearId: next.id },
        orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
        include: {
          class: {
            select: {
              id: true,
              name: true,
              campus: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.exam.findFirst({
        where: {
          academicYearId: current.id,
          status: ExamStatus.PUBLISHED,
          results: { some: { sectionId } },
        },
        orderBy: { publishedAt: 'desc' },
        select: { id: true, name: true },
      }),
    ]);
    const results = exam
      ? await this.prisma.examResult.findMany({
          where: { examId: exam.id, sectionId },
          select: {
            studentId: true,
            percent: true,
            passed: true,
            position: true,
          },
        })
      : [];
    const resultOf = new Map(results.map((r) => [r.studentId, r]));
    const fromClass = classes.find((c) => c.id === section.classId)!;
    const multiCampus =
      new Set(nextSections.map((s) => s.class.campus.name)).size > 1;
    return {
      section: {
        id: section.id,
        name: `${section.class.name} ${section.name}`,
        campus: section.class.campus.name,
      },
      exam,
      nextYear: next.name,
      targets: nextSections.map((s) => ({
        id: s.id,
        classId: s.classId,
        name: `${s.class.name} ${s.name}${multiCampus ? `, ${s.class.campus.name}` : ''}`,
        sameClass: s.classId === section.classId,
      })),
      repeatSectionId:
        matchingSection(section.classId, section.name, nextSections)?.id ??
        null,
      topClass: !nextClass(fromClass, classes),
      students: section.enrollments
        .map((e) => {
          const r = resultOf.get(e.studentId);
          const plan = plans.get(e.studentId)!;
          return {
            id: e.studentId,
            name: fullName(e.student),
            admissionNo: e.student.admissionNo,
            rollNo: e.rollNo,
            result: r
              ? { percent: r.percent, passed: r.passed, position: r.position }
              : null,
            ...plan,
          };
        })
        .sort(
          (a, b) =>
            (a.rollNo ?? 999) - (b.rollNo ?? 999) ||
            a.name.localeCompare(b.name),
        ),
    };
  }

  @Put('sections/:sectionId')
  async decide(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(decisionsSchema)) body: DecisionsInput,
  ) {
    const { current, next } = await this.years(user.schoolId);
    if (!current || !next)
      throw new ConflictException('Set up next year first');
    const section = await this.currentSection(user, sectionId, current.id);
    const inSection = new Set(section.enrollments.map((e) => e.studentId));
    const targets = new Set(
      (
        await this.prisma.section.findMany({
          where: { academicYearId: next.id },
          select: { id: true },
        })
      ).map((s) => s.id),
    );
    for (const d of body.decisions) {
      if (!inSection.has(d.studentId))
        throw new BadRequestException('A student is not in this section');
      const needsSection =
        d.decision === PromotionDecision.PROMOTE ||
        d.decision === PromotionDecision.REPEAT;
      if (needsSection && !(d.toSectionId && targets.has(d.toSectionId)))
        throw new BadRequestException(
          `Choose next year's class for every student moving up or staying back`,
        );
    }
    await this.prisma.$transaction(
      body.decisions.map((d) => {
        const data = {
          decision: d.decision,
          toSectionId:
            d.decision === PromotionDecision.PROMOTE ||
            d.decision === PromotionDecision.REPEAT
              ? d.toSectionId!
              : null,
          decidedById: user.sub,
        };
        return this.prisma.promotion.upsert({
          where: {
            fromYearId_studentId: {
              fromYearId: current.id,
              studentId: d.studentId,
            },
          },
          create: {
            schoolId: user.schoolId,
            fromYearId: current.id,
            studentId: d.studentId,
            ...data,
          },
          update: data,
        });
      }),
    );
    await this.audit.record(user, 'promotion.decide', 'Section', sectionId, {
      after: body.decisions,
    });
    return this.section(user, sectionId);
  }

  /**
   * Carries out every decision, numbers the new classes and makes next year
   * the current one. Students without a decision move up as planned by default.
   */
  @Post('start-year')
  async startYear(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(startSchema))
    body: z.infer<typeof startSchema>,
  ) {
    this.wholeSchool(user);
    const { current, next } = await this.years(user.schoolId);
    if (!current || !next)
      throw new ConflictException('Set up next year first');
    const sections = await this.prisma.section.findMany({
      where: { academicYearId: current.id },
      include: this.sectionInclude,
    });
    const plans = await this.plans(current.id, next.id, sections);
    const nextSections = await this.prisma.section.findMany({
      where: { academicYearId: next.id },
      select: {
        id: true,
        classId: true,
        name: true,
        class: { select: { campusId: true } },
      },
    });
    const campusOf = new Map(nextSections.map((s) => [s.id, s.class.campusId]));

    const stuck = sections.filter((s) =>
      s.enrollments.some((e) => {
        const p = plans.get(e.studentId)!;
        return (
          (p.decision === PromotionDecision.PROMOTE ||
            p.decision === PromotionDecision.REPEAT) &&
          !p.toSectionId
        );
      }),
    );
    if (stuck.length)
      throw new ConflictException(
        `Next year has no class to move these students into: ${stuck
          .map((s) => `${s.class.name} ${s.name}`)
          .join(', ')}`,
      );

    const counts = { PROMOTE: 0, REPEAT: 0, LEAVE: 0, GRADUATE: 0 };
    const leavers: string[] = [];
    let offUserIds: string[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        for (const section of sections) {
          for (const e of section.enrollments) {
            const p = plans.get(e.studentId)!;
            counts[p.decision]++;
            const status = {
              PROMOTE: EnrollmentStatus.PROMOTED,
              REPEAT: EnrollmentStatus.REPEATED,
              LEAVE: EnrollmentStatus.LEFT,
              GRADUATE: EnrollmentStatus.GRADUATED,
            }[p.decision];
            await tx.enrollment.update({
              where: { id: e.id },
              data: { status },
            });
            if (p.toSectionId) {
              await tx.enrollment.create({
                data: {
                  schoolId: user.schoolId,
                  studentId: e.studentId,
                  sectionId: p.toSectionId,
                  academicYearId: next.id,
                },
              });
              // Moving up from a junior campus to the senior one.
              const campusId = campusOf.get(p.toSectionId)!;
              if (campusId !== section.class.campusId)
                await tx.student.update({
                  where: { id: e.studentId },
                  data: { campusId },
                });
            } else {
              await tx.transportAssignment.updateMany({
                where: { studentId: e.studentId, endsOn: null },
                data: { endsOn: current.endsOn },
              });
              await tx.student.update({
                where: { id: e.studentId },
                data: {
                  status:
                    p.decision === PromotionDecision.GRADUATE
                      ? StudentStatus.GRADUATED
                      : StudentStatus.LEFT,
                },
              });
              leavers.push(e.studentId);
            }
          }
        }

        // Roll numbers in each new class, alphabetically.
        const fresh = await tx.enrollment.findMany({
          where: { academicYearId: next.id, status: EnrollmentStatus.ACTIVE },
          select: {
            id: true,
            sectionId: true,
            student: { select: { firstName: true, lastName: true } },
          },
        });
        const bySection = new Map<string, typeof fresh>();
        for (const e of fresh)
          bySection.set(e.sectionId, [
            ...(bySection.get(e.sectionId) ?? []),
            e,
          ]);
        for (const group of bySection.values()) {
          group.sort((a, b) =>
            fullName(a.student).localeCompare(fullName(b.student)),
          );
          for (const [i, e] of group.entries())
            await tx.enrollment.update({
              where: { id: e.id },
              data: { rollNo: i + 1 },
            });
        }

        // The weekly timetable carries over to the same class next year.
        if (body.carryTimetable) {
          for (const s of sections) {
            const target = nextSections.find(
              (n) => n.classId === s.classId && n.name === s.name,
            );
            if (!target) continue;
            const has = await tx.timetableSlot.count({
              where: { sectionId: target.id },
            });
            if (!has)
              await tx.timetableSlot.updateMany({
                where: { sectionId: s.id },
                data: { sectionId: target.id },
              });
          }
        }

        // Leavers and graduates stop signing in to the student workspace.
        offUserIds = await disableStudentLogins(tx, leavers);

        await tx.academicYear.updateMany({
          where: { schoolId: user.schoolId },
          data: { isCurrent: false },
        });
        await tx.academicYear.update({
          where: { id: next.id },
          data: { isCurrent: true },
        });
      },
      { timeout: 120_000 },
    );
    for (const userId of offUserIds) this.userStatus.forget(userId);
    await this.audit.record(
      user,
      'promotion.start_year',
      'AcademicYear',
      next.id,
      {
        before: { current: current.name },
        after: { current: next.name, ...counts },
      },
    );
    return { year: next.name, ...counts };
  }

  private readonly sectionInclude = {
    class: { include: { campus: { select: { name: true } } } },
    enrollments: {
      where: { status: EnrollmentStatus.ACTIVE },
      include: {
        student: {
          select: { firstName: true, lastName: true, admissionNo: true },
        },
      },
    },
  } satisfies Prisma.SectionInclude;

  /** The current year and the one after it, if it has been set up. */
  private async years(schoolId: string) {
    const current = await this.prisma.academicYear.findFirst({
      where: { schoolId, isCurrent: true },
    });
    const next = current
      ? await this.prisma.academicYear.findFirst({
          where: { schoolId, startsOn: { gt: current.startsOn } },
          orderBy: { startsOn: 'asc' },
        })
      : null;
    return { current, next };
  }

  private classes(schoolId: string): Promise<ClassInfo[]> {
    return this.prisma.class.findMany({
      where: { schoolId },
      select: { id: true, campusId: true, sortOrder: true, name: true },
    });
  }

  private async currentSection(
    user: AuthUser,
    sectionId: string,
    yearId: string,
  ) {
    const campuses = campusScope(user);
    const section = await this.prisma.section.findFirst({
      where: {
        id: sectionId,
        schoolId: user.schoolId,
        academicYearId: yearId,
        ...(campuses ? { class: { campusId: { in: campuses } } } : {}),
      },
      include: this.sectionInclude,
    });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  /** Each student's saved decision, or what happens by default. */
  private async plans(
    currentId: string,
    nextId: string,
    sections: {
      classId: string;
      name: string;
      schoolId: string;
      enrollments: { studentId: string }[];
    }[],
  ): Promise<Map<string, Plan>> {
    if (!sections.length) return new Map();
    const schoolId = sections[0].schoolId;
    const ids = sections.flatMap((s) => s.enrollments.map((e) => e.studentId));
    const [saved, classes, nextSections] = await Promise.all([
      this.prisma.promotion.findMany({
        where: { fromYearId: currentId, studentId: { in: ids } },
      }),
      this.classes(schoolId),
      this.prisma.section.findMany({
        where: { academicYearId: nextId },
        select: { id: true, classId: true, name: true },
      }),
    ]);
    const savedOf = new Map(saved.map((s) => [s.studentId, s]));
    const plans = new Map<string, Plan>();
    for (const section of sections) {
      const fromClass = classes.find((c) => c.id === section.classId)!;
      const fallback = defaultPlan(
        fromClass,
        section.name,
        classes,
        nextSections,
      );
      for (const e of section.enrollments) {
        const s = savedOf.get(e.studentId);
        plans.set(
          e.studentId,
          s
            ? { decision: s.decision, toSectionId: s.toSectionId, saved: true }
            : { ...fallback, saved: false },
        );
      }
    }
    return plans;
  }

  private wholeSchool(user: AuthUser) {
    if (campusScope(user))
      throw new ForbiddenException(
        'Only someone who runs the whole school can set up or start a new year',
      );
  }
}
