import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantKind } from '@prisma/client';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { localToday, startOfLocalDay } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssistantData } from './assistant-data.service.js';
import { AssistantModel } from './assistant-model.service.js';
import { cleanNote, defaultMonthlyTokens, MAX_NOTE_CHARS, MAX_NOTES, memoryPrompt, monthlyBudget, startOfMonth } from './aon-rules.js';
import { ASK_SYSTEM, ASSISTANT_TOOLS, REMEMBER_TOOL, runTool } from './assistant-tools.js';
import { DRAFT_SYSTEM, draftPrompt, fit, REMARK_MAX, templateDraft, type DraftRequest } from './draft-rules.js';

export const askSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  /** Earlier turns of this conversation, oldest first, as plain text. */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(20)
    .default([]),
});
export type AskRequest = z.infer<typeof askSchema>;

/** Model round trips per question before giving up. */
const MAX_STEPS = 8;
const DEFAULT_DAILY_LIMIT = 100;

const LABELS: Record<string, string> = {
  school_overview: 'School overview',
  find_students: 'Student search',
  student_overview: 'Student record',
  attendance_report: 'Attendance',
  exam_report: 'Exam results',
  fee_report: 'Fees',
  at_risk_students: 'At-risk check',
  remember: 'Memory',
};

/** Questions (SCHOOL-105) and drafts (SCHOOL-106), with a per-user daily limit. */
@Injectable()
export class AssistantService {
  readonly dailyLimit: number;
  private readonly defaultMonthly: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly data: AssistantData,
    private readonly model: AssistantModel,
    config: ConfigService,
  ) {
    const limit = Number(config.get('ASSISTANT_DAILY_LIMIT'));
    this.dailyLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_DAILY_LIMIT;
    this.defaultMonthly = defaultMonthlyTokens(config.get('ASSISTANT_MONTHLY_TOKENS'));
  }

  /** Managers (owner, principal, admin) can have Aon remember things and switch it off. */
  canManage(user: AuthUser) {
    return user.roles.some((r) => SETUP_ROLES.includes(r.role));
  }

  async status(user: AuthUser) {
    const ai = await this.model.available();
    const school = await this.school(user);
    return {
      ai,
      model: ai ? this.model.model : null,
      usedToday: await this.usedToday(user),
      dailyLimit: this.dailyLimit,
      aon: { enabled: school.aonEnabled, ...(await this.monthUsage(user, school)), canManage: this.canManage(user) },
    };
  }

  // ----- Memory -----

  memory(user: AuthUser) {
    return this.prisma.aonMemoryNote.findMany({
      where: { schoolId: user.schoolId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_NOTES,
      select: { id: true, note: true, createdAt: true },
    });
  }

  /** Saves a note; the oldest go first when the school is at its cap. */
  async remember(user: AuthUser, text: unknown) {
    if (!this.canManage(user)) throw new ForbiddenException('Only the owner, principal or an admin can add to Aon\'s memory');
    const note = cleanNote(text);
    if (!note) throw new HttpException(`A note must be 1 to ${MAX_NOTE_CHARS} characters.`, HttpStatus.BAD_REQUEST);
    const old = await this.prisma.aonMemoryNote.findMany({
      where: { schoolId: user.schoolId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: MAX_NOTES - 1,
      select: { id: true },
    });
    if (old.length) await this.prisma.aonMemoryNote.deleteMany({ where: { id: { in: old.map((n) => n.id) } } });
    return this.prisma.aonMemoryNote.create({
      data: { schoolId: user.schoolId, note, createdById: user.sub },
      select: { id: true, note: true, createdAt: true },
    });
  }

  async forget(user: AuthUser, id: string) {
    if (!this.canManage(user)) throw new ForbiddenException('Only the owner, principal or an admin can remove Aon\'s notes');
    const { count } = await this.prisma.aonMemoryNote.deleteMany({ where: { id, schoolId: user.schoolId } });
    if (!count) throw new NotFoundException('No such note');
  }

  async setEnabled(user: AuthUser, enabled: boolean) {
    if (!this.canManage(user)) throw new ForbiddenException('Only the owner, principal or an admin can switch Aon on or off');
    await this.prisma.school.update({ where: { id: user.schoolId }, data: { aonEnabled: enabled } });
    return this.status(user);
  }

  async ask(user: AuthUser, body: AskRequest) {
    await this.checkLimit(user, { forQuestion: true });
    const notes = await this.memory(user);
    const system = ASK_SYSTEM + memoryPrompt(notes);
    const tools = this.canManage(user) ? [...ASSISTANT_TOOLS, REMEMBER_TOOL] : ASSISTANT_TOOLS;
    const reach = await this.data.reach(user);
    const messages: BetaMessageParam[] = [
      ...body.history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: body.question },
    ];
    // A conversation must open with the user; drop a leading assistant turn.
    while (messages[0]?.role === 'assistant') messages.shift();

    const used = new Set<string>();
    const usage = { input: 0, output: 0 };
    let content: BetaContentBlock[] = [];
    let refused = false;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await this.model.create({
          max_tokens: 8000,
          system,
          tools,
          output_config: { effort: 'medium' },
          messages,
        });
        usage.input += res.usage.input_tokens;
        usage.output += res.usage.output_tokens;
        content = res.content;
        if (res.stop_reason === 'refusal') {
          refused = true;
          break;
        }
        if (res.stop_reason !== 'tool_use') break;
        messages.push({ role: 'assistant', content: res.content });
        const calls = res.content.filter((b) => b.type === 'tool_use');
        const results = await Promise.all(
          calls.map(async (call): Promise<BetaToolResultBlockParam> => {
            used.add(call.name);
            try {
              const out =
                call.name === 'remember'
                  ? { saved: (await this.remember(user, (call.input as { note?: unknown } | null)?.note)).note }
                  : await runTool(this.data, reach, call.name, call.input);
              return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out) };
            } catch (e) {
              return { type: 'tool_result', tool_use_id: call.id, content: (e as Error).message, is_error: true };
            }
          }),
        );
        messages.push({ role: 'user', content: results });
      }
    } finally {
      if (usage.input || usage.output) await this.record(user, AssistantKind.ASK, usage);
    }

    const text = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return {
      answer: refused
        ? 'I can\'t help with that request. Try asking about attendance, results, fees or a student.'
        : text || 'I could not finish looking that up. Please try a narrower question.',
      sources: [...used].map((name) => LABELS[name] ?? name),
    };
  }

  /** A remark or parent message. Claude writes it when configured, else a template does. */
  async draft(user: AuthUser, body: DraftRequest) {
    const reach = await this.data.reach(user);
    const { facts, examId } = await this.data.draftFacts(reach, body.studentId, body.examId);
    const shape = (text: string) => (body.kind === 'report_remark' ? fit(text, REMARK_MAX) : text.trim());
    const school = await this.school(user);
    if (!school.aonEnabled || !(await this.model.available())) {
      return { text: shape(templateDraft(body.kind, facts, body.notes)), source: 'template' as const, facts, examId };
    }
    await this.checkLimit(user, { school });
    const res = await this.model.create({
      max_tokens: 4000,
      system: DRAFT_SYSTEM,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: draftPrompt(body, facts) }],
    });
    await this.record(user, AssistantKind.DRAFT, { input: res.usage.input_tokens, output: res.usage.output_tokens });
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (res.stop_reason === 'refusal' || !text)
      return { text: shape(templateDraft(body.kind, facts, body.notes)), source: 'template' as const, facts, examId };
    return { text: shape(text), source: 'ai' as const, facts, examId };
  }

  private usedToday(user: AuthUser) {
    return this.prisma.assistantUsage.count({
      where: { userId: user.sub, createdAt: { gte: startOfLocalDay(localToday()) } },
    });
  }

  private school(user: AuthUser) {
    return this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { aonEnabled: true, aiMonthlyTokens: true } });
  }

  /** Tokens the school has used this month against its budget. */
  private async monthUsage(user: AuthUser, school: { aiMonthlyTokens: number | null }) {
    const sum = await this.prisma.assistantUsage.aggregate({
      where: { schoolId: user.schoolId, createdAt: { gte: startOfMonth(new Date()) } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return {
      monthUsed: (sum._sum.inputTokens ?? 0) + (sum._sum.outputTokens ?? 0),
      monthLimit: monthlyBudget(school.aiMonthlyTokens, this.defaultMonthly),
    };
  }

  private async checkLimit(user: AuthUser, opts: { forQuestion?: boolean; school?: { aonEnabled: boolean; aiMonthlyTokens: number | null } } = {}) {
    const school = opts.school ?? (await this.school(user));
    if (opts.forQuestion && !school.aonEnabled) throw new ForbiddenException('Aon is switched off for your school. The owner can switch it on in Settings.');
    if ((await this.usedToday(user)) >= this.dailyLimit)
      throw new HttpException(
        `You have used the assistant ${this.dailyLimit} times today, the daily limit. It resets at midnight.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const { monthUsed, monthLimit } = await this.monthUsage(user, school);
    if (monthUsed >= monthLimit)
      throw new HttpException(
        'Your school has used its AI allowance for this month. It renews on the 1st, or ask SchoolSyncer support to raise it.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private record(user: AuthUser, kind: AssistantKind, usage: { input: number; output: number }) {
    return this.prisma.assistantUsage.create({
      data: {
        schoolId: user.schoolId,
        userId: user.sub,
        kind,
        model: this.model.model,
        inputTokens: usage.input,
        outputTokens: usage.output,
      },
    });
  }
}
