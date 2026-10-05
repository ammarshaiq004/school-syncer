/** Shapes returned by GET /students/directory and GET /students/:id/performance. */

export type FeeStatus = "PAID" | "PENDING" | "OVERDUE";
export type StudentStatus = "ACTIVE" | "LEFT" | "GRADUATED" | "SUSPENDED";
export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "LEAVE";

export interface DirectoryRow {
  id: string;
  admissionNo: string;
  name: string;
  photoUrl: string | null;
  classId: string | null;
  className: string | null;
  sectionId: string | null;
  sectionName: string | null;
  attendanceRate: number | null;
  guardian: { name: string; phone: string; relation: string } | null;
  /** null when the viewer's role has no access to fees. */
  feeStatus: FeeStatus | null;
  balance: number | null;
  status: StudentStatus;
}

export interface DirectoryPage {
  items: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FeeSummary {
  totalBilled: number;
  totalPaid: number;
  balance: number;
  overdueBalance: number;
  openInvoices: number;
  status: FeeStatus;
  lastPayment: { amount: number; receivedAt: string; receiptNo: string } | null;
}

export interface StudentPerformance {
  examId: string | null;
  examName: string | null;
  overallPercent: number | null;
  grade: string | null;
  subjects: { subject: string; percent: number }[];
  attendanceFrom: string;
  attendanceTo: string;
  attendanceByDay: { date: string; status: AttendanceStatus }[];
  attendanceCounts: Record<AttendanceStatus, number>;
  attendanceRate: number | null;
  /** null when the viewer's role has no access to fees. */
  feeSummary: FeeSummary | null;
}

/** The parts of GET /students/:id the drawer and edit form use. */
export interface StudentProfile {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  dateOfBirth: string | null;
  bFormNo: string | null;
  address: string | null;
  medicalNotes: string | null;
  status: StudentStatus;
  admittedOn: string;
  campus: { name: string };
  guardians: {
    relation: string;
    isPrimary: boolean;
    guardianId: string;
    guardian: { name: string; phone: string; cnic: string | null; userId: string | null };
  }[];
  enrollments: {
    id: string;
    rollNo: number | null;
    status: string;
    academicYear: { name: string };
    section: { name: string; class: { name: string } };
  }[];
  user?: { id: string; username: string | null; isActive: boolean; lastLoginAt: string | null } | null;
}

export const STATUS_OPTIONS: { value: StudentStatus; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "LEFT", label: "Left" },
  { value: "GRADUATED", label: "Graduated" },
];

export const FEE_STATUS_OPTIONS: { value: FeeStatus; label: string }[] = [
  { value: "PAID", label: "Paid" },
  { value: "PENDING", label: "Pending" },
  { value: "OVERDUE", label: "Overdue" },
];

export const ATTENDANCE_TONE: Record<AttendanceStatus, "success" | "warning" | "danger" | "info"> = {
  PRESENT: "success",
  LATE: "warning",
  ABSENT: "danger",
  LEAVE: "info",
};

export const ATTENDANCE_LEGEND = [
  { label: "Present", color: "var(--success)" },
  { label: "Late", color: "var(--warning)" },
  { label: "Absent", color: "var(--danger)" },
  { label: "Leave", color: "var(--info)" },
];

/** "Grade 6 A", or null when the student was never enrolled. */
export const classLabel = (r: Pick<DirectoryRow, "className" | "sectionName">) =>
  r.className ? `${r.className}${r.sectionName ? ` ${r.sectionName}` : ""}` : null;

/** 0300-1234567 to 923001234567 for wa.me links. */
export const whatsappNumber = (phone: string) => phone.replace(/\D/g, "").replace(/^0/, "92");

/** Tone for an attendance percentage: 90+ good, 75+ watch, below that a concern. */
export const rateTone = (rate: number) => (rate >= 90 ? "success" : rate >= 75 ? "warning" : "danger");
