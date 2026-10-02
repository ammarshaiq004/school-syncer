/** "Rs 12,500" */
export const rupees = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/** "5 Oct" or "5 Oct 2026" from an ISO date. */
export const day = (d: string, withYear = false) =>
  new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

/** Today on this phone as YYYY-MM-DD. */
export const todayIso = () => new Date().toLocaleDateString('en-CA');

/** 1 = Monday ... 7 = Sunday, matching the timetable API. */
export const isoWeekday = (d = new Date()) => ((d.getDay() + 6) % 7) + 1;

export const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "1 parent", "3 parents" */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
