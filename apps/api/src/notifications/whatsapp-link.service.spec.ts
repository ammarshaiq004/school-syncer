import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DeliveryError } from './drivers.js';
import { EvolutionClient, type Instance } from './evolution.js';
import { stateOf, testNumber, WhatsAppLinkService } from './whatsapp-link.service.js';

const open: Instance = { state: 'open', number: '923001234567', profileName: 'Bright School' };
const waiting: Instance = { state: 'connecting', number: null, profileName: null };

function setup(opts: { allowed?: boolean; instance?: Instance | null; row?: Record<string, unknown> | null; server?: boolean } = {}) {
  const row = opts.row === undefined ? null : opts.row;
  const prisma = {
    schoolMessagingSender: {
      findUnique: vi.fn(async () => row),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    school: { findUnique: vi.fn(async () => ({ name: 'Bright School' })) },
  };
  const senders = { linkAllowed: vi.fn(async () => opts.allowed ?? true), forget: vi.fn() };
  const client = {
    find: vi.fn(async () => (opts.instance === undefined ? null : opts.instance)),
    create: vi.fn(async () => undefined),
    qr: vi.fn(async () => 'data:image/png;base64,QR'),
    remove: vi.fn(async () => undefined),
    sendText: vi.fn(async () => 'WA1'),
  };
  const service = new WhatsAppLinkService(prisma as never, senders as never);
  service.clientFor = () => (opts.server === false ? null : (client as unknown as EvolutionClient));
  return { service, prisma, senders, client };
}

describe('stateOf / testNumber', () => {
  it('maps what WhatsApp reports', () => {
    expect(stateOf(null)).toBe('NOT_LINKED');
    expect(stateOf(waiting)).toBe('WAITING_FOR_SCAN');
    expect(stateOf(open)).toBe('CONNECTED');
  });
  it('accepts local and international mobiles and rejects junk', () => {
    expect(testNumber('0300 1234567')).toBe('923001234567');
    expect(testNumber('+92 300 1234567')).toBe('923001234567');
    expect(testNumber('12345')).toBeNull();
    expect(testNumber('abc')).toBeNull();
  });
});

describe('WhatsAppLinkService.status', () => {
  it('says the server is not set up without calling WhatsApp', async () => {
    const { service, client } = setup({ server: false });
    expect(await service.status('s1', true)).toMatchObject({ serverReady: false, state: 'NOT_LINKED' });
    expect(client.find).not.toHaveBeenCalled();
  });

  it('does nothing for a school the console has not switched on', async () => {
    const { service, client } = setup({ allowed: false });
    expect(await service.status('s1', true)).toMatchObject({ serverReady: true, allowed: false, state: 'NOT_LINKED' });
    expect(client.find).not.toHaveBeenCalled();
  });

  it('reports a connected number and records it so messages are sent from it', async () => {
    const { service, prisma, senders } = setup({ instance: open });
    const view = await service.status('s1', true);
    expect(view).toMatchObject({ state: 'CONNECTED', number: '923001234567', profileName: 'Bright School', qr: null });
    // No row yet: it starts switched off for the Cloud API.
    expect(prisma.schoolMessagingSender.create).toHaveBeenCalledWith({
      data: { schoolId: 's1', enabled: false, linkEnabled: true, linkedNumber: '923001234567', linkedName: 'Bright School' },
    });
    expect(senders.forget).toHaveBeenCalledWith('s1');
  });

  it('shows the QR while waiting for the scan, and only when asked', async () => {
    expect(await setup({ instance: waiting }).service.status('s1', true)).toMatchObject({ state: 'WAITING_FOR_SCAN', qr: 'data:image/png;base64,QR' });
    expect((await setup({ instance: waiting }).service.status('s1', false)).qr).toBeNull();
  });

  it('switches sending from the link off when WhatsApp dropped it', async () => {
    const row = { linkEnabled: true, linkedNumber: '923001234567', linkedName: 'x' };
    const { service, prisma } = setup({ instance: waiting, row });
    await service.status('s1', false);
    expect(prisma.schoolMessagingSender.update).toHaveBeenCalledWith({ where: { schoolId: 's1' }, data: { linkEnabled: false, linkedNumber: '', linkedName: '' } });
  });

  it('writes nothing when nothing changed', async () => {
    const row = { linkEnabled: true, linkedNumber: '923001234567', linkedName: 'Bright School' };
    const { service, prisma } = setup({ instance: open, row });
    await service.status('s1', false);
    expect(prisma.schoolMessagingSender.update).not.toHaveBeenCalled();
    expect(prisma.schoolMessagingSender.create).not.toHaveBeenCalled();
  });

  it('keeps going when the QR is not ready yet', async () => {
    const { service, client } = setup({ instance: waiting });
    client.qr.mockRejectedValueOnce(new Error('later'));
    expect((await service.status('s1', true)).qr).toBeNull();
  });
});

describe('WhatsAppLinkService.consoleView', () => {
  it('works for a school that is switched off and never returns a QR', async () => {
    const { service } = setup({ allowed: false, instance: waiting });
    expect(await service.consoleView('s1')).toMatchObject({ allowed: false, state: 'WAITING_FOR_SCAN', qr: null });
  });
});

describe('WhatsAppLinkService.connect', () => {
  it('refuses a school the console has not switched on', async () => {
    await expect(setup({ allowed: false }).service.connect('s1')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('refuses when the server has no Evolution API', async () => {
    await expect(setup({ server: false }).service.connect('s1')).rejects.toBeInstanceOf(ConflictException);
  });
  it('makes the instance when there is none and returns the QR', async () => {
    const { service, client } = setup({ instance: null });
    client.find.mockResolvedValueOnce(null).mockResolvedValue(waiting);
    expect(await service.connect('s1')).toMatchObject({ state: 'WAITING_FOR_SCAN', qr: 'data:image/png;base64,QR' });
    expect(client.create).toHaveBeenCalledWith('ss-s1');
  });
  it('does not make a second instance, and does not ask for a QR when already connected', async () => {
    const { service, client } = setup({ instance: open });
    expect(await service.connect('s1')).toMatchObject({ state: 'CONNECTED' });
    expect(client.create).not.toHaveBeenCalled();
  });
});

describe('WhatsAppLinkService.disconnect', () => {
  it('removes the instance and turns sending from the link off', async () => {
    const { service, client, prisma, senders } = setup();
    await service.disconnect('s1');
    expect(client.remove).toHaveBeenCalledWith('ss-s1');
    expect(prisma.schoolMessagingSender.updateMany).toHaveBeenCalledWith({ where: { schoolId: 's1' }, data: { linkEnabled: false, linkedNumber: '', linkedName: '' } });
    expect(senders.forget).toHaveBeenCalledWith('s1');
  });
  it('works when the school is switched off (the console unlinks it)', async () => {
    await expect(setup({ allowed: false }).service.disconnect('s1')).resolves.toBeUndefined();
  });
  it('refuses when the server has no Evolution API', async () => {
    await expect(setup({ server: false }).service.disconnect('s1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('WhatsAppLinkService.sendTest', () => {
  it('sends one message from the linked number', async () => {
    const { service, client } = setup({ instance: open });
    expect(await service.sendTest('s1', '0300 1234567')).toEqual({ status: 'SENT', error: null });
    expect(client.sendText).toHaveBeenCalledWith('ss-s1', '923001234567', expect.stringContaining('Bright School'));
  });
  it('rejects a bad number and an unlinked school', async () => {
    await expect(setup({ instance: open }).service.sendTest('s1', '12')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ instance: waiting }).service.sendTest('s1', '03001234567')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ allowed: false }).service.sendTest('s1', '03001234567')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('reports why WhatsApp refused', async () => {
    const { service, client } = setup({ instance: open });
    client.sendText.mockRejectedValueOnce(new DeliveryError('This number is not on WhatsApp', true));
    expect(await service.sendTest('s1', '03001234567')).toEqual({ status: 'FAILED', error: 'This number is not on WhatsApp' });
  });
});
