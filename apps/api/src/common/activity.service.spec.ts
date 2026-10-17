import type { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService, activityRoles } from './activity.service.js';

function service(fail = false) {
  const calls: unknown[] = [];
  const prisma = {
    userActivityDay: {
      createMany: async (args: unknown) => {
        calls.push(args);
        if (fail) throw new Error('database is down');
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;
  const activity = new ActivityService(prisma);
  let day = '2026-10-15';
  activity.today = () => day;
  return { activity, calls, setDay: (d: string) => (day = d) };
}

describe('ActivityService', () => {
  it('writes one row per user per day, with their distinct roles', async () => {
    const { activity, calls, setDay } = service();
    const grants = [
      { role: 'TEACHER' as const, campusId: 'a' },
      { role: 'TEACHER' as const, campusId: 'b' },
      { role: 'ACCOUNTANT' as const, campusId: null },
    ];
    await activity.seen('u1', 's1', grants);
    await activity.seen('u1', 's1', grants);
    expect(calls).toEqual([
      {
        data: [{ userId: 'u1', schoolId: 's1', date: new Date('2026-10-15T00:00:00.000Z'), roles: ['ACCOUNTANT', 'TEACHER'] }],
        skipDuplicates: true,
      },
    ]);
    setDay('2026-10-16');
    await activity.seen('u1', 's1', grants);
    await activity.seen('u2', 's1', []);
    expect(calls).toHaveLength(3);
  });

  it('never fails the request and tries again after a failed write', async () => {
    const { activity, calls } = service(true);
    await expect(activity.seen('u1', 's1', [])).resolves.toBeUndefined();
    await activity.seen('u1', 's1', []);
    expect(calls).toHaveLength(2);
  });

  it('lists roles once each, sorted', () => {
    expect(
      activityRoles([
        { role: 'OWNER', campusId: null },
        { role: 'ADMIN', campusId: 'x' },
        { role: 'OWNER', campusId: 'y' },
      ]),
    ).toEqual(['ADMIN', 'OWNER']);
  });
});
