/** Schools work in local days; Pakistan by default (UTC+5). */
export const SCHOOL_TIMEZONE = process.env.SCHOOL_TIMEZONE ?? 'Asia/Karachi';

/** Today's date in the school's timezone as YYYY-MM-DD. */
export function localToday(timeZone = SCHOOL_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

/** A YYYY-MM-DD day as the UTC-midnight Date that @db.Date columns store. */
export const dayStart = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** The YYYY-MM-DD day `days` days before another. */
export function daysBefore(iso: string, days: number): string {
  const d = dayStart(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The instant a local day began in the school's timezone, for timestamp columns. */
export function startOfLocalDay(iso: string, timeZone = SCHOOL_TIMEZONE): Date {
  const utcMidnight = dayStart(iso);
  const asLocal = Date.parse(utcMidnight.toLocaleString('en-US', { timeZone }));
  const asUtc = Date.parse(utcMidnight.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(utcMidnight.getTime() - (asLocal - asUtc));
}
