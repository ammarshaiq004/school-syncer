import type { PrismaService } from '../prisma/prisma.service.js';
import { AppVersionService } from './app-version.service.js';

function serviceWith(rows: object[]) {
  let reads = 0;
  const prisma = {
    appRelease: {
      findMany: () => {
        reads++;
        return Promise.resolve(rows);
      },
    },
  } as unknown as PrismaService;
  const service = new AppVersionService(prisma);
  let now = 1_000_000;
  service.now = () => now;
  return { service, reads: () => reads, advance: (ms: number) => (now += ms) };
}

describe('AppVersionService', () => {
  it('lays console rows over the env defaults', async () => {
    const { service } = serviceWith([
      { platform: 'ANDROID', minVersion: '1.2.0', latestVersion: '1.3.0', storeUrl: '', message: 'Update for the new fee screen' },
    ]);
    const releases = await service.releases();
    expect(releases.ANDROID).toMatchObject({
      minVersion: '1.2.0',
      latestVersion: '1.3.0',
      message: 'Update for the new fee screen',
      storeUrl: expect.stringContaining('play.google.com'),
    });
    expect(releases.IOS.minVersion).toBe('0.0.0');
    expect((await service.release('ANDROID' as never)).minVersion).toBe('1.2.0');
  });

  it('caches for 30 seconds unless told to forget', async () => {
    const { service, reads, advance } = serviceWith([]);
    await service.releases();
    await service.releases();
    expect(reads()).toBe(1);
    advance(31_000);
    await service.releases();
    expect(reads()).toBe(2);
    service.forget();
    await service.releases();
    expect(reads()).toBe(3);
  });
});
