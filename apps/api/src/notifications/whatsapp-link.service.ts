import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DeliveryError } from './drivers.js';
import { EvolutionClient, evolutionConfig, instanceName, isOpen, type Instance } from './evolution.js';
import { toInternational } from './phone.js';
import { MessagingSenders } from './senders.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type LinkState = 'NOT_LINKED' | 'WAITING_FOR_SCAN' | 'CONNECTED';

export interface LinkView {
  /** false: the server has no Evolution API (EVOLUTION_API_URL and EVOLUTION_API_KEY). */
  serverReady: boolean;
  /** The console switched the whatsapp_link module on for this school. */
  allowed: boolean;
  state: LinkState;
  /** Digits with the country code. */
  number: string | null;
  profileName: string | null;
  /** The QR to scan, as an image data URL, while WAITING_FOR_SCAN (null until WhatsApp sends one). */
  qr: string | null;
}

export interface TestResult {
  status: 'SENT' | 'FAILED';
  error: string | null;
}

/** The state shown for what WhatsApp reports about the school's instance. */
export function stateOf(instance: Instance | null): LinkState {
  if (!instance) return 'NOT_LINKED';
  return isOpen(instance) ? 'CONNECTED' : 'WAITING_FOR_SCAN';
}

/** A number to message, as digits with the country code; null when it cannot be a mobile number. */
export function testNumber(raw: string): string | null {
  const digits = toInternational(raw);
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

/**
 * The school's own WhatsApp number linked by QR (ShopSyncer's Settings >
 * WhatsApp): see the state, start linking, unlink and send a test. The
 * delivery of ordinary messages is MessagingSenders + LinkedWhatsAppDriver.
 */
@Injectable()
export class WhatsAppLinkService {
  private readonly logger = new Logger(WhatsAppLinkService.name);

  /** Replaced in tests. */
  clientFor: () => EvolutionClient | null = () => {
    const config = evolutionConfig();
    return config ? new EvolutionClient(config) : null;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: MessagingSenders,
  ) {}

  /** What Settings > Messaging shows. Asks WhatsApp for the live state and keeps the school's row in step with it. */
  async status(schoolId: string, withQr: boolean): Promise<LinkView> {
    const client = this.clientFor();
    const allowed = await this.senders.linkAllowed(schoolId);
    const idle: LinkView = { serverReady: !!client, allowed, state: 'NOT_LINKED', number: null, profileName: null, qr: null };
    if (!client || !allowed) return idle;
    return this.live(client, schoolId, withQr, idle);
  }

  /** The console's view of a school's link: no QR, and it works while the school is switched off. */
  async consoleView(schoolId: string): Promise<LinkView> {
    const client = this.clientFor();
    const allowed = await this.senders.linkAllowed(schoolId);
    const idle: LinkView = { serverReady: !!client, allowed, state: 'NOT_LINKED', number: null, profileName: null, qr: null };
    return client ? this.live(client, schoolId, false, idle) : idle;
  }

  private async live(client: EvolutionClient, schoolId: string, withQr: boolean, idle: LinkView): Promise<LinkView> {
    const name = instanceName(schoolId);
    const instance = await client.find(name);
    const state = stateOf(instance);
    await this.record(schoolId, state === 'CONNECTED', instance);
    if (state === 'NOT_LINKED') return idle;
    if (state === 'CONNECTED') return { ...idle, state, number: instance?.number ?? null, profileName: instance?.profileName ?? null };
    return { ...idle, state, qr: withQr ? await this.safeQr(client, name) : null };
  }

  /** Starts linking: makes the school's instance if it has none and returns the QR to scan. */
  async connect(schoolId: string): Promise<LinkView> {
    const client = this.ready(await this.guard(schoolId));
    const name = instanceName(schoolId);
    const found = await client.find(name);
    if (found && isOpen(found)) return this.status(schoolId, true);
    if (!found) await client.create(name);
    const view = await this.status(schoolId, false);
    return view.state === 'WAITING_FOR_SCAN' ? { ...view, qr: await this.safeQr(client, name) } : view;
  }

  /** Unlinks the school's number. Messages still waiting fail with "not connected" and stay in the log. */
  async disconnect(schoolId: string): Promise<void> {
    const client = this.clientFor();
    if (!client) throw new ConflictException('WhatsApp linking is not set up on this server yet.');
    await client.remove(instanceName(schoolId));
    await this.prisma.schoolMessagingSender.updateMany({
      where: { schoolId },
      data: { linkEnabled: false, linkedNumber: '', linkedName: '' },
    });
    this.senders.forget(schoolId);
    this.logger.log(`WhatsApp unlinked for school ${schoolId}`);
  }

  /** "Send me a test": one short message from the linked number to the number typed. */
  async sendTest(schoolId: string, phone: string): Promise<TestResult> {
    const client = this.ready(await this.guard(schoolId));
    const to = testNumber(phone);
    if (!to) throw new BadRequestException('Enter a mobile number, for example 0300 1234567');
    const instance = await client.find(instanceName(schoolId));
    if (!instance || !isOpen(instance)) throw new ConflictException('Link the school’s WhatsApp first: scan the code in Settings > Messaging.');
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } });
    try {
      await client.sendText(instanceName(schoolId), to, `This is a test message from ${school?.name ?? 'your school'} on SchoolSyncer. WhatsApp messages are working.`);
      return { status: 'SENT', error: null };
    } catch (e) {
      if (!(e instanceof DeliveryError)) throw e;
      return { status: 'FAILED', error: e.message };
    }
  }

  private async guard(schoolId: string) {
    if (!(await this.senders.linkAllowed(schoolId))) {
      throw new ForbiddenException('Linking WhatsApp is not switched on for this school. Ask SchoolSyncer to turn it on.');
    }
    return this.clientFor();
  }

  private ready(client: EvolutionClient | null): EvolutionClient {
    if (!client) throw new ConflictException('WhatsApp linking is not set up on this server yet.');
    return client;
  }

  private async safeQr(client: EvolutionClient, name: string): Promise<string | null> {
    try {
      return await client.qr(name);
    } catch {
      return null; // the screen asks again in a few seconds
    }
  }

  /** Keeps the row in step with WhatsApp: sending from the link is on only while the number is connected. */
  private async record(schoolId: string, open: boolean, instance: Instance | null) {
    const data = { linkEnabled: open, linkedNumber: open ? (instance?.number ?? '') : '', linkedName: open ? (instance?.profileName ?? '') : '' };
    const row = await this.prisma.schoolMessagingSender.findUnique({ where: { schoolId } });
    if (!row && !open) return;
    if (row && row.linkEnabled === data.linkEnabled && row.linkedNumber === data.linkedNumber && row.linkedName === data.linkedName) return;
    if (row) await this.prisma.schoolMessagingSender.update({ where: { schoolId }, data });
    // A school that only uses the link has no Cloud API number: the row starts switched off for that.
    else await this.prisma.schoolMessagingSender.create({ data: { schoolId, enabled: false, ...data } });
    this.senders.forget(schoolId);
  }
}
