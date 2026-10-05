/** Response shapes of the student e-school API (courses, live classes, assignments, quizzes) and parent learning. */

import type { FileInfo, FileLink } from "@/components/elearning/file-upload";
import type { AssignmentState, LiveProvider, LiveState } from "@/components/student/types";

export type LessonKind = "VIDEO" | "TEXT" | "LINK" | "DOCUMENT";
type Ref = { id: string; name: string };

/** GET /student/courses item. */
export interface StudentCourseCard {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  subject: Ref;
  teacher: Ref | null;
  lessonCount: number;
  completedCount: number;
  percent: number;
  nextLesson: { id: string; title: string } | null;
}

export interface StudentLessonItem {
  id: string;
  title: string;
  kind: LessonKind;
  durationMin: number | null;
  completed: boolean;
  completedAt: string | null;
}

/** GET /student/courses/:id */
export interface StudentCourseDetail extends Omit<StudentCourseCard, "nextLesson"> {
  units: { id: string; title: string; lessons: StudentLessonItem[] }[];
}

/** GET /student/lessons/:id */
export interface StudentLesson {
  id: string;
  title: string;
  kind: LessonKind;
  body: string | null;
  url: string | null;
  /** Uploaded video or document; played or opened instead of the link. */
  file: FileLink | null;
  durationMin: number | null;
  publishedAt: string | null;
  embedUrl: string | null;
  completed: boolean;
  completedAt: string | null;
  course: { id: string; title: string; color: string | null };
  unit: { id: string; title: string };
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

/** POST /student/lessons/:id/complete */
export interface LessonCompleteResult {
  lessonId: string;
  completed: true;
  completedAt: string;
  completedCount: number;
  lessonCount: number;
  percent: number;
}

export type LiveStatus = "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";

/** GET /student/live item. */
export interface StudentLiveItem {
  id: string;
  title: string;
  subject: Ref | null;
  teacher: Ref | null;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  provider: LiveProvider;
  status: LiveStatus;
  recordingUrl: string | null;
  joinOpensAt: string;
  joinWindow: "early" | "open" | "closed";
  attended: boolean;
  joinedAt: string | null;
}

export interface StudentLiveData {
  liveNow: StudentLiveItem[];
  upcoming: StudentLiveItem[];
  recent: StudentLiveItem[];
}

export type Urgency = "overdue" | "today" | "soon" | "later" | null;

export interface StudentSubmission {
  id: string;
  body: string | null;
  linkUrl: string | null;
  /** Uploaded work: a link to open it on the detail page, name and size only in lists. */
  file: FileLink | FileInfo | null;
  submittedAt: string;
  isLate: boolean;
  status: "SUBMITTED" | "GRADED" | "RETURNED";
  points: number | null;
  feedback: string | null;
  gradedAt: string | null;
}

/** GET /student/assignments item. */
export interface StudentAssignmentItem {
  id: string;
  title: string;
  dueAt: string;
  maxPoints: number;
  allowLate: boolean;
  attachmentUrl: string | null;
  attachment: FileLink | FileInfo | null;
  subject: Ref;
  course: { id: string; title: string } | null;
  state: AssignmentState;
  urgency: Urgency;
  hoursLeft: number;
  canSubmit: boolean;
  submission: StudentSubmission | null;
}

/** GET /student/assignments/:id */
export interface StudentAssignmentDetail extends StudentAssignmentItem {
  instructions: string | null;
  createdAt: string;
  createdBy: Ref | null;
  blockedReason: string | null;
}

export type QuizWindow = "upcoming" | "open" | "closed";
export interface Score {
  score: number;
  maxScore: number;
  percent: number;
}
export interface LatestScore extends Score {
  submittedAt: string;
  needsReview: boolean;
}

/** GET /student/quizzes item. */
export interface StudentQuizCard {
  id: string;
  title: string;
  instructions: string | null;
  subject: Ref;
  course: { id: string; title: string } | null;
  timeLimitMin: number | null;
  opensAt: string | null;
  closesAt: string | null;
  questionCount: number;
  totalPoints: number;
  attemptsAllowed: number;
  attemptsUsed: number;
  attemptsLeft: number;
  window: QuizWindow;
  canStart: boolean;
  inProgressAttemptId: string | null;
  showResults: boolean;
  submitted: number;
  best: Score | null;
  latest: LatestScore | null;
}

export interface AttemptSummary {
  id: string;
  startedAt: string;
  submittedAt: string;
  score: number | null;
  maxScore: number;
  percent: number | null;
  needsReview: boolean;
}

/** GET /student/quizzes/:id */
export interface StudentQuizDetail extends StudentQuizCard {
  attempts: AttemptSummary[];
}

export type QuestionKind = "SINGLE" | "MULTI" | "TRUE_FALSE" | "SHORT";
export type Answer = number[] | string;

export interface PaperQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  points: number;
}

/** An attempt still being written (no answer keys). */
export interface AttemptPaper {
  attemptId: string;
  status: "in_progress";
  quiz: { id: string; title: string; instructions: string | null; timeLimitMin: number | null; closesAt: string | null };
  startedAt: string;
  deadline: string | null;
  graceSeconds: number;
  serverNow: string;
  answers: Record<string, Answer>;
  questions: PaperQuestion[];
}

export type Outcome = "correct" | "incorrect" | "unanswered" | "pending" | "reviewed";

/** A submitted attempt. */
export interface AttemptResult {
  attemptId: string;
  status: "submitted";
  quiz: { id: string; title: string };
  startedAt: string;
  submittedAt: string;
  timedOut: boolean;
  showResults: boolean;
  score: number | null;
  maxScore: number;
  percent: number | null;
  needsReview: boolean;
  attemptsLeft: number;
  canRetry: boolean;
  answersVisible: boolean;
  questions:
    | (PaperQuestion & { answer: Answer | null; earned?: number | null; outcome?: Outcome; correct: number[] | string[] | null })[]
    | null;
}

export type AttemptView = AttemptPaper | AttemptResult;

/** PUT /student/attempts/:id */
export interface AutosaveResult {
  attemptId: string;
  savedAt: string;
  answered: number;
  deadline: string | null;
  serverNow: string;
}

/** GET /parent/children/:studentId/learning */
export interface ParentLearning {
  student: { id: string; name: string; class: string | null };
  courses: {
    id: string;
    title: string;
    color: string | null;
    subject: string;
    subjectId: string;
    teacher: string | null;
    lessons: number;
    completed: number;
    percent: number;
    lastCompletedAt: string | null;
  }[];
  liveClasses: {
    id: string;
    title: string;
    subject: string | null;
    teacher: string | null;
    startsAt: string;
    durationMin: number;
    provider: LiveProvider;
    state: LiveState;
    canJoin: boolean;
    endsAt: string;
  }[];
  liveAttendance: { held: number; attended: number; percent: number | null };
  assignments: {
    id: string;
    title: string;
    subject: string;
    dueAt: string;
    maxPoints: number;
    status: AssignmentState;
    submittedAt: string | null;
    isLate: boolean;
    points: number | null;
    feedback: string | null;
    gradedAt: string | null;
  }[];
  quizzes: {
    id: string;
    title: string;
    subject: string;
    opensAt: string | null;
    closesAt: string | null;
    isOpen: boolean;
    attemptsAllowed: number;
    attempts: number;
    submitted: number;
    inProgress: boolean;
    resultsHidden: boolean;
    best: { score: number | null; maxScore: number; percent: number | null } | null;
    latest: { score: number | null; maxScore: number; percent: number | null; submittedAt: string | null; needsReview: boolean } | null;
  }[];
}
