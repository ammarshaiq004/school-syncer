import {
  attendanceFromJoins,
  jitsiUrl,
  joinWindow,
  liveEndsAt,
  mondayOf,
  roomCode,
  slotOccurrence,
  weekdayDate,
} from './live-rules.js';

describe('roomCode / jitsiUrl', () => {
  it('builds a 10 character code from the room alphabet', () => {
    const code = roomCode();
    expect(code).toMatch(/^[a-zA-Z0-9]{10}$/);
    expect(roomCode(4, () => 0)).toBe('aaaa');
  });

  it('names the room after the school slug', () => {
    expect(jitsiUrl('demo-school', 'AbCdEfGh23')).toBe(
      'https://meet.jit.si/SchoolSyncer-demo-school-AbCdEfGh23',
    );
    expect(jitsiUrl('demo-school')).toMatch(
      /^https:\/\/meet\.jit\.si\/SchoolSyncer-demo-school-[a-zA-Z0-9]{10}$/,
    );
  });

  it('strips characters that would break the URL', () => {
    expect(jitsiUrl('a b/c?--d-', 'x')).toBe(
      'https://meet.jit.si/SchoolSyncer-abc-d-x',
    );
    expect(jitsiUrl('///', 'x')).toBe(
      'https://meet.jit.si/SchoolSyncer-school-x',
    );
  });
});

describe('joinWindow', () => {
  const startsAt = new Date('2026-10-05T05:00:00Z');
  const at = (iso: string) => new Date(iso);
  const scheduled = { status: 'SCHEDULED' as const, startsAt, durationMin: 40 };

  it('opens 15 minutes before the start and closes at the planned end', () => {
    expect(joinWindow(scheduled, at('2026-10-05T04:44:59Z'))).toBe('early');
    expect(joinWindow(scheduled, at('2026-10-05T04:45:00Z'))).toBe('open');
    expect(joinWindow(scheduled, at('2026-10-05T05:39:59Z'))).toBe('open');
    expect(joinWindow(scheduled, at('2026-10-05T05:40:00Z'))).toBe('closed');
  });

  it('follows the teacher: live is open, ended or cancelled is closed', () => {
    expect(
      joinWindow({ ...scheduled, status: 'LIVE' }, at('2026-10-05T03:00:00Z')),
    ).toBe('open');
    expect(
      joinWindow({ ...scheduled, status: 'LIVE' }, at('2026-10-05T07:00:00Z')),
    ).toBe('open');
    expect(
      joinWindow({ ...scheduled, status: 'ENDED' }, at('2026-10-05T05:10:00Z')),
    ).toBe('closed');
    expect(
      joinWindow(
        { ...scheduled, status: 'CANCELLED' },
        at('2026-10-05T05:10:00Z'),
      ),
    ).toBe('closed');
  });

  it('computes the planned end', () => {
    expect(liveEndsAt(startsAt, 40).toISOString()).toBe(
      '2026-10-05T05:40:00.000Z',
    );
  });
});

describe('week maths', () => {
  it('finds the Monday of any day', () => {
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // Monday
    expect(mondayOf('2026-10-08')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // Sunday
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });

  it('maps weekday numbers to dates', () => {
    expect(weekdayDate('2026-10-05', 1)).toBe('2026-10-05');
    expect(weekdayDate('2026-10-05', 5)).toBe('2026-10-09');
    expect(weekdayDate('2026-12-28', 7)).toBe('2027-01-03');
  });

  it('places a period in the school timezone', () => {
    const occ = slotOccurrence(
      '2026-10-05',
      { dayOfWeek: 3, startTime: '08:30', endTime: '09:10' },
      'Asia/Karachi',
    );
    expect(occ.date).toBe('2026-10-07');
    expect(occ.startsAt.toISOString()).toBe('2026-10-07T03:30:00.000Z');
    expect(occ.durationMin).toBe(40);
    const utc = slotOccurrence(
      '2026-10-05',
      { dayOfWeek: 1, startTime: '00:15', endTime: '01:00' },
      'UTC',
    );
    expect(utc.startsAt.toISOString()).toBe('2026-10-05T00:15:00.000Z');
  });
});

describe('attendanceFromJoins', () => {
  it('marks joiners present and everyone else absent', () => {
    expect(attendanceFromJoins(['a', 'b', 'c'], new Set(['b', 'x']))).toEqual([
      { studentId: 'a', status: 'ABSENT' },
      { studentId: 'b', status: 'PRESENT' },
      { studentId: 'c', status: 'ABSENT' },
    ]);
  });
});
