import type { PrismaService } from '../prisma/prisma.service.js';
import { UserStatusService } from './user-status.service.js';

describe('UserStatusService support sessions', () => {
  const setup = (row: { endedAt: Date | null } | null) => {
    const findUnique = vi.fn().mockResolvedValue(row);
    const service = new UserStatusService({ supportSession: { findUnique } } as unknown as PrismaService);
    return { service, findUnique };
  };

  it('is open until the school ends it, and unknown sessions are closed', async () => {
    expect(await setup({ endedAt: null }).service.supportSessionOpen('s1')).toBe(true);
    expect(await setup({ endedAt: new Date() }).service.supportSessionOpen('s1')).toBe(false);
    expect(await setup(null).service.supportSessionOpen('s1')).toBe(false);
  });

  it('caches the answer until the session is forgotten', async () => {
    const { service, findUnique } = setup({ endedAt: null });
    await service.supportSessionOpen('s1');
    await service.supportSessionOpen('s1');
    expect(findUnique).toHaveBeenCalledTimes(1);
    service.forgetSession('s1');
    await service.supportSessionOpen('s1');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
