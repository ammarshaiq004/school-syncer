import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AppPlatform } from '@prisma/client';
import { z } from 'zod';
import type { PlatformUser } from '../common/auth-user.js';
import {
  AllowAnyAppVersion,
  CurrentAdmin,
  PlatformOnly,
  Public,
} from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PlatformAccessGuard,
  PlatformOwnerOnly,
} from '../platform/platform-access.guard.js';
import { logPlatform } from '../platform/platform-audit.js';
import { APP_PLATFORMS } from './app-release.js';
import { AppVersionService } from './app-version.service.js';
import { compareVersions, isVersion } from './version.js';

const version = z
  .string()
  .trim()
  .refine(isVersion, 'Use a version like 1.4.0');

const releaseSchema = z
  .object({
    minVersion: version,
    latestVersion: version,
    storeUrl: z
      .union([z.url({ protocol: /^https$/ }), z.literal('')])
      .default(''),
    message: z.string().trim().max(300).default(''),
  })
  // Zod still runs this when a version above failed its own check.
  .refine((b) => !isVersion(b.minVersion) || !isVersion(b.latestVersion) || compareVersions(b.latestVersion, b.minVersion) >= 0, {
    message: 'The latest version cannot be below the minimum',
    path: ['latestVersion'],
  });

/**
 * Public: what the mobile app checks on start and when it comes back to the
 * foreground. Answers outdated builds too, so they can show the update screen.
 */
@Controller('app')
export class AppVersionController {
  constructor(private readonly versions: AppVersionService) {}

  @Public()
  @AllowAnyAppVersion()
  @Get('version')
  async version() {
    const releases = await this.versions.releases();
    return { ios: releases.IOS, android: releases.ANDROID };
  }
}

/**
 * The console's "Mobile app" page: minimum and latest versions per store.
 * Raising the minimum locks older builds out, so only owners change it.
 */
@Controller('platform/app-versions')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformAppVersionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: AppVersionService,
  ) {}

  @Get()
  async list() {
    const [rows, current] = await Promise.all([
      this.prisma.appRelease.findMany(),
      this.versions.releases(),
    ]);
    const defaults = this.versions.defaults();
    const editors = await this.prisma.platformAdmin.findMany({
      where: { id: { in: rows.flatMap((r) => (r.updatedById ? [r.updatedById] : [])) } },
      select: { id: true, name: true },
    });
    return APP_PLATFORMS.map((platform) => {
      const row = rows.find((r) => r.platform === platform);
      return {
        platform,
        ...current[platform],
        // What applies without a console setting (env), for "Reset to defaults".
        defaults: defaults[platform],
        source: row ? 'console' : 'default',
        updatedAt: row?.updatedAt ?? null,
        updatedBy: editors.find((e) => e.id === row?.updatedById)?.name ?? null,
      };
    });
  }

  @Put(':platform')
  @PlatformOwnerOnly()
  async update(
    @CurrentAdmin() admin: PlatformUser,
    @Param('platform', new ParseEnumPipe(AppPlatform)) platform: AppPlatform,
    @Body(new ZodValidationPipe(releaseSchema)) body: z.infer<typeof releaseSchema>,
  ) {
    const before = await this.versions.release(platform);
    await this.prisma.$transaction(async (tx) => {
      await tx.appRelease.upsert({
        where: { platform },
        create: { platform, ...body, updatedById: admin.sub },
        update: { ...body, updatedById: admin.sub },
      });
      await logPlatform(tx, admin, 'app_version.update', null, { platform, before, after: body });
    });
    this.versions.forget();
    return this.versions.release(platform);
  }

  /** Drops the console setting so the env defaults apply again. */
  @Delete(':platform')
  @PlatformOwnerOnly()
  @HttpCode(200)
  async reset(
    @CurrentAdmin() admin: PlatformUser,
    @Param('platform', new ParseEnumPipe(AppPlatform)) platform: AppPlatform,
  ) {
    const before = await this.versions.release(platform);
    await this.prisma.$transaction(async (tx) => {
      await tx.appRelease.deleteMany({ where: { platform } });
      await logPlatform(tx, admin, 'app_version.reset', null, { platform, before });
    });
    this.versions.forget();
    return this.versions.release(platform);
  }
}
