import { Channel } from '@prisma/client';
import { TEMPLATES, type TemplateKey } from './templates.js';

export interface DriverMessage {
  /** International format without "+", e.g. 923001234567. */
  to: string;
  template: TemplateKey;
  params: Record<string, string>;
  /** The plain text (SMS carries this; WhatsApp sends the approved template). */
  text: string;
}

export interface DriverResult {
  providerMessageId?: string;
}

/** One way of delivering a message. Throws DeliveryError when the provider refuses it. */
export interface MessageDriver {
  readonly channel: Channel;
  /** "log" means nothing is delivered. */
  readonly kind: 'whatsapp' | 'sms' | 'log';
  send(message: DriverMessage): Promise<DriverResult>;
}

/** A provider refusal. `permanent` when retrying cannot help (bad number, bad credentials, template missing). */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent = false,
  ) {
    super(message);
  }
}

/** 4xx other than 408/429 will fail again; 5xx, timeouts and rate limits are worth retrying. */
const permanentStatus = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;

const TIMEOUT_MS = 15_000;

async function post(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new DeliveryError(`Could not reach the provider: ${(error as Error).message}`);
  }
}

/** Only writes to the server log: nothing reaches the recipient. */
export class LogDriver implements MessageDriver {
  readonly channel = Channel.WHATSAPP;
  readonly kind = 'log' as const;
  async send(): Promise<DriverResult> {
    return {};
  }
}

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  language: string;
}

/** WhatsApp Cloud API: business-initiated messages go out as approved templates. */
export class WhatsAppDriver implements MessageDriver {
  readonly channel = Channel.WHATSAPP;
  readonly kind = 'whatsapp' as const;

  constructor(readonly config: WhatsAppConfig) {}

  async send(message: DriverMessage): Promise<DriverResult> {
    const template = TEMPLATES[message.template];
    const components: unknown[] = [
      {
        type: 'body',
        parameters: template.params.map((key) => ({ type: 'text', text: message.params[key] ?? '' })),
      },
    ];
    // Authentication templates carry the code again in their copy-code button.
    if ('button' in template) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: message.params[template.button] ?? '' }],
      });
    }
    const res = await post(`https://graph.facebook.com/v21.0/${encodeURIComponent(this.config.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'template',
        template: { name: template.whatsapp, language: { code: this.config.language }, components },
      }),
    });
    const body = await res.text();
    if (!res.ok) throw new DeliveryError(`WhatsApp API ${res.status}: ${body.slice(0, 400)}`, permanentStatus(res.status));
    try {
      return { providerMessageId: (JSON.parse(body) as { messages?: { id?: string }[] }).messages?.[0]?.id };
    } catch {
      return {};
    }
  }
}

export interface SmsGatewayConfig {
  url: string;
  apiKey: string;
  senderId: string;
  method: 'GET' | 'POST';
  /** Optional pattern the response body must match; many gateways answer 200 with an error inside. */
  successMatch?: RegExp;
}

/**
 * A generic HTTP SMS gateway, so a Pakistani aggregator can be plugged in
 * without code. SMS_GATEWAY_URL may hold {to}, {from}, {message} and {apiKey}
 * placeholders (URL-encoded), for gateways that take a GET or POST with query
 * parameters. Without placeholders the gateway gets a JSON POST of
 * { to, from, message } with "Authorization: Bearer <SMS_GATEWAY_API_KEY>".
 */
export class HttpSmsDriver implements MessageDriver {
  readonly channel = Channel.SMS;
  readonly kind = 'sms' as const;

  constructor(readonly config: SmsGatewayConfig) {}

  /** The request for one message (exported for tests). */
  request(message: DriverMessage): { url: string; init: RequestInit } {
    const { url, apiKey, senderId, method } = this.config;
    const values: Record<string, string> = { to: message.to, from: senderId, message: message.text, apiKey };
    if (/\{(to|from|message|apiKey)\}/.test(url)) {
      return {
        url: url.replace(/\{(to|from|message|apiKey)\}/g, (_, k: string) => encodeURIComponent(values[k])),
        init: { method },
      };
    }
    return {
      url,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ to: message.to, from: senderId, message: message.text }),
      },
    };
  }

  async send(message: DriverMessage): Promise<DriverResult> {
    const { url, init } = this.request(message);
    const res = await post(url, init);
    const body = await res.text();
    if (!res.ok) throw new DeliveryError(`SMS gateway ${res.status}: ${body.slice(0, 400)}`, permanentStatus(res.status));
    if (this.config.successMatch && !this.config.successMatch.test(body)) {
      throw new DeliveryError(`SMS gateway refused the message: ${body.slice(0, 400)}`);
    }
    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      const id = json.id ?? json.messageId ?? json.message_id;
      return { providerMessageId: id === undefined ? undefined : String(id) };
    } catch {
      return {};
    }
  }
}

/** The SMS gateway from the environment, or null when SMS_GATEWAY_URL is not set. */
export function smsGatewayConfig(env: Record<string, string | undefined> = process.env): SmsGatewayConfig | null {
  const url = env.SMS_GATEWAY_URL?.trim();
  if (!url) return null;
  let successMatch: RegExp | undefined;
  try {
    successMatch = env.SMS_GATEWAY_SUCCESS_MATCH ? new RegExp(env.SMS_GATEWAY_SUCCESS_MATCH, 'i') : undefined;
  } catch {
    successMatch = undefined;
  }
  return {
    url,
    apiKey: env.SMS_GATEWAY_API_KEY?.trim() ?? '',
    senderId: env.SMS_SENDER_ID?.trim() ?? '',
    method: env.SMS_GATEWAY_METHOD?.trim().toUpperCase() === 'GET' ? 'GET' : 'POST',
    successMatch,
  };
}
