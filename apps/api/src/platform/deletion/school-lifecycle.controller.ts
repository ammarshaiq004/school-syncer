import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { PlatformUser } from '../../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PlatformAccessGuard, PlatformOwnerOnly } from '../platform-access.guard.js';
import { SchoolDeletionService } from './school-deletion.service.js';

const reason = z.string().trim().min(5).max(500);
const scheduleSchema = z.object({ confirmName: z.string().trim().min(1).max(200), reason });
const extendSchema = z.object({ endsAt: z.coerce.date(), reason });

/** Deleting unpaid trial schools, extending trials and downloading a school's data. Owner only, except reading. */
@Controller('platform')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class SchoolLifecycleController {
  constructor(private readonly deletion: SchoolDeletionService) {}

  @Get('deleted-schools')
  @PlatformOwnerOnly()
  deleted() {
    return this.deletion.deleted();
  }

  @Get('deleted-schools/:id/export')
  @PlatformOwnerOnly()
  async keptExport(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string, @Res() res: Response) {
    const { stream, name } = await this.deletion.keptExport(admin, id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-data.zip"`);
    await pipeline(stream, res);
  }

  @Get('schools/:id/deletion')
  info(@Param('id') id: string) {
    return this.deletion.info(id);
  }

  @Post('schools/:id/deletion')
  @PlatformOwnerOnly()
  schedule(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string, @Body(new ZodValidationPipe(scheduleSchema)) b: z.infer<typeof scheduleSchema>) {
    return this.deletion.schedule(admin, id, b.confirmName, b.reason);
  }

  @Post('schools/:id/deletion/restore')
  @HttpCode(200)
  @PlatformOwnerOnly()
  restore(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string) {
    return this.deletion.restore(admin, id);
  }

  @Post('schools/:id/trial')
  @HttpCode(200)
  @PlatformOwnerOnly()
  extend(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string, @Body(new ZodValidationPipe(extendSchema)) b: z.infer<typeof extendSchema>) {
    return this.deletion.extendTrial(admin, id, b.endsAt, b.reason);
  }

  @Get('schools/:id/export')
  @PlatformOwnerOnly()
  async export(@CurrentAdmin() admin: PlatformUser, @Param('id') id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="school-${id}-data.zip"`);
    await this.deletion.exportTo(admin, id, res);
    res.end();
  }
}
