import { LiveStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  assignmentState,
  liveClassState,
  percent,
  quizIsOpen,
  quizScores,
} from './student-rules.js';

/** How far back the live-class attendance figure looks. */
const LIVE_WINDOW_DAYS = 30;

/**
 * One student's e-school picture: course progress, upcoming live classes,
 * assignments with status and points, and quiz scores. Shared by the parent
 * view (GET /parent/children/:id/learning) and the student's grades page.
 * Only published material of the student's own section is read.
 */
export async function learningSummary(
  prisma: PrismaService,
  student: { id: string; schoolId: string; sectionId: string | null },
  now = new Date(),
) {
  if (!student.sectionId) {
    return {
      courses: [],
      liveClasses: [],
      liveAttendance: { held: 0, attended: 0, percent: 0 },
      assignments: [],
      quizzes: [],
    };
  }
  const section = { schoolId: student.schoolId, sectionId: student.sectionId };
  const since = new Date(now.getTime() - LIVE_WINDOW_DAYS * 86_400_000);
  const [courses, upcoming, recentHeld, assignments, quizzes] = await Promise.all([
    prisma.course.findMany({
      where: { ...section, isPublished: true },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        color: true,
        subject: { select: { id: true, name: true } },
        teacher: { select: { name: true } },
        units: {
          select: {
            lessons: {
              where: { isPublished: true },
              select: {
                id: true,
                progress: {
                  where: { studentId: student.id },
                  select: { completedAt: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.liveClass.findMany({
      where: {
        ...section,
        status: { in: [LiveStatus.SCHEDULED, LiveStatus.LIVE] },
        // Anything that has not finished yet (classes run at most a few hours).
        startsAt: { gte: new Date(now.getTime() - 6 * 3_600_000) },
      },
      orderBy: { startsAt: 'asc' },
      take: 20,
      select: {
        id: true,
        title: true,
        startsAt: true,
        durationMin: true,
        status: true,
        provider: true,
        subject: { select: { name: true } },
        teacher: { select: { name: true } },
      },
    }),
    prisma.liveClass.findMany({
      where: { ...section, status: LiveStatus.ENDED, startsAt: { gte: since, lte: now } },
      select: { attendance: { where: { studentId: student.id }, select: { id: true } } },
    }),
    prisma.assignment.findMany({
      where: { ...section, isPublished: true },
      orderBy: { dueAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        dueAt: true,
        maxPoints: true,
        allowLate: true,
        subject: { select: { name: true } },
        submissions: {
          where: { studentId: student.id },
          select: {
            status: true,
            points: true,
            feedback: true,
            isLate: true,
            submittedAt: true,
            gradedAt: true,
          },
        },
      },
    }),
    prisma.quiz.findMany({
      where: { ...section, isPublished: true },
      orderBy: [{ closesAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        title: true,
        opensAt: true,
        closesAt: true,
        attemptsAllowed: true,
        showResults: true,
        subject: { select: { name: true } },
        attempts: {
          where: { studentId: student.id },
          select: { submittedAt: true, score: true, maxScore: true, needsReview: true },
        },
      },
    }),
  ]);

  const attended = recentHeld.filter((l) => l.attendance.length > 0).length;
  return {
    courses: courses.map((c) => {
      const lessons = c.units.flatMap((u) => u.lessons);
      const completed = lessons.filter((l) => l.progress.length > 0);
      const last = completed
        .map((l) => l.progress[0].completedAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        id: c.id,
        title: c.title,
        color: c.color,
        subject: c.subject.name,
        subjectId: c.subject.id,
        teacher: c.teacher?.name ?? null,
        lessons: lessons.length,
        completed: completed.length,
        percent: percent(completed.length, lessons.length),
        lastCompletedAt: last ?? null,
      };
    }),
    liveClasses: upcoming
      .map((l) => ({
        id: l.id,
        title: l.title,
        subject: l.subject?.name ?? null,
        teacher: l.teacher?.name ?? null,
        startsAt: l.startsAt,
        durationMin: l.durationMin,
        provider: l.provider,
        ...liveClassState(l, now),
      }))
      .filter((l) => l.state === 'upcoming' || l.state === 'live'),
    liveAttendance: {
      held: recentHeld.length,
      attended,
      percent: percent(attended, recentHeld.length),
    },
    assignments: assignments.map((a) => {
      const sub = a.submissions[0] ?? null;
      const graded = sub && sub.status !== 'SUBMITTED';
      return {
        id: a.id,
        title: a.title,
        subject: a.subject.name,
        dueAt: a.dueAt,
        maxPoints: a.maxPoints,
        status: assignmentState(a, sub, now),
        submittedAt: sub?.submittedAt ?? null,
        isLate: sub?.isLate ?? false,
        points: graded ? sub.points : null,
        feedback: graded ? sub.feedback : null,
        gradedAt: graded ? sub.gradedAt : null,
      };
    }),
    quizzes: quizzes.map((q) => {
      const scores = quizScores(q.attempts);
      return {
        id: q.id,
        title: q.title,
        subject: q.subject.name,
        opensAt: q.opensAt,
        closesAt: q.closesAt,
        isOpen: quizIsOpen(q, now),
        attemptsAllowed: q.attemptsAllowed,
        attempts: scores.attempts,
        submitted: scores.submitted,
        inProgress: scores.inProgress,
        // A teacher who hides results hides the score too until they change it.
        resultsHidden: !q.showResults,
        best: q.showResults ? scores.best : null,
        latest: q.showResults
          ? scores.latest
          : scores.latest && { ...scores.latest, score: null, percent: null },
      };
    }),
  };
}

export type LearningSummary = Awaited<ReturnType<typeof learningSummary>>;
