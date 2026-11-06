import { SubscriptionStatus } from '@prisma/client';
import { daysBefore } from '../common/dates.js';
import { schoolHealth, type HealthSnapshot } from './health.js';

const now = new Date('2026-10-28T10:00:00Z');
const today = '2026-10-28';
const old = new Date('2026-01-01T00:00:00Z');

/** One snapshot a day for the last `days` days. */
const history = (days: number, f: (daysAgo: number) => Partial<HealthSnapshot> = () => ({})): HealthSnapshot[] =>
  Array.from({ length: days }, (_, i) => ({
    day: daysBefore(today, i),
    students: 100,
    attendanceSessions: 3,
    staffActive7d: 5,
    ...f(i),
  }));

const health = (snapshots: HealthSnapshot[], status: SubscriptionStatus = SubscriptionStatus.ACTIVE, createdAt = old) =>
  schoolHealth({ status, createdAt, now, snapshots });

describe('schoolHealth', () => {
  it('does not judge a new school or one without snapshots', () => {
    expect(health(history(3), 'ACTIVE', new Date('2026-10-20T00:00:00Z'))).toMatchObject({ score: null, label: 'new' });
    expect(health([])).toMatchObject({ score: null, label: 'no_data' });
  });

  it('gives a busy, paying school full marks', () => {
    expect(health(history(30))).toEqual({ score: 100, label: 'healthy', reasons: [] });
  });

  it('marks a school nobody signs in to as at risk and says why', () => {
    const h = health(history(30, () => ({ staffActive7d: 0, attendanceSessions: 0 })), 'PAST_DUE');
    expect(h.label).toBe('at_risk');
    expect(h.score).toBe(0 + 0 + 5 + 15);
    expect(h.reasons).toEqual(['No staff sign-in in the last 7 days', 'No attendance taken in the last 7 days', 'Bill overdue']);
  });

  it('counts the days registers were taken, five days being full marks', () => {
    const h = health(history(30, (i) => ({ attendanceSessions: i < 3 ? 2 : 0 })));
    expect(h.score).toBe(30 + 18 + 25 + 15);
    expect(h.reasons).toEqual(['Attendance taken on 3 of the last 7 days']);
  });

  it('is neutral about the student trend until there are two weeks of history', () => {
    expect(health(history(5, (i) => ({ students: 100 - i * 10 }))).score).toBe(30 + 30 + 25 + 10);
  });

  it('takes points off for a falling student count, fewer for a small fall', () => {
    const fall = (to: number) => health(history(30, (i) => ({ students: i === 29 ? 100 : to })));
    expect(fall(95).score).toBe(30 + 30 + 25 + 8);
    const big = fall(60);
    expect(big.score).toBe(30 + 30 + 25);
    expect(big.reasons).toEqual(['Students fell from 100 to 60']);
  });

  it('scores a trial between a payer and a late payer, and ignores unordered input', () => {
    expect(health(history(30), 'TRIAL').score).toBe(90);
    expect(health(history(30).reverse(), 'SUSPENDED').reasons).toEqual(['Suspended']);
  });
});
