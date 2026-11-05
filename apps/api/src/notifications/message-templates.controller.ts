import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { assertSchoolWide, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  defaultText,
  EDITABLE_TEMPLATES,
  isEditable,
  placeholders,
  renderText,
  TEMPLATE_LABELS,
  templateProblems,
} from './template-text.js';

const SAMPLE: Record<string, string> = {
  studentName: 'Ahmed Khan',
  schoolName: 'Your School',
  date: '5 Nov 2026',
  period: 'November 2026',
  amount: '8,500',
  dueDate: '10 Nov 2026',
  voucherNo: 'V-1024',
  receiptNo: 'R-2231',
  examName: 'Mid-term',
  percent: '82',
  grade: 'A',
  className: 'Grade 5 A',
  subject: 'Maths',
  title: 'Chapter 4 exercise',
};

const saveSchema = z.object({
  /** Blank goes back to the built-in wording. */
  body: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
});

/**
 * Lets a school reword the built-in messages (absence alerts, fee vouchers,
 * reminders, receipts, results, homework) and switch any of them off. The new
 * wording is what SMS and the message log carry. WhatsApp business-initiated
 * messages are approved templates at Meta, so the wording sent there changes
 * only after the same text is approved in Meta Business Manager.
 */
@Controller('school/message-templates')
@Roles(...SETUP_ROLES)
@Permission('messages')
export class MessageTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.messageTemplate.findMany({ where: { schoolId: user.schoolId } });
    const saved = new Map(rows.map((r) => [r.key, r]));
    return EDITABLE_TEMPLATES.map((key) => {
      const row = saved.get(key);
      const params = Object.fromEntries(placeholders(key).map((p) => [p, SAMPLE[p] ?? p]));
      return {
        key,
        label: TEMPLATE_LABELS[key],
        placeholders: placeholders(key),
        default: defaultText(key),
        body: row?.body ?? '',
        enabled: row?.enabled ?? true,
        preview: renderText(key, params, row),
      };
    });
  }

  @Put(':key')
  async save(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(saveSchema)) input: z.infer<typeof saveSchema>,
  ) {
    assertSchoolWide(user, 'Only school-wide administrators can change message wording');
    if (!isEditable(key)) throw new NotFoundException('That message cannot be edited');
    const body = input.body?.trim();
    if (body) {
      const problems = templateProblems(key, body);
      if (problems.length) throw new BadRequestException(problems.join('. '));
    }
    const data = {
      ...(body !== undefined ? { body } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedById: user.sub,
    };
    await this.prisma.messageTemplate.upsert({
      where: { schoolId_key: { schoolId: user.schoolId, key } },
      create: { schoolId: user.schoolId, key, ...data },
      update: data,
    });
    await this.audit.record(user, 'messaging.template.save', 'MessageTemplate', key, { after: data });
    return (await this.list(user)).find((t) => t.key === key);
  }

  /** Back to the built-in wording, switched on. */
  @Delete(':key')
  @HttpCode(200)
  async reset(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    assertSchoolWide(user, 'Only school-wide administrators can change message wording');
    if (!isEditable(key)) throw new NotFoundException('That message cannot be edited');
    await this.prisma.messageTemplate.deleteMany({ where: { schoolId: user.schoolId, key } });
    await this.audit.record(user, 'messaging.template.reset', 'MessageTemplate', key);
    return (await this.list(user)).find((t) => t.key === key);
  }
}
