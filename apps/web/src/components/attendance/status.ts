/** Attendance statuses as the API stores them. "Excused" in the UI is LEAVE. */
export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "LEAVE";

export interface StatusMeta {
  status: AttendanceStatus;
  short: string;
  label: string;
  /** Tinted pill used in the monthly grid. */
  pill: string;
  /** Legend dot. */
  dot: string;
}

/** P / A / L / E, in the order a cell cycles through. */
export const STATUS_META: StatusMeta[] = [
  { status: "PRESENT", short: "P", label: "Present", pill: "bg-success-tint text-success-text border-success/30", dot: "bg-success" },
  { status: "ABSENT", short: "A", label: "Absent", pill: "bg-danger-tint text-danger-text border-danger/30", dot: "bg-danger" },
  { status: "LATE", short: "L", label: "Late", pill: "bg-warning-tint text-warning-text border-warning/30", dot: "bg-warning" },
  { status: "LEAVE", short: "E", label: "Excused", pill: "bg-info-tint text-info-text border-info/30", dot: "bg-info" },
];

export const META_BY_STATUS = Object.fromEntries(STATUS_META.map((m) => [m.status, m])) as Record<AttendanceStatus, StatusMeta>;

/** Next status when a cell is clicked: unmarked starts at Present, then P, A, L, E and round again. */
export function nextStatus(current: AttendanceStatus | undefined): AttendanceStatus {
  if (!current) return "PRESENT";
  const i = STATUS_META.findIndex((m) => m.status === current);
  return STATUS_META[(i + 1) % STATUS_META.length].status;
}

export type StatusCounts = Record<AttendanceStatus, number>;
export const emptyCounts = (): StatusCounts => ({ PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 });

/** Same rule as the API: (present + late) / every marked day, one decimal; null when nothing is marked. */
export function attendanceRate(c: StatusCounts): number | null {
  const marked = c.PRESENT + c.ABSENT + c.LATE + c.LEAVE;
  if (!marked) return null;
  return Math.round(((c.PRESENT + c.LATE) / marked) * 1000) / 10;
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "3 Oct" */
export const shortDay = (iso: string) => utc(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** "Fri" */
export const weekdayShort = (iso: string) => utc(iso).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
/** "Friday 3 October" */
export const longDay = (iso: string) =>
  utc(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** "October 2026" from "2026-10" */
export const monthLabel = (ym: string) => utc(`${ym}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** "2026-10" shifted by n months. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
