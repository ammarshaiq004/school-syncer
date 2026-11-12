import { Channel } from '@prisma/client';
import { DeliveryError, type DriverMessage, type DriverResult, type MessageDriver } from './drivers.js';

/**
 * The self-hosted Evolution API (v2.3) that links a school's own WhatsApp
 * number by QR code, the way WhatsApp Web does (ported from ShopSyncer). One
 * Evolution "instance" per school. Unofficial: WhatsApp can ban a number that
 * messages people who did not ask, so the console switches it on per school.
 * Both values blank = not set up on this server.
 */
export interface EvolutionConfig {
  /** e.g. http://evolution:8080 (private network only). */
  url: string;
  /** Evolution's global AUTHENTICATION_API_KEY. Never logged. */
  apiKey: string;
}

export function evolutionConfig(env: Record<string, string | undefined> = process.env): EvolutionConfig | null {
  const url = env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
  const apiKey = env.EVOLUTION_API_KEY?.trim();
  return url && apiKey ? { url, apiKey } : null;
}

/** Evolution instance names are path segments: letters, digits, "-" and "_" only. */
export const instanceName = (schoolId: string) => `ss-${schoolId.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** What WhatsApp says about a school's linked number. `state`: open, connecting or close. */
export interface Instance {
  state: string;
  number: string | null;
  profileName: string | null;
}

/** A refusal from the Evolution server, with its HTTP status (0 when it could not be reached). */
export class EvolutionError extends DeliveryError {
  constructor(
    message: string,
    permanent: boolean,
    readonly status: number,
  ) {
    super(message, permanent);
  }
}

export const isOpen = (i: Instance) => i.state.toLowerCase() === 'open';

/** The wording of a refusal, never echoing the message text. */
export function describeRefusal(status: number, json: unknown): string {
  const message = (json as { response?: { message?: unknown } } | null)?.response?.message;
  if (Array.isArray(message) && message.length) {
    const first = message[0] as { exists?: boolean } | string;
    if (typeof first === 'object' && first && first.exists === false) return NOT_ON_WHATSAPP;
    if (typeof first === 'string') return first;
  } else if (typeof message === 'string') {
    return /connection closed/i.test(message) ? NOT_CONNECTED : message;
  }
  return `WhatsApp server answered ${status}`;
}

export const NOT_ON_WHATSAPP = 'This number is not on WhatsApp';
export const NOT_CONNECTED = "The school's WhatsApp is not connected. Link it again in Settings > Messaging.";

/** 400 (bad number, not linked), 401/403 (wrong key) and 404 (no such instance) will not fix themselves. */
export const permanentRefusal = (status: number) => [400, 401, 403, 404].includes(status);

const text = (node: unknown, field: string): string | null => {
  const v = (node as Record<string, unknown> | null | undefined)?.[field];
  return typeof v === 'string' && v.trim() ? v : null;
};

export class EvolutionClient {
  constructor(
    private readonly config: EvolutionConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** The school's instance, or null when it has none yet. */
  async find(instance: string): Promise<Instance | null> {
    let body: unknown;
    try {
      body = await this.call('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
    } catch (e) {
      if (e instanceof EvolutionError && e.status === 404) return null;
      throw e;
    }
    const row = Array.isArray(body) ? body[0] : body;
    if (!row || typeof row !== 'object') return null;
    const jid = text(row, 'ownerJid');
    return {
      state: text(row, 'connectionStatus') ?? 'close',
      number: text(row, 'number') ?? (jid ? jid.replace(/@.*$/, '').replace(/\D/g, '') : null),
      profileName: text(row, 'profileName'),
    };
  }

  async create(instance: string) {
    await this.call('POST', '/instance/create', { instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: true });
  }

  /** The QR to scan as a data:image/png;base64 URL; null while WhatsApp has not sent one yet. */
  async qr(instance: string): Promise<string | null> {
    return text(await this.call('GET', `/instance/connect/${encodeURIComponent(instance)}`), 'base64');
  }

  /** Unlinks the number (if linked) and removes the instance, so the next link starts with a fresh QR. */
  async remove(instance: string) {
    const name = encodeURIComponent(instance);
    try {
      await this.call('DELETE', `/instance/logout/${name}`);
    } catch {
      // Nothing to log out of; the delete below still runs.
    }
    try {
      await this.call('DELETE', `/instance/delete/${name}`);
    } catch (e) {
      if (!(e instanceof EvolutionError && e.status === 404)) throw e;
    }
  }

  /** Sends a text; returns WhatsApp's message id. `number` is digits with the country code. */
  async sendText(instance: string, number: string, message: string): Promise<string | null> {
    const body = await this.call('POST', `/message/sendText/${encodeURIComponent(instance)}`, { number, text: message });
    return text((body as { key?: unknown } | null)?.key, 'id');
  }

  private async call(method: string, path: string, payload?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetcher(this.config.url + path, {
        method,
        headers: { apikey: this.config.apiKey, accept: 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new EvolutionError('WhatsApp server unreachable', false, 0);
    }
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    if (res.ok) return json;
    throw new EvolutionError(describeRefusal(res.status, json), permanentRefusal(res.status), res.status);
  }
}

/** Sends the school's messages as plain text from its linked number (no Meta templates needed). */
export class LinkedWhatsAppDriver implements MessageDriver {
  readonly channel = Channel.WHATSAPP;
  readonly kind = 'whatsapp' as const;
  readonly linked = true;

  constructor(
    readonly instance: string,
    private readonly client: EvolutionClient,
  ) {}

  async send(message: DriverMessage): Promise<DriverResult> {
    const id = await this.client.sendText(this.instance, message.to, message.text);
    return { providerMessageId: id ?? undefined };
  }
}
