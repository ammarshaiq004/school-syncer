import { parentLoginStats } from './parent-logins.js';

const today = '2026-11-05';
const kid = (className: string) => [{ name: 'Child', className }];
const guardian = (id: string, userId: string | null, lastLoginAt: string | null, className = 'Grade 1') => ({
  id,
  name: `Parent ${id}`,
  phone: '0300',
  userId,
  lastLoginAt: lastLoginAt ? new Date(lastLoginAt) : null,
  students: kid(className),
});

describe('parentLoginStats', () => {
  it('sorts families into no login, never signed in, inactive and active', () => {
    const stats = parentLoginStats(
      [
        guardian('a', null, null),
        guardian('b', 'ub', null),
        guardian('c', 'uc', '2026-09-01T10:00:00Z'),
        guardian('d', 'ud', '2026-11-01T10:00:00Z'),
        guardian('e', 'ue', '2026-08-01T10:00:00Z'),
      ],
      // e signed in long ago but the API saw them this week.
      [{ userId: 'ue', date: '2026-11-03' }],
      today,
    );
    expect(stats.totals).toEqual({ families: 5, noAccount: 1, never: 1, inactive: 1, active: 2, active7: 2 });
    expect(stats.families.map((f) => [f.id, f.status])).toEqual([
      ['a', 'NO_ACCOUNT'],
      ['b', 'NEVER'],
      ['c', 'INACTIVE'],
      ['d', 'ACTIVE'],
      ['e', 'ACTIVE'],
    ]);
    expect(stats.families.find((f) => f.id === 'e')?.lastSeen).toBe('2026-11-03');
  });

  it('counts parents per day over the last 30 days', () => {
    const stats = parentLoginStats(
      [guardian('a', 'ua', null), guardian('b', 'ub', null)],
      [
        { userId: 'ua', date: '2026-11-05' },
        { userId: 'ub', date: '2026-11-05' },
        { userId: 'ua', date: '2026-11-04' },
        { userId: 'ua', date: '2026-09-01' },
      ],
      today,
    );
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.at(-1)).toEqual({ date: today, parents: 2 });
    expect(stats.daily.at(-2)).toEqual({ date: '2026-11-04', parents: 1 });
    expect(stats.daily[0].date).toBe('2026-10-07');
  });

  it('breaks the numbers down by class, counting a family once per class', () => {
    const twoClasses = { ...guardian('a', 'ua', '2026-11-04T00:00:00Z'), students: [...kid('Grade 2'), ...kid('Grade 2'), ...kid('Grade 10')] };
    const stats = parentLoginStats([twoClasses, guardian('b', null, null, 'Grade 2')], [], today);
    expect(stats.byClass).toEqual([
      { className: 'Grade 2', families: 2, withLogin: 1, active: 1 },
      { className: 'Grade 10', families: 1, withLogin: 1, active: 1 },
    ]);
  });
});
