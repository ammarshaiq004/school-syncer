import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ExamStatus, LiveStatus, Role } from '@prisma/client';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday, startOfLocalDay } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { DEFAULT_BANDS, type SubjectResult } from '../exams/result-calculator.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { learningSummary } from './learning-summary.js';
import { resolveStudent, type StudentContext } from './student-context.js';
import {
  announcementAudience,
  assignmentState,
  attendanceSummary,
  isoWeekday,
  liveClassState,
  monthBounds,
  nextDay,
  quizIsOpen,
} from './student-rules.js';

const DUE_WINDOW_DAYS = 7;

/**
 * The student workspace. Every handler resolves the student from the token
 * (resolveStudent) and filters by that student's id and section; no handler
 * takes a student id from the request, so a student only ever sees their own
 * records. E-school pages (courses, live classes, assignments, quizzes) live
 * in the e-learning module under the same /student prefix.
 */
@Controller('student')
@Roles(Role.STUDENT)
export class StudentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** Profile, section, class, campus and the school's mode. */
  @Get('me')
  @Permission('dashboard')
  async me(@CurrentUser() user: AuthUser) {
    const ctx = await resolveStudent(this.prisma, user);
    const [student, section, school, login] = await Promise.all([
      this.prisma.student.findUniqueOrThrow({
        where: { id: ctx.id },
        select: {
          gender: true,
          dateOfBirth: true,
          photoUrl: true,
          admittedOn: true,
          campus: { select: { id: true, name: true } },
        },
      }),
      ctx.sectionId
        ? this.prisma.section.findUnique({
            where: { id: ctx.sectionId },
            select: {
              id: true,
              name: true,
              class: { select: { id: true, name: true } },
              academicYear: { select: { id: true, name: true } },
              classTeacher: { select: { name: true } },
            },
          })
        : null,
      this.prisma.school.findUniqueOrThrow({
        where: { id: user.schoolId },
        select: { id: true, name: true, slug: true, mode: true, logoUrl: true },
      }),
      this.prisma.user.findUnique({ where: { id: user.sub }, select: { username: true } }),
    ]);
    return {
      id: ctx.id,
      name: ctx.name,
      firstName: ctx.firstName,
      lastName: ctx.lastName,
      admissionNo: ctx.admissionNo,
      username: login?.username ?? null,
      rollNo: ctx.rollNo,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      photoUrl: student.photoUrl,
      admittedOn: student.admittedOn,
      campus: student.campus,
      section: section ? { id: section.id, name: section.name } : null,
      class: section?.class ?? null,
      academicYear: section?.academicYear ?? null,
      classTeacher: section?.classTeacher?.name ?? null,
      school,
    };
  }

  /**
   * Today at a glance: timetable periods, live classes today, assignments due
   * in the next 7 days, quizzes open now and the latest notices.
   */
  @Get('today')
  @Permission('dashboard')
  async today(@CurrentUser() user: AuthUser) {
    const ctx = await resolveStudent(this.prisma, user);
    const now = new Date();
    const date = localToday();
    const dayOfWeek = isoWeekday(date);
    const empty = {
      date,
      dayOfWeek,
      student: { id: ctx.id, name: ctx.name, firstName: ctx.firstName },
    };
    if (!ctx.sectionId) {
      return {
        ...empty,
        section: null,
        timetable: [],
        liveClasses: [],
        assignmentsDue: [],
        quizzesOpen: [],
        announcements: await this.announcementsFor(ctx, 5),
      };
    }
    const section = { schoolId: ctx.schoolId, sectionId: ctx.sectionId };
    const [sectionInfo, periods, slots, live, assignments, quizzes, announcements] = await Promise.all([
      this.prisma.section.findUniqueOrThrow({
        where: { id: ctx.sectionId },
        select: { id: true, name: true, class: { select: { name: true, campusId: true } } },
      }),
      this.prisma.period.findMany({
        where: { campus: { classes: { some: { id: ctx.classId ?? '' } } } },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.timetableSlot.findMany({
        where: { ...section, dayOfWeek },
        select: {
          periodId: true,
          room: true,
          subject: { select: { id: true, name: true } },
          teacher: { select: { name: true } },
        },
      }),
      this.prisma.liveClass.findMany({
        where: {
          ...section,
          startsAt: { gte: startOfLocalDay(date), lt: startOfLocalDay(nextDay(date)) },
          status: { not: LiveStatus.CANCELLED },
        },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          title: true,
          startsAt: true,
          durationMin: true,
          status: true,
          provider: true,
          recordingUrl: true,
          subject: { select: { name: true } },
          teacher: { select: { name: true } },
          attendance: { where: { studentId: ctx.id }, select: { joinedAt: true } },
        },
      }),
      this.prisma.assignment.findMany({
        where: {
          ...section,
          isPublished: true,
          dueAt: { gte: now, lte: new Date(now.getTime() + DUE_WINDOW_DAYS * 86_400_000) },
        },
        orderBy: { dueAt: 'asc' },
        select: {
          id: true,
          title: true,
          dueAt: true,
          maxPoints: true,
          allowLate: true,
          subject: { select: { name: true } },
          submissions: { where: { studentId: ctx.id }, select: { status: true, submittedAt: true } },
        },
      }),
      this.prisma.quiz.findMany({
        where: {
          ...section,
          isPublished: true,
          AND: [
            { OR: [{ opensAt: null }, { opensAt: { lte: now } }] },
            { OR: [{ closesAt: null }, { closesAt: { gt: now } }] },
          ],
        },
        orderBy: [{ closesAt: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          title: true,
          opensAt: true,
          closesAt: true,
          timeLimitMin: true,
          attemptsAllowed: true,
          subject: { select: { name: true } },
          _count: { select: { questions: true } },
          attempts: { where: { studentId: ctx.id }, select: { id: true, submittedAt: true } },
        },
      }),
      this.announcementsFor(ctx, 5),
    ]);

    const slotByPeriod = new Map(slots.map((s) => [s.periodId, s]));
    return {
      ...empty,
      section: {
        id: sectionInfo.id,
        name: `${sectionInfo.class.name} ${sectionInfo.name}`,
      },
      // A school day: every period that has a lesson today, plus the breaks between them.
      timetable: slots.length
        ? periods
            .filter((p) => p.isBreak || slotByPeriod.has(p.id))
            .map((p) => {
              const slot = slotByPeriod.get(p.id);
              return {
                periodId: p.id,
                name: p.name,
                startTime: p.startTime,
                endTime: p.endTime,
                isBreak: p.isBreak,
                subject: slot?.subject.name ?? null,
                subjectId: slot?.subject.id ?? null,
                teacher: slot?.teacher?.name ?? null,
                room: slot?.room ?? null,
              };
            })
        : [],
      liveClasses: live.map((l) => ({
        id: l.id,
        title: l.title,
        subject: l.subject?.name ?? null,
        teacher: l.teacher?.name ?? null,
        startsAt: l.startsAt,
        durationMin: l.durationMin,
        provider: l.provider,
        recordingUrl: l.status === LiveStatus.ENDED ? l.recordingUrl : null,
        joined: l.attendance.length > 0,
        // The join link itself comes from POST /student/live/:id/join.
        ...liveClassState(l, now),
      })),
      assignmentsDue: assignments.map((a) => {
        const sub = a.submissions[0] ?? null;
        return {
          id: a.id,
          title: a.title,
          subject: a.subject.name,
          dueAt: a.dueAt,
          maxPoints: a.maxPoints,
          status: assignmentState(a, sub, now),
          submittedAt: sub?.submittedAt ?? null,
          hoursLeft: Math.max(0, Math.floor((a.dueAt.getTime() - now.getTime()) / 3_600_000)),
        };
      }),
      quizzesOpen: quizzes
        .filter((q) => quizIsOpen(q, now))
        .map((q) => {
          const inProgress = q.attempts.find((a) => a.submittedAt === null);
          return {
            id: q.id,
            title: q.title,
            subject: q.subject.name,
            closesAt: q.closesAt,
            timeLimitMin: q.timeLimitMin,
            questions: q._count.questions,
            attemptsAllowed: q.attemptsAllowed,
            attemptsUsed: q.attempts.length,
            attemptsLeft: Math.max(0, q.attemptsAllowed - q.attempts.length),
            inProgressAttemptId: inProgress?.id ?? null,
          };
        }),
      announcements,
    };
  }

  /** One month of daily attendance (default: this month) and the year so far. */
  @Get('attendance')
  @Permission('attendance')
  async attendance(@CurrentUser() user: AuthUser, @Query('month') month?: string) {
    const ctx = await resolveStudent(this.prisma, user);
    const wanted = month ?? localToday().slice(0, 7);
    const bounds = monthBounds(wanted);
    if (!bounds) throw new BadRequestException('Use month=YYYY-MM');
    const [records, yearRecords] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: {
          studentId: ctx.id,
          session: { date: { gte: dayStart(bounds.first), lte: dayStart(bounds.last) } },
        },
        orderBy: { session: { date: 'asc' } },
        select: { status: true, note: true, session: { select: { date: true } } },
      }),
      ctx.academicYearId
        ? this.prisma.attendanceRecord.findMany({
            where: { studentId: ctx.id, session: { section: { academicYearId: ctx.academicYearId } } },
            select: { status: true },
          })
        : [],
    ]);
    return {
      month: wanted,
      summary: attendanceSummary(records.map((r) => r.status)),
      year: attendanceSummary(yearRecords.map((r) => r.status)),
      days: records.map((r) => ({
        date: r.session.date.toISOString().slice(0, 10),
        status: r.status,
        note: r.note,
      })),
    };
  }

  /** Published exam results (each with a report card link) plus assignment and quiz scores. */
  @Get('results')
  @Permission('exams')
  async results(@CurrentUser() user: AuthUser) {
    const ctx = await resolveStudent(this.prisma, user);
    const [exams, learning] = await Promise.all([
      this.prisma.examResult.findMany({
        where: { studentId: ctx.id, exam: { status: ExamStatus.PUBLISHED, schoolId: ctx.schoolId } },
        orderBy: { exam: { publishedAt: 'desc' } },
        select: {
          examId: true,
          obtained: true,
          maxTotal: true,
          percent: true,
          grade: true,
          position: true,
          passed: true,
          subjects: true,
          exam: { select: { name: true, publishedAt: true, academicYear: { select: { name: true } } } },
        },
      }),
      learningSummary(this.prisma, ctx),
    ]);
    return {
      exams: exams.map((r) => ({
        examId: r.examId,
        exam: r.exam.name,
        academicYear: r.exam.academicYear.name,
        publishedAt: r.exam.publishedAt,
        obtained: r.obtained,
        maxTotal: r.maxTotal,
        percent: r.percent,
        grade: r.grade,
        position: r.position,
        passed: r.passed,
        subjects: r.subjects as unknown as SubjectResult[],
        // API path of the printable report card for this exam.
        reportCardApi: `/student/results/${r.examId}`,
      })),
      assignments: learning.assignments.filter((a) => a.status === 'graded' || a.status === 'returned'),
      quizzes: learning.quizzes.filter((q) => q.submitted > 0),
      courses: learning.courses,
    };
  }

  /** The printable report card for one published exam (same shape as the staff/parent report card). */
  @Get('results/:examId')
  @Permission('exams')
  async reportCard(@CurrentUser() user: AuthUser, @Param('examId') examId: string) {
    const ctx = await resolveStudent(this.prisma, user);
    const result = await this.prisma.examResult.findFirst({
      where: { examId, studentId: ctx.id, exam: { status: ExamStatus.PUBLISHED, schoolId: ctx.schoolId } },
      include: {
        exam: { include: { academicYear: { select: { name: true } } } },
        section: {
          select: {
            name: true,
            class: { select: { name: true } },
            _count: { select: { examResults: { where: { examId } } } },
          },
        },
        student: { select: { firstName: true, lastName: true, admissionNo: true, dateOfBirth: true } },
      },
    });
    if (!result) throw new NotFoundException('No published result for this exam');
    const exam = result.exam;
    const [school, attendance, bands, enrollment] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({
        where: { id: ctx.schoolId },
        select: { name: true, logoUrl: true },
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: {
          studentId: ctx.id,
          session: {
            section: { academicYearId: exam.academicYearId },
            ...(exam.endsOn ? { date: { lte: exam.endsOn } } : {}),
          },
        },
        _count: true,
      }),
      this.prisma.gradeBand.findMany({
        where: { schoolId: ctx.schoolId },
        orderBy: { minPercent: 'desc' },
        select: { grade: true, minPercent: true, remark: true },
      }),
      this.prisma.enrollment.findUnique({
        where: { studentId_academicYearId: { studentId: ctx.id, academicYearId: exam.academicYearId } },
        select: { rollNo: true },
      }),
    ]);
    const days = Object.fromEntries(attendance.map((a) => [a.status, a._count]));
    return {
      school,
      exam: { id: exam.id, name: exam.name, academicYear: exam.academicYear.name, publishedAt: exam.publishedAt },
      student: {
        id: ctx.id,
        name: [result.student.firstName, result.student.lastName].filter(Boolean).join(' '),
        admissionNo: result.student.admissionNo,
        dateOfBirth: result.student.dateOfBirth,
        rollNo: enrollment?.rollNo ?? null,
        class: `${result.section.class.name} ${result.section.name}`,
      },
      subjects: result.subjects as unknown as SubjectResult[],
      obtained: result.obtained,
      maxTotal: result.maxTotal,
      percent: result.percent,
      grade: result.grade,
      position: result.position,
      outOf: result.section._count.examResults,
      passed: result.passed,
      teacherRemark: result.teacherRemark,
      principalRemark: result.principalRemark,
      attendance: {
        present: (days.PRESENT ?? 0) + (days.LATE ?? 0),
        absent: days.ABSENT ?? 0,
        leave: days.LEAVE ?? 0,
      },
      gradeScale: bands.length ? bands : DEFAULT_BANDS,
    };
  }

  /** My library books: current loans first, then the last returned ones. */
  @Get('library')
  @Permission('library')
  async library(@CurrentUser() user: AuthUser) {
    const ctx = await resolveStudent(this.prisma, user);
    const [plan, school] = await Promise.all([
      this.subscriptions.forSchool(ctx.schoolId),
      this.prisma.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { mode: true } }),
    ]);
    const available = plan.features.includes('library') && school.mode !== 'ONLINE';
    if (!available) return { available: false, loans: [], finesDue: 0 };
    const loans = await this.prisma.bookLoan.findMany({
      where: { studentId: ctx.id, schoolId: ctx.schoolId },
      orderBy: [{ returnedOn: { sort: 'desc', nulls: 'first' } }, { dueOn: 'asc' }],
      take: 30,
      select: {
        id: true,
        issuedOn: true,
        dueOn: true,
        returnedOn: true,
        lost: true,
        fine: true,
        fineStatus: true,
        copy: { select: { accessionNo: true, book: { select: { title: true, author: true } } } },
      },
    });
    const today = dayStart(localToday());
    return {
      available: true,
      finesDue: loans.filter((l) => l.fineStatus === 'DUE').reduce((n, l) => n + l.fine, 0),
      loans: loans.map((l) => ({
        id: l.id,
        title: l.copy.book.title,
        author: l.copy.book.author,
        accessionNo: l.copy.accessionNo,
        issuedOn: l.issuedOn.toISOString().slice(0, 10),
        dueOn: l.dueOn.toISOString().slice(0, 10),
        returnedOn: l.returnedOn ? l.returnedOn.toISOString().slice(0, 10) : null,
        lost: l.lost,
        overdue: l.returnedOn === null && !l.lost && l.dueOn < today,
        fine: l.fineStatus === 'DUE' ? l.fine : 0,
      })),
    };
  }

  /** Notices for the whole school, my campus, my class and my section, newest first. */
  @Get('announcements')
  @Permission('announcements')
  async announcements(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const ctx = await resolveStudent(this.prisma, user);
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.announcementsFor(ctx, take);
  }

  private async announcementsFor(ctx: StudentContext, take: number) {
    const rows = await this.prisma.announcement.findMany({
      where: {
        schoolId: ctx.schoolId,
        OR: announcementAudience({ campusId: ctx.campusId, classId: ctx.classId, sectionId: ctx.sectionId }),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        body: true,
        audience: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
    });
    return rows.map((a) => ({ ...a, createdBy: a.createdBy?.name ?? null }));
  }
}
