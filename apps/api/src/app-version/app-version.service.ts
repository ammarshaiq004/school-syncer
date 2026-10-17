import { Injectable } from '@nestjs/common';
import { AppPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  APP_PLATFORMS,
  defaultReleases,
  mergeRelease,
  type AppRelease,
  type AppReleases,
} from './app-release.js';

const CACHE_MS = 30_000;

/**
 * The mobile app's version policy: console rows over env defaults. Read on
 * every app request by AppVersionGuard, so it is cached briefly; a change
 * made in the console clears this instance's cache at once and reaches other
 * API instances within CACHE_MS.
 */
@Injectable()
export class AppVersionService {
  private cache: { at: number; releases: AppReleases } | null = null;
  /** Replaceable in tests. */
  now: () => number = Date.now;

  constructor(private readonly prisma: PrismaService) {}

  defaults(): AppReleases {
    return defaultReleases(process.env);
  }

  async releases(): Promise<AppReleases> {
    if (this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache.releases;
    const rows = await this.prisma.appRelease.findMany();
    const defaults = this.defaults();
    const releases = Object.fromEntries(
      APP_PLATFORMS.map((p) => [p, mergeRelease(defaults[p], rows.find((r) => r.platform === p))]),
    ) as AppReleases;
    this.cache = { at: this.now(), releases };
    return releases;
  }

  async release(platform: AppPlatform): Promise<AppRelease> {
    return (await this.releases())[platform];
  }

  forget() {
    this.cache = null;
  }
}
