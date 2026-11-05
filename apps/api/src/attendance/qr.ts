import { SCHOOL_TIMEZONE } from '../common/dates.js';

/** What a QR on an ID card holds: `SS:S:<admission no>` or `SS:E:<employee no>`. */
export const studentCode = (admissionNo: string) => `SS:S:${admissionNo}`;
export const staffCode = (employeeNo: string) => `SS:E:${employeeNo}`;

export type ScanTarget = { kind: 'student' | 'staff' | 'any'; value: string };

/**
 * Reads a scanned or typed code. A bare number (USB scanners and manual entry)
 * could be either kind, so it comes back as `any` and the caller tries both.
 */
export function parseScanCode(raw: string): ScanTarget | null {
  const text = raw.trim();
  const m = /^SS:([SE]):(.+)$/i.exec(text);
  if (m) return { kind: m[1].toUpperCase() === 'S' ? 'student' : 'staff', value: m[2].trim() };
  if (!text || /^SS:/i.test(text)) return null;
  return { kind: 'any', value: text };
}

/** Arrival on time counts as present; at or after the cut-off ("HH:MM", school local time) it is late. */
export function scanStatus(at: Date, lateAfter: string, timeZone = SCHOOL_TIMEZONE): 'PRESENT' | 'LATE' {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return parts > lateAfter ? 'LATE' : 'PRESENT';
}
