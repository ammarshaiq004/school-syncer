/** Shapes returned by /elearning/live (staff live classes) and date helpers in the school timezone. */

export type LiveProvider = "JITSI" | "ZOOM" | "GOOGLE_MEET" | "OTHER";
export type LiveStatus = "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";

export interface LiveClass {
  id: string;
  sectionId: string;
  subjectId: string | null;
  teacherId: string | null;
  title: string;
  startsAt: string;
  durationMin: number;
  provider: LiveProvider;
  joinUrl: string;
  status: LiveStatus;
  recordingUrl: string | null;
  timetableSlotId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  section: { id: string; name: string; class: { id: string; name: string; campusId: string } };
  subject: { id: string; name: string } | null;
  teacher: { id: string; name: string } | null;
  endsAt: string;
  joinOpensAt: string;
  joinWindow: "early" | "open" | "closed";
  attendanceCount: number;
  canManage?: boolean;
}

export interface LiveAttendance {
  liveClass: LiveClass;
  date: string;
  sheetTaken: boolean;
  canMarkAttendance: boolean;
  studentCount: number;
  joinedCount: number;
  students: {
    id: string;
    firstName: string;
    lastName: string | null;
    admissionNo: string;
    photoUrl: string | null;
    rollNo: number | null;
    joined: boolean;
    joinedAt: string | null;
    leftAt: string | null;
  }[];
}

export const PROVIDER_LABEL: Record<LiveProvider, string> = {
  JITSI: "Jitsi Meet",
  ZOOM: "Zoom",
  GOOGLE_MEET: "Google Meet",
  OTHER: "Other link",
};

/** Schools run on Pakistan time; the API schedules timetable classes in it too. */
export const SCHOOL_TZ = "Asia/Karachi";
const SCHOOL_OFFSET = "+05:00";

/** "09:30" in school time. */
export const liveTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: SCHOOL_TZ });

/** "YYYY-MM-DD" in school time. */
export const liveDate = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ });

/** "Mon 6 Oct" in school time. */
export const liveDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SCHOOL_TZ });

/** ISO instant for a school-local date and "HH:MM" time. */
export const schoolInstant = (date: string, time: string) => new Date(`${date}T${time}:00${SCHOOL_OFFSET}`).toISOString();

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing a YYYY-MM-DD date. */
export function mondayOf(date: string) {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export const sectionLabel = (c: LiveClass) => `${c.section.class.name} ${c.section.name}`;

/** Human countdown such as "in 2 h 15 min" or "in 4 days". */
export function countdown(iso: string, now: number) {
  const mins = Math.round((new Date(iso).getTime() - now) / 60000);
  if (mins <= 0) return "starting now";
  if (mins < 60) return `in ${mins} min`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  const d = Math.round(mins / (24 * 60));
  return `in ${d} ${d === 1 ? "day" : "days"}`;
}
