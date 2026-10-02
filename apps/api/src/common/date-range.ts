import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { dayStart, localToday } from './dates.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The YYYY-MM-DD day after another. */
export function nextDay(iso: string): string {
  const d = dayStart(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A from/to range from query strings, defaulting to this month so far. */
export function dateRange(from?: string, to?: string) {
  const today = localToday();
  const parsed = z.object({ from: isoDate, to: isoDate }).safeParse({
    from: from || `${today.slice(0, 7)}-01`,
    to: to || today,
  });
  if (!parsed.success || parsed.data.from > parsed.data.to) {
    throw new BadRequestException('Use a from date on or before the to date, as YYYY-MM-DD');
  }
  return parsed.data;
}
