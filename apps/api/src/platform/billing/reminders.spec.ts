import { describe, expect, it } from 'vitest';
import { daysBetween, reminderDue } from './reminders.js';

describe('reminderDue', () => {
  const due = '2026-10-10';
  it.each([
    ['2026-10-06', null],
    ['2026-10-07', 'bill.due_soon'],
    ['2026-10-09', 'bill.due_soon'],
    ['2026-10-10', 'bill.due_today'],
    ['2026-10-16', 'bill.due_today'],
    ['2026-10-17', 'bill.overdue'],
    ['2026-10-23', 'bill.overdue'],
    ['2026-10-24', 'bill.read_only_tomorrow'],
    ['2026-10-25', null],
    ['2026-12-01', null],
  ])('on %s sends %s', (today, kind) => {
    expect(reminderDue(due, today)).toBe(kind);
  });

  it('counts days across months and years', () => {
    expect(daysBetween('2026-12-28', '2027-01-04')).toBe(7);
  });
});
