import { ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PlatformAccessGuard } from '../platform/platform-access.guard.js';
import { logPlatform } from '../platform/platform-audit.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemHealthService } from './system-health.service.js';

/** The console's System health page: job queue, message delivery, server errors, reconciliation, alerts. */
@Controller('platform/system-health')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class SystemHealthController {
  constructor(
    private readonly health: SystemHealthService,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  overview() {
    return this.health.overview();
  }

  /** Runs a job that failed for good again, with a fresh set of attempts. */
  @Post('jobs/:id/retry')
  @HttpCode(200)
  async retry(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string) {
    const job = await this.prisma.job.findUnique({ where: { id }, select: { id: true, queue: true, status: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'FAILED') throw new ConflictException('Only failed jobs can be retried');
    if (!this.jobs.canRetry(job.queue)) {
      throw new ConflictException('This job kept nothing to run again with (message deliveries drop their contents). Send it again from the school instead.');
    }
    if (!(await this.jobs.retry(id))) throw new ConflictException('Only failed jobs can be retried');
    await logPlatform(this.prisma, admin, 'job.retry', null, { jobId: id, queue: job.queue });
    return { id, status: 'PENDING' };
  }
}
