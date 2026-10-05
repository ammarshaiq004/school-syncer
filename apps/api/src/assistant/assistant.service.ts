import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantKind } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user.js';
import { localToday, startOfLocalDay } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssistantData } from './assistant-data.service.js';
import { AssistantModel } from './assistant-model.service.js';
import { ASK_SYSTEM, ASSISTANT_TOOLS, runTool } from './assistant-tools.js';
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
};

/** Questions (SCHOOL-105) and drafts (SCHOOL-106), with a per-user daily limit. */
@Injectable()
export class AssistantService {
  readonly dailyLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly data: AssistantData,
    private readonly model: AssistantModel,
    config: ConfigService,
  ) {
    const limit = Number(config.get('ASSISTANT_DAILY_LIMIT'));
    this.dailyLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_DAILY_LIMIT;
  }

  async status(user: AuthUser) {
    return {
      ai: this.model.enabled,
      model: this.model.enabled ? this.model.model : null,
      usedToday: await this.usedToday(user),
      dailyLimit: this.dailyLimit,
    };
  }

  async ask(user: AuthUser, body: AskRequest) {
    await this.checkLimit(user);
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
          system: ASK_SYSTEM,
          tools: ASSISTANT_TOOLS,
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
              const out = await runTool(this.data, reach, call.name, call.input);
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
    if (!this.model.enabled) {
      return { text: shape(templateDraft(body.kind, facts, body.notes)), source: 'template' as const, facts, examId };
    }
    await this.checkLimit(user);
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

  private async checkLimit(user: AuthUser) {
    if ((await this.usedToday(user)) >= this.dailyLimit)
      throw new HttpException(
        `You have used the assistant ${this.dailyLimit} times today, the daily limit. It resets at midnight.`,
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
