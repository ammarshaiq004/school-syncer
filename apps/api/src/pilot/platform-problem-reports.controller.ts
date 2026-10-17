import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ProblemReportStatus, type Prisma } from '@prisma/client';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FilesService } from '../elearning/files/files.service.js';
import { PlatformAccessGuard } from '../platform/platform-access.guard.js';
import { logPlatform } from '../platform/platform-audit.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { z } from 'zod';
import {
  consoleView,
  listQuerySchema,
  noteSchema,
  OPEN_STATUSES,
  reportInclude,
  statusSchema,
} from './problem-reports.js';

const PAGE_SIZE = 50;

/** The console's inbox of problem reports from schools (SCHOOL-150). Owners and support staff. */
@Controller('platform/problem-reports')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformProblemReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  @Get()
  async list(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    const where: Prisma.ProblemReportWhereInput = {
      ...(query.status ? { status: query.status } : query.open === 'true' ? { status: { in: OPEN_STATUSES } } : {}),
      ...(query.schoolId ? { schoolId: query.schoolId } : {}),
      ...(query.q
        ? {
            OR: [
              { message: { contains: query.q, mode: 'insensitive' } },
              { page: { contains: query.q, mode: 'insensitive' } },
              { reporterName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total, byStatus] = await Promise.all([
      this.prisma.problemReport.findMany({
        where,
        include: { ...reportInclude, school: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.problemReport.count({ where }),
      // Counts for the status filter, within the school filter only.
      this.prisma.problemReport.groupBy({
        by: ['status'],
        where: query.schoolId ? { schoolId: query.schoolId } : {},
        _count: true,
      }),
    ]);
    const counts = Object.fromEntries(Object.values(ProblemReportStatus).map((s) => [s, 0])) as Record<ProblemReportStatus, number>;
    for (const g of byStatus) counts[g.status] = g._count;
    return {
      items: rows.map((r) => ({ ...consoleView(r), school: r.school })),
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      counts,
    };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const report = await this.find(id);
    const reporter = report.reporterId
      ? await this.prisma.user.findUnique({
          where: { id: report.reporterId },
          select: { id: true, name: true, email: true, phone: true, username: true, isActive: true },
        })
      : null;
    return {
      ...consoleView(report),
      school: report.school,
      reporter,
      screenshot: report.screenshot ? await this.files.link(report.screenshot) : null,
    };
  }

  /** Moves a report to new, in progress, fixed or won't fix; the reporter sees the change. */
  @Patch(':id')
  async setStatus(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    const report = await this.find(id);
    if (report.status !== body.status) {
      await this.prisma.$transaction([
        this.prisma.problemReport.update({
          where: { id },
          data: { status: body.status, statusChangedAt: new Date() },
        }),
        this.prisma.problemReportActivity.create({
          data: { reportId: id, adminId: admin.sub, adminName: admin.name, status: body.status, fromStatus: report.status },
        }),
        logPlatform(this.prisma, admin, 'problem_report.status', report.schoolId, {
          reportId: id,
          from: report.status,
          to: body.status,
        }),
      ]);
    }
    return this.get(id);
  }

  /** An internal note for SchoolSyncer staff; the school never sees it. */
  @Post(':id/notes')
  async addNote(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>,
  ) {
    await this.find(id);
    await this.prisma.problemReportActivity.create({
      data: { reportId: id, adminId: admin.sub, adminName: admin.name, note: body.note },
    });
    return this.get(id);
  }

  private async find(id: string) {
    const report = await this.prisma.problemReport.findUnique({
      where: { id },
      include: { ...reportInclude, school: { select: { id: true, name: true, slug: true } } },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }
}
