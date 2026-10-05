import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Models that take the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);

export type ModelRequest = Omit<MessageCreateParamsNonStreaming, 'model' | 'betas' | 'fallbacks'>;

/**
 * The Claude client. Configured by ANTHROPIC_API_KEY (and optionally
 * ASSISTANT_MODEL); without a key `enabled` is false and the assistant falls
 * back to what it can do without a model (at-risk lists, template drafts).
 */
@Injectable()
export class AssistantModel {
  private readonly log = new Logger(AssistantModel.name);
  private readonly client: Anthropic | null;
  readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY')?.trim();
    this.model = config.get<string>('ASSISTANT_MODEL')?.trim() || DEFAULT_MODEL;
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 }) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async create(params: ModelRequest): Promise<BetaMessage> {
    if (!this.client)
      throw new ServiceUnavailableException(
        'The AI assistant is not switched on for this server yet. Ask SchoolSyncer support to add an API key.',
      );
    const fallback = FALLBACK_MODELS.has(this.model);
    try {
      return await this.client.beta.messages.create({
        ...params,
        model: this.model,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError)
        throw new ServiceUnavailableException('The AI assistant is busy. Please try again in a minute.');
      if (e instanceof Anthropic.APIError) {
        this.log.error(`Claude API error ${e.status}: ${e.message}`);
        throw new ServiceUnavailableException('The AI assistant could not answer just now. Please try again.');
      }
      throw e;
    }
  }
}
