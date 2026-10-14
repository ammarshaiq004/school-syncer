import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { retryOnConflict } from './serializable.js';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('conflict', { code, clientVersion: 'test' });

describe('retryOnConflict', () => {
  it('tries again after a serialization failure', async () => {
    const fn = vi.fn().mockRejectedValueOnce(prismaError('P2034')).mockResolvedValue('done');
    await expect(retryOnConflict(fn)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a unique-key clash only when asked to', async () => {
    const clash = vi.fn().mockRejectedValueOnce(prismaError('P2002')).mockResolvedValue('done');
    await expect(retryOnConflict(clash)).rejects.toMatchObject({ code: 'P2002' });
    const retried = vi.fn().mockRejectedValueOnce(prismaError('P2002')).mockResolvedValue('done');
    await expect(retryOnConflict(retried, { codes: ['P2002'] })).resolves.toBe('done');
  });

  it('gives up after the last attempt and passes other errors straight through', async () => {
    const always = vi.fn().mockRejectedValue(prismaError('P2034'));
    await expect(retryOnConflict(always, { attempts: 3 })).rejects.toMatchObject({ code: 'P2034' });
    expect(always).toHaveBeenCalledTimes(3);
    const other = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(retryOnConflict(other)).rejects.toThrow('boom');
    expect(other).toHaveBeenCalledTimes(1);
  });
});
