import { rm } from 'node:fs/promises';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FilePurpose, Role, type Prisma } from '@prisma/client';
import { activityRoles } from '../common/activity.service.js';
import { campusScopeFor, hasAnyRole } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { AllowWhenReadOnly, CurrentUser } from '../common/decorators.js';
import { tooManyRequests } from '../common/rate-limit.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FilesService, type UploadedTemp } from '../elearning/files/files.service.js';
import { UploadInterceptor } from '../elearning/files/upload.interceptor.js';
import { COUNTER_STORE, type CounterStore } from '../jobs/counter-store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  HOUR_MS,
  reportInclude,
  reportSchema,
  REPORTS_PER_HOUR,
  schoolView,
  SCREENSHOTS_PER_HOUR,
  type ReportInput,
} from './problem-reports.js';

const screenshotUpload = UploadInterceptor(() => [FilePurpose.PROBLEM_REPORT]);

/** The school's own reports are for its owners: a school-wide owner grant. */
const schoolWideOwner = (user: AuthUser) => hasAnyRole(user, [Role.OWNER]) && campusScopeFor(user, [Role.OWNER]) === null;

/**
 * "Report a problem" from the web and mobile apps (SCHOOL-150). Any signed-in
 * school user may report; they see their own reports and how SchoolSyncer
 * has dealt with them, and the school owner sees every report from the
 * school. Reports are triaged in the platform console. A screenshot is
 * uploaded first (same checks and storage as other uploads) and attached by
 * its id.
 */
@Controller('problem-reports')
export class ProblemReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    @Inject(COUNTER_STORE) private readonly counters: CounterStore,
  ) {}

  /** Counts one more for this user; 429 once the hour's allowance is used. */
  private async limit(name: string, user: AuthUser, max: number) {
    const now = Date.now();
    const counter = await this.counters.increment(`${name}|${user.sub}`, HOUR_MS, now);
    if (counter.count > max) throw tooManyRequests(counter.resetAt - now);
  }

  /** A png, jpg, webp or gif up to 5 MB; returns the file to attach. */
  @Post('screenshot')
  @AllowWhenReadOnly()
  @UseInterceptors(screenshotUpload)
  async screenshot(@CurrentUser() user: AuthUser, @UploadedFile() temp?: UploadedTemp) {
    try {
      await this.limit('problem-screenshot', user, SCREENSHOTS_PER_HOUR);
    } catch (e) {
      if (temp) await rm(temp.path, { force: true });
      throw e;
    }
    return this.files.upload(user, FilePurpose.PROBLEM_REPORT, temp);
  }

  @Post()
  @AllowWhenReadOnly()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(reportSchema)) input: ReportInput,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (input.screenshotId) {
      // Only this user's own, unattached upload for a report.
      const file = await this.prisma.storedFile.findFirst({
        where: {
          id: input.screenshotId,
          schoolId: user.schoolId,
          purpose: FilePurpose.PROBLEM_REPORT,
          uploadedById: user.sub,
          problemReport: null,
        },
        select: { id: true },
      });
      if (!file) throw new BadRequestException('Upload the screenshot again before sending');
    }
    await this.limit('problem-report', user, REPORTS_PER_HOUR);
    const report = await this.prisma.problemReport.create({
      data: {
        schoolId: user.schoolId,
        reporterId: user.sub,
        // A support session acts as the user; say who really sent it.
        reporterName: user.support ? `${user.support.adminName} (SchoolSyncer support, as ${user.name})` : user.name,
        roles: activityRoles(user.roles),
        source: input.source,
        message: input.message,
        page: input.page,
        appVersion: input.appVersion || null,
        browser: input.browser || userAgent?.slice(0, 500) || null,
        screenshotId: input.screenshotId ?? null,
      },
      include: reportInclude,
    });
    return schoolView(report);
  }

  /** The user's own reports, or with scope=school every report from the school (owners). */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('scope') scope?: string) {
    const school = scope === 'school';
    if (school && !schoolWideOwner(user)) {
      throw new ForbiddenException("Only the school owner can see everyone's reports");
    }
    const where: Prisma.ProblemReportWhereInput = { schoolId: user.schoolId, ...(school ? {} : { reporterId: user.sub }) };
    const rows = await this.prisma.problemReport.findMany({
      where,
      include: reportInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { canSeeSchool: schoolWideOwner(user), items: rows.map(schoolView) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const report = await this.prisma.problemReport.findFirst({
      where: { id, schoolId: user.schoolId, ...(schoolWideOwner(user) ? {} : { reporterId: user.sub }) },
      include: reportInclude,
    });
    if (!report) throw new NotFoundException('Report not found');
    return {
      ...schoolView(report),
      screenshot: report.screenshot ? await this.files.link(report.screenshot) : null,
    };
  }
}
