import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRelease } from './app-release.js';
import { AppVersionGuard } from './app-version.guard.js';
import type { AppVersionService } from './app-version.service.js';

function contextFor(headers: Record<string, string | undefined>, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

const release: AppRelease = {
  minVersion: '1.2.0',
  latestVersion: '1.4.0',
  storeUrl: 'https://play.google.com/store/apps/details?id=pk.schoolsyncer.app',
  message: '',
};

function guardWith(opts: { exempt?: boolean; release?: () => Promise<AppRelease> } = {}) {
  const reflector = { getAllAndOverride: () => opts.exempt ?? false } as unknown as Reflector;
  const lookups: string[] = [];
  const versions = {
    release: (platform: string) => {
      lookups.push(platform);
      return (opts.release ?? (() => Promise.resolve(release)))();
    },
  } as unknown as AppVersionService;
  return { guard: new AppVersionGuard(reflector, versions), lookups };
}

const app = (platform: string, version?: string) => ({ 'x-app-platform': platform, 'x-app-version': version });

describe('AppVersionGuard', () => {
  it('refuses an app build below the minimum with 426 APP_UPDATE_REQUIRED', async () => {
    const { guard } = guardWith();
    const error = await guard.canActivate(contextFor(app('android', '1.1.9'))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(426);
    expect((error as HttpException).getResponse()).toMatchObject({
      statusCode: 426,
      code: 'APP_UPDATE_REQUIRED',
      minVersion: '1.2.0',
      storeUrl: release.storeUrl,
      message: expect.stringContaining('no longer supported'),
    });
  });

  it("uses the console's message when there is one", async () => {
    const { guard } = guardWith({ release: () => Promise.resolve({ ...release, message: 'Fees moved: please update' }) });
    const error = (await guard.canActivate(contextFor(app('ios', '1.0'))).catch((e: unknown) => e)) as HttpException;
    expect(error.getResponse()).toMatchObject({ message: 'Fees moved: please update' });
  });

  it('lets builds at or above the minimum through, even if an update is available', async () => {
    const { guard } = guardWith();
    await expect(guard.canActivate(contextFor(app('android', '1.2.0')))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(app('ios', '1.3.0')))).resolves.toBe(true);
  });

  it('leaves the web portal, the web preview and old builds without headers alone', async () => {
    const { guard, lookups } = guardWith();
    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(app('web', '0.1.0')))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(app('android')))).resolves.toBe(true);
    expect(lookups).toEqual([]);
  });

  it('lets an unreadable version through', async () => {
    const { guard } = guardWith();
    await expect(guard.canActivate(contextFor(app('android', 'dev-build')))).resolves.toBe(true);
  });

  it('answers outdated builds on routes marked @AllowAnyAppVersion', async () => {
    const { guard, lookups } = guardWith({ exempt: true });
    await expect(guard.canActivate(contextFor(app('android', '0.1.0')))).resolves.toBe(true);
    expect(lookups).toEqual([]);
  });

  it('fails open when the policy cannot be read', async () => {
    const { guard } = guardWith({ release: () => Promise.reject(new Error('db down')) });
    await expect(guard.canActivate(contextFor(app('android', '0.1.0')))).resolves.toBe(true);
  });

  it('only checks HTTP requests', async () => {
    const { guard, lookups } = guardWith();
    await expect(guard.canActivate(contextFor(app('android', '0.1.0'), 'rpc'))).resolves.toBe(true);
    expect(lookups).toEqual([]);
  });
});
