/** Response shapes of the student workspace API (GET /student/*). */

export type LiveState = "upcoming" | "live" | "ended" | "cancelled";
export type AssignmentState = "pending" | "overdue" | "missing" | "submitted" | "graded" | "returned";
export type LiveProvider = "JITSI" | "ZOOM" | "GOOGLE_MEET" | "OTHER";

export interface TodayPeriod {
  periodId: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  subject: string | null;
  subjectId: string | null;
  teacher: string | null;
  room: string | null;
}

export interface TodayLiveClass {
  id: string;
  title: string;
  subject: string | null;
  teacher: string | null;
  startsAt: string;
  durationMin: number;
  provider: LiveProvider;
  recordingUrl: string | null;
  joined: boolean;
  state: LiveState;
  canJoin: boolean;
  endsAt: string;
}

export interface TodayAssignment {
  id: string;
  title: string;
  subject: string;
  dueAt: string;
  maxPoints: number;
  status: AssignmentState;
  submittedAt: string | null;
  hoursLeft: number;
}

export interface TodayQuiz {
  id: string;
  title: string;
  subject: string;
  closesAt: string | null;
  timeLimitMin: number | null;
  questions: number;
  attemptsAllowed: number;
  attemptsUsed: number;
  attemptsLeft: number;
  inProgressAttemptId: string | null;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  audience: "SCHOOL" | "CAMPUS" | "CLASS" | "SECTION";
  createdAt: string;
  createdBy: string | null;
}

export interface StudentToday {
  date: string;
  dayOfWeek: number;
  student: { id: string; name: string; firstName: string };
  section: { id: string; name: string } | null;
  timetable: TodayPeriod[];
  liveClasses: TodayLiveClass[];
  assignmentsDue: TodayAssignment[];
  quizzesOpen: TodayQuiz[];
  announcements: Notice[];
}

export interface SubjectResult {
  subject: string;
  max: number;
  pass: number;
  marks: number | null;
  absent: boolean;
  passed: boolean;
}

export interface ExamResultItem {
  examId: string;
  exam: string;
  academicYear: string;
  publishedAt: string | null;
  obtained: number;
  maxTotal: number;
  percent: number;
  grade: string;
  position: number | null;
  passed: boolean;
  subjects: SubjectResult[];
  reportCardApi: string;
}

export interface ScoredAssignment {
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
}

export interface QuizScore {
  score: number | null;
  maxScore: number;
  percent: number | null;
}

export interface ScoredQuiz {
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
  best: QuizScore | null;
  latest: (QuizScore & { submittedAt: string | null; needsReview: boolean }) | null;
}

export interface CourseProgress {
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
}

export interface StudentResults {
  exams: ExamResultItem[];
  assignments: ScoredAssignment[];
  quizzes: ScoredQuiz[];
  courses: CourseProgress[];
}

export interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  leave: number;
  total: number;
  percent: number;
}

export interface StudentAttendanceMonth {
  month: string;
  summary: AttendanceCounts;
  year: AttendanceCounts;
  days: { date: string; status: "PRESENT" | "LATE" | "ABSENT" | "LEAVE"; note: string | null }[];
}

export interface StudentLibraryData {
  available: boolean;
  finesDue: number;
  loans: {
    id: string;
    title: string;
    author: string | null;
    accessionNo: string;
    issuedOn: string;
    dueOn: string;
    returnedOn: string | null;
    lost: boolean;
    overdue: boolean;
    fine: number;
  }[];
}
