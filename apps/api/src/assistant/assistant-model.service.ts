import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { openSecrets, secretKeys } from '../fees/gateways/school-accounts.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Models that take the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);

export type ModelRequest = Omit<MessageCreateParamsNonStreaming, 'model' | 'betas' | 'fallbacks'>;

/** Where the API key comes from: the one saved in the console wins over the server's environment. */
export type KeySource = 'console' | 'env' | null;

const KEY_CACHE_MS = 30_000;

/**
 * The Claude client. The key is the one saved in the console (sealed in
 * PlatformAiKey) or else ANTHROPIC_API_KEY; ASSISTANT_MODEL optionally picks
 * the model. Without a key `available()` is false and the assistant falls
 * back to what it can do without a model (at-risk lists, template drafts).
 */
@Injectable()
export class AssistantModel {
  private readonly log = new Logger(AssistantModel.name);
  private readonly envKey: string | null;
  private cached: { key: string | null; source: KeySource; at: number } | null = null;
  private client: { key: string; sdk: Anthropic } | null = null;
  readonly model: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.envKey = config.get<string>('ANTHROPIC_API_KEY')?.trim() || null;
    this.model = config.get<string>('ASSISTANT_MODEL')?.trim() || DEFAULT_MODEL;
  }

  /** The key in use and where it came from (cached for a few seconds). */
  async keySource(): Promise<{ key: string | null; source: KeySource }> {
    if (this.cached && Date.now() - this.cached.at < KEY_CACHE_MS) return this.cached;
    let key: string | null = null;
    let source: KeySource = null;
    const row = await this.prisma.platformAiKey.findUnique({ where: { id: 'default' } });
    if (row) {
      try {
        key = openSecrets(row.sealed, secretKeys().all).key?.trim() || null;
        if (key) source = 'console';
      } catch (e) {
        this.log.error(`The console AI key cannot be opened (${(e as Error).message}); using the server setting`);
      }
    }
    if (!key && this.envKey) {
      key = this.envKey;
      source = 'env';
    }
    this.cached = { key, source, at: Date.now() };
    return this.cached;
  }

  /** Forget the cached key, after the console saved or removed one. */
  refresh() {
    this.cached = null;
  }

  async available(): Promise<boolean> {
    return (await this.keySource()).key !== null;
  }

  async create(params: ModelRequest): Promise<BetaMessage> {
    const { key } = await this.keySource();
    if (!key)
      throw new ServiceUnavailableException(
        'The AI assistant is not switched on for this server yet. Ask SchoolSyncer support to add an API key.',
      );
    if (this.client?.key !== key) this.client = { key, sdk: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 90_000 }) };
    const fallback = FALLBACK_MODELS.has(this.model);
    try {
      return await this.client.sdk.beta.messages.create({
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
