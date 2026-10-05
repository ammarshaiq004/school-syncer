import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ATTENDANCE_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { AllowWhenReadOnly, CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AssistantData } from './assistant-data.service.js';
import { askSchema, AssistantService, type AskRequest } from './assistant.service.js';
import { draftSchema, type DraftRequest } from './draft-rules.js';

/**
 * The AI assistant (SCHOOL-27): plain-language questions about school data,
 * drafted remarks and parent messages, and the at-risk list. For teaching and
 * office staff on plans with the ai_assistant feature. Nothing here writes
 * school data: asking and drafting are POSTs only because they carry a body,
 * so they stay open while a school is read-only.
 */
@Controller('assistant')
@RequiresFeature('ai_assistant')
@Permission('assistant')
@Roles(...ATTENDANCE_ROLES, Role.ACCOUNTANT)
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly data: AssistantData,
  ) {}

  /** Whether AI answers are switched on, and today's usage. */
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.assistant.status(user);
  }

  /** Sections and published exams for the page's pickers. */
  @Get('options')
  async options(@CurrentUser() user: AuthUser) {
    return this.data.options(await this.data.reach(user));
  }

  /** Students the user may draft about, by name or admission number. */
  @Get('students')
  async students(@CurrentUser() user: AuthUser, @Query('q') q?: string, @Query('sectionId') sectionId?: string) {
    const reach = await this.data.reach(user);
    return this.data.findStudents(reach, { query: q?.slice(0, 80), sectionId: sectionId || undefined, limit: 20 });
  }

  /** Students flagged from attendance, results and fees (works without an API key). */
  @Get('at-risk')
  async atRisk(@CurrentUser() user: AuthUser, @Query('sectionId') sectionId?: string) {
    const reach = await this.data.reach(user);
    return {
      sections: await this.data.sections(reach),
      ...(await this.data.atRisk(reach, sectionId || undefined)),
    };
  }

  @Post('ask')
  @HttpCode(200)
  @AllowWhenReadOnly()
  @Permission('assistant', 'view')
  ask(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(askSchema)) body: AskRequest) {
    return this.assistant.ask(user, body);
  }

  @Post('draft')
  @HttpCode(200)
  @AllowWhenReadOnly()
  @Permission('assistant', 'view')
  draft(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(draftSchema)) body: DraftRequest) {
    return this.assistant.draft(user, body);
  }
}
