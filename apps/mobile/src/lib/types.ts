/** A child as the parent endpoint returns it. */
export interface Child {
  id: string;
  name: string;
  relation: string;
  admissionNo: string;
  class: string | null;
  attendanceThisMonth: { present: number; absent: number; leave: number; absentDates: string[] };
  homework: { id: string; subject: string; title: string; details: string | null; dueDate: string }[];
  results: { examId: string; exam: string; percent: number; grade: string; position: number; passed: boolean }[];
  unpaidInvoices: { id: string; voucherNo: string; period: string; dueDate: string; balance: number }[];
  libraryBooks?: { title: string; dueOn: string; returned: boolean; overdue: boolean; fine: number }[];
  transport?: {
    route: string;
    stop: string | null;
    pickupTime: string | null;
    dropTime: string | null;
    vehicle: string | null;
    driverName: string | null;
    driverPhone: string | null;
  } | null;
}

export interface Period {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

export interface Slot {
  id: string;
  dayOfWeek: number;
  periodId: string;
  period: string;
  startTime: string;
  endTime: string;
  subjectId: string;
  subject: string;
  teacher: string | null;
  sectionId: string;
  section: string;
  room: string | null;
}

/** GET /student/today (the parts the student home uses). */
export type LiveState = 'upcoming' | 'live' | 'ended' | 'cancelled';
export type AssignmentState = 'pending' | 'overdue' | 'missing' | 'submitted' | 'graded' | 'returned';

export interface StudentToday {
  date: string;
  dayOfWeek: number;
  student: { id: string; name: string; firstName: string };
  section: { id: string; name: string } | null;
  liveClasses: {
    id: string;
    title: string;
    subject: string | null;
    teacher: string | null;
    startsAt: string;
    endsAt: string;
    durationMin: number;
    provider: 'JITSI' | 'ZOOM' | 'GOOGLE_MEET' | 'OTHER';
    recordingUrl: string | null;
    joined: boolean;
    state: LiveState;
    canJoin: boolean;
  }[];
  assignmentsDue: {
    id: string;
    title: string;
    subject: string;
    dueAt: string;
    maxPoints: number;
    status: AssignmentState;
    submittedAt: string | null;
    hoursLeft: number;
  }[];
}

/** GET /student/results (exams only; the app does not show the other lists yet). */
export interface StudentResults {
  exams: {
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
    subjects: { subject: string; max: number; marks: number | null; absent: boolean; passed: boolean }[];
  }[];
}
