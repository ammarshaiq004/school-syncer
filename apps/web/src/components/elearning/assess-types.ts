/** Shapes returned by /elearning/assignments and /elearning/quizzes (staff), plus small helpers. */

import { liveDate, liveTime, schoolInstant, SCHOOL_TZ } from "./live-types";
import type { CourseSection } from "./courses-types";
import type { FileInfo, FileLink } from "./file-upload";

export interface AssessBase {
  id: string;
  sectionId: string;
  subjectId: string;
  courseId: string | null;
  createdById: string | null;
  title: string;
  instructions: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  section: CourseSection;
  subject: { id: string; name: string; code: string | null };
  course: { id: string; title: string } | null;
  createdBy: { id: string; name: string } | null;
}

/* ------------------------------------------------------------------ */
/* Assignments                                                          */
/* ------------------------------------------------------------------ */

export interface Assignment extends AssessBase {
  attachmentUrl: string | null;
  /** Uploaded worksheet: with a link from detail endpoints, name and size only in lists. */
  attachment: FileLink | FileInfo | null;
  dueAt: string;
  maxPoints: number;
  allowLate: boolean;
}

export interface AssignmentRow extends Assignment {
  studentCount: number;
  submittedCount: number;
  toGradeCount: number;
  gradedCount: number;
  lateCount: number;
  canManage: boolean;
}

export type SubmissionStatus = "SUBMITTED" | "GRADED" | "RETURNED";
export type StudentWorkState = "pending" | "overdue" | "missing" | "submitted" | "graded" | "returned";

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  body: string | null;
  linkUrl: string | null;
  /** Uploaded work with a link to open it (missing on grade responses). */
  file?: FileLink | null;
  submittedAt: string;
  isLate: boolean;
  status: SubmissionStatus;
  points: number | null;
  feedback: string | null;
  gradedById: string | null;
  gradedAt: string | null;
  gradedBy: { id: string; name: string } | null;
}

export interface StudentRef {
  id: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  photoUrl: string | null;
}

export interface SubmissionRow {
  student: StudentRef;
  state: StudentWorkState;
  submission: Submission | null;
}

export interface SubmissionsResponse {
  assignment: Assignment;
  students: SubmissionRow[];
  summary: { students: number; submitted: number; toGrade: number; graded: number; late: number; missing: number; pending: number };
}

/** Staff-facing label and tone for a student's standing on an assignment. */
export const WORK_STATE: Record<StudentWorkState, { label: string; tone: "warning" | "danger" | "success" | "info" | "neutral" }> = {
  pending: { label: "Not handed in", tone: "neutral" },
  overdue: { label: "Overdue", tone: "danger" },
  missing: { label: "Missing", tone: "danger" },
  submitted: { label: "To grade", tone: "warning" },
  graded: { label: "Graded", tone: "success" },
  returned: { label: "Returned to redo", tone: "info" },
};

/* ------------------------------------------------------------------ */
/* Quizzes                                                              */
/* ------------------------------------------------------------------ */

export type QuestionKind = "SINGLE" | "MULTI" | "TRUE_FALSE" | "SHORT";
export type QuizWindow = "upcoming" | "open" | "closed";

export interface Question {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  /** Option indexes, or accepted answers for SHORT. */
  correct: (number | string)[];
  points: number;
  sortOrder: number;
}

export interface Quiz extends AssessBase {
  timeLimitMin: number | null;
  opensAt: string | null;
  closesAt: string | null;
  attemptsAllowed: number;
  shuffleQuestions: boolean;
  showResults: boolean;
}

export interface QuizStats {
  questionCount: number;
  totalPoints: number;
  studentCount: number;
  window: QuizWindow;
  attemptCount: number;
  studentsAttempted: number;
  inProgressCount: number;
  needsReviewCount: number;
  avgPercent: number | null;
  canManage: boolean;
}

export type QuizRow = Quiz & QuizStats;

export interface QuizDetail extends QuizRow {
  questions: Question[];
  /** Any attempt exists: only question wording may change. */
  locked: boolean;
}

export interface ScoreRef {
  score: number;
  maxScore: number;
  percent: number;
}

export interface QuizResults {
  quiz: { id: string; title: string; showResults: boolean };
  maxScore: number;
  summary: { students: number; attempted: number; inProgress: number; needsReview: number; avgPercent: number | null };
  students: {
    student: StudentRef;
    attempts: number;
    submitted: number;
    inProgress: boolean;
    best: ScoreRef | null;
    latest: (ScoreRef & { submittedAt: string; needsReview: boolean }) | null;
    needsReview: boolean;
    attemptList: { id: string; startedAt: string; submittedAt: string | null; score: number | null; maxScore: number; percent: number | null; needsReview: boolean }[];
  }[];
  questionStats: { questionId: string; prompt: string; kind: QuestionKind; points: number; answered: number; correct: number; pending: number; avgEarned: number | null }[];
}

export type AnswerOutcome = "correct" | "incorrect" | "unanswered" | "pending" | "reviewed";

export interface AttemptDetail {
  id: string;
  quizId: string;
  studentId: string;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number;
  needsReview: boolean;
  percent: number | null;
  student: { id: string; name: string; admissionNo: string };
  quiz: { id: string; title: string };
  questions: (Question & { answer: number[] | string | null; earned: number; outcome: AnswerOutcome; reviewPoints: number | null })[];
}

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  SINGLE: "Single choice",
  MULTI: "Multiple choice",
  TRUE_FALSE: "True or false",
  SHORT: "Short answer",
};

export const WINDOW_LABEL: Record<QuizWindow, string> = { upcoming: "Upcoming", open: "Open", closed: "Closed" };

export const OUTCOME: Record<AnswerOutcome, { label: string; tone: "success" | "danger" | "neutral" | "warning" | "info" }> = {
  correct: { label: "Correct", tone: "success" },
  incorrect: { label: "Incorrect", tone: "danger" },
  unanswered: { label: "Not answered", tone: "neutral" },
  pending: { label: "Needs review", tone: "warning" },
  reviewed: { label: "Reviewed", tone: "info" },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** "Mon 6 Oct, 5:00 pm" in school time. */
export function whenText(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SCHOOL_TZ });
  const time = d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: SCHOOL_TZ }).toLowerCase();
  return `${date}, ${time}`;
}

/** ISO instant -> value for <input type="datetime-local"> in school time. */
export const toLocalInput = (iso: string | null | undefined) => (iso ? `${liveDate(iso)}T${liveTime(iso)}` : "");

/** <input type="datetime-local"> value (school time) -> ISO instant, or null when blank. */
export const fromLocalInput = (value: string) => (value ? schoolInstant(value.slice(0, 10), value.slice(11, 16)) : null);

/** "84%" or a dash. */
export const pct = (n: number | null | undefined) => (n == null ? "–" : `${Math.round(n)}%`);

/** "7.5" without trailing zeros. */
export const pts = (n: number) => String(Math.round(n * 10) / 10);
