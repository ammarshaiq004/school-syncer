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
