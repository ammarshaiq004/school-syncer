import { Audience, LiveStatus, SubmissionStatus } from '@prisma/client';
import {
  announcementAudience,
  announcementReaches,
  assignmentState,
  attendanceSummary,
  isoWeekday,
  liveClassState,
  monthBounds,
  nextDay,
  percent,
  quizIsOpen,
  quizScores,
} from './student-rules.js';

const at = (iso: string) => new Date(iso);

describe('isoWeekday / nextDay', () => {
  it('numbers Monday 1 to Sunday 7', () => {
    expect(isoWeekday('2026-10-05')).toBe(1); // Monday
    expect(isoWeekday('2026-10-10')).toBe(6);
    expect(isoWeekday('2026-10-11')).toBe(7);
  });
  it('rolls over months and years', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});

describe('monthBounds', () => {
  it('gives the first and last day', () => {
    expect(monthBounds('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(monthBounds('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthBounds('2026-10')?.last).toBe('2026-10-31');
  });
  it('rejects malformed months', () => {
    expect(monthBounds('2026-13')).toBeNull();
    expect(monthBounds('2026-1')).toBeNull();
    expect(monthBounds('october')).toBeNull();
  });
});

describe('announcement audience', () => {
  const me = { campusId: 'c1', classId: 'k1', sectionId: 's1' };
  it('covers school, campus, class and section', () => {
    expect(announcementAudience(me)).toEqual([
      { audience: Audience.SCHOOL },
      { audience: Audience.CAMPUS, targetId: 'c1' },
      { audience: Audience.CLASS, targetId: 'k1' },
      { audience: Audience.SECTION, targetId: 's1' },
    ]);
  });
  it('skips class and section for a student without an enrollment', () => {
    expect(announcementAudience({ campusId: 'c1', classId: null, sectionId: null })).toHaveLength(2);
  });
  it('matches only my own targets', () => {
    expect(announcementReaches({ audience: Audience.SCHOOL, targetId: null }, me)).toBe(true);
    expect(announcementReaches({ audience: Audience.SECTION, targetId: 's1' }, me)).toBe(true);
    expect(announcementReaches({ audience: Audience.SECTION, targetId: 's2' }, me)).toBe(false);
    expect(announcementReaches({ audience: Audience.CLASS, targetId: 'k2' }, me)).toBe(false);
    expect(announcementReaches({ audience: Audience.CAMPUS, targetId: 'c2' }, me)).toBe(false);
  });
});

describe('liveClassState', () => {
  const lc = { status: LiveStatus.SCHEDULED, startsAt: at('2026-10-05T09:00:00Z'), durationMin: 40 };
  it('is upcoming and closed until 15 minutes before', () => {
    expect(liveClassState(lc, at('2026-10-05T08:40:00Z'))).toMatchObject({ state: 'upcoming', canJoin: false });
    expect(liveClassState(lc, at('2026-10-05T08:45:00Z'))).toMatchObject({ state: 'upcoming', canJoin: true });
  });
  it('is live during the slot and ended after it', () => {
    expect(liveClassState(lc, at('2026-10-05T09:20:00Z'))).toMatchObject({ state: 'live', canJoin: true });
    expect(liveClassState(lc, at('2026-10-05T09:41:00Z'))).toMatchObject({ state: 'ended', canJoin: false });
    expect(liveClassState(lc, at('2026-10-05T09:00:00Z')).endsAt).toEqual(at('2026-10-05T09:40:00Z'));
  });
  it("follows the teacher's start, end and cancel", () => {
    const late = at('2026-10-05T10:30:00Z');
    expect(liveClassState({ ...lc, status: LiveStatus.LIVE }, late)).toMatchObject({ state: 'live', canJoin: true });
    expect(liveClassState({ ...lc, status: LiveStatus.ENDED }, at('2026-10-05T09:10:00Z')).state).toBe('ended');
    expect(liveClassState({ ...lc, status: LiveStatus.CANCELLED }, at('2026-10-05T09:10:00Z'))).toMatchObject({
      state: 'cancelled',
      canJoin: false,
    });
  });
});

describe('assignmentState', () => {
  const due = { dueAt: at('2026-10-06T19:00:00Z'), allowLate: true };
  const before = at('2026-10-06T10:00:00Z');
  const after = at('2026-10-07T10:00:00Z');
  it('is pending before the deadline and overdue or missing after it', () => {
    expect(assignmentState(due, null, before)).toBe('pending');
    expect(assignmentState(due, null, after)).toBe('overdue');
    expect(assignmentState({ ...due, allowLate: false }, null, after)).toBe('missing');
  });
  it('follows the submission once there is one', () => {
    expect(assignmentState(due, { status: SubmissionStatus.SUBMITTED }, after)).toBe('submitted');
    expect(assignmentState(due, { status: SubmissionStatus.GRADED }, after)).toBe('graded');
    expect(assignmentState(due, { status: SubmissionStatus.RETURNED }, before)).toBe('returned');
  });
});

describe('percent', () => {
  it('rounds and handles empty totals', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBe(0);
  });
});

describe('quizScores', () => {
  it('picks the best and the latest submitted attempt', () => {
    const s = quizScores([
      { submittedAt: at('2026-10-01T10:00:00Z'), score: 8, maxScore: 10, needsReview: false },
      { submittedAt: at('2026-10-02T10:00:00Z'), score: 6, maxScore: 10, needsReview: true },
      { submittedAt: null, score: null, maxScore: 10, needsReview: false },
    ]);
    expect(s).toMatchObject({ attempts: 3, submitted: 2, inProgress: true });
    expect(s.best).toEqual({ score: 8, maxScore: 10, percent: 80 });
    expect(s.latest).toMatchObject({ score: 6, percent: 60, needsReview: true });
  });
  it('is empty without attempts', () => {
    expect(quizScores([])).toEqual({ attempts: 0, submitted: 0, inProgress: false, best: null, latest: null });
  });
});

describe('quizIsOpen', () => {
  const now = at('2026-10-05T10:00:00Z');
  it('respects open and close times', () => {
    expect(quizIsOpen({ opensAt: null, closesAt: null }, now)).toBe(true);
    expect(quizIsOpen({ opensAt: at('2026-10-05T11:00:00Z'), closesAt: null }, now)).toBe(false);
    expect(quizIsOpen({ opensAt: null, closesAt: at('2026-10-05T10:00:00Z') }, now)).toBe(false);
    expect(quizIsOpen({ opensAt: at('2026-10-05T09:00:00Z'), closesAt: at('2026-10-05T12:00:00Z') }, now)).toBe(true);
  });
});

describe('attendanceSummary', () => {
  it('counts late as present', () => {
    expect(attendanceSummary(['PRESENT', 'LATE', 'ABSENT', 'LEAVE'])).toEqual({
      present: 1,
      late: 1,
      absent: 1,
      leave: 1,
      total: 4,
      percent: 50,
    });
    expect(attendanceSummary([]).percent).toBe(0);
  });
});
