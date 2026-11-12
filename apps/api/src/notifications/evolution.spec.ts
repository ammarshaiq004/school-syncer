import { DeliveryError } from './drivers.js';
import {
  describeRefusal,
  EvolutionClient,
  EvolutionError,
  evolutionConfig,
  instanceName,
  isOpen,
  LinkedWhatsAppDriver,
  NOT_CONNECTED,
  NOT_ON_WHATSAPP,
  permanentRefusal,
} from './evolution.js';

const config = { url: 'http://evolution:8080', apiKey: 'secret-key' };

function client(replies: { status?: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? {};
    const status = reply.status ?? 200;
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status });
  }) as unknown as typeof fetch;
  return { api: new EvolutionClient(config, fetcher), calls };
}

describe('evolutionConfig', () => {
  it('needs both the address and the key, and trims trailing slashes', () => {
    expect(evolutionConfig({ EVOLUTION_API_URL: ' http://e:8080/// ', EVOLUTION_API_KEY: ' k ' })).toEqual({ url: 'http://e:8080', apiKey: 'k' });
    expect(evolutionConfig({ EVOLUTION_API_URL: 'http://e:8080' })).toBeNull();
    expect(evolutionConfig({ EVOLUTION_API_KEY: 'k' })).toBeNull();
    expect(evolutionConfig({})).toBeNull();
  });
});

describe('instanceName', () => {
  it('keeps to letters, digits, "-" and "_" so it is safe as a path segment', () => {
    expect(instanceName('clx123')).toBe('ss-clx123');
    expect(instanceName('a/b c?d')).toBe('ss-a_b_c_d');
  });
});

describe('describeRefusal', () => {
  it('says when a number is not on WhatsApp', () => {
    expect(describeRefusal(400, { response: { message: [{ jid: 'x', exists: false }] } })).toBe(NOT_ON_WHATSAPP);
  });
  it('says when the school is not connected, in plain words', () => {
    expect(describeRefusal(400, { response: { message: 'Connection Closed' } })).toBe(NOT_CONNECTED);
  });
  it('passes other reasons on and falls back to the status', () => {
    expect(describeRefusal(400, { response: { message: ['Bad thing'] } })).toBe('Bad thing');
    expect(describeRefusal(400, { response: { message: 'Other' } })).toBe('Other');
    expect(describeRefusal(502, null)).toBe('WhatsApp server answered 502');
  });
  it('treats bad numbers, wrong keys and missing instances as permanent, and server trouble as retryable', () => {
    for (const s of [400, 401, 403, 404]) expect(permanentRefusal(s)).toBe(true);
    for (const s of [408, 429, 500, 502, 503]) expect(permanentRefusal(s)).toBe(false);
  });
});

describe('EvolutionClient', () => {
  it('finds an instance and reads its number from the owner JID when "number" is missing', async () => {
    const { api, calls } = client([{ body: [{ connectionStatus: 'open', ownerJid: '923001234567@s.whatsapp.net', profileName: 'Bright School' }] }]);
    const found = await api.find('ss-demo');
    expect(found).toEqual({ state: 'open', number: '923001234567', profileName: 'Bright School' });
    expect(isOpen(found!)).toBe(true);
    expect(calls[0].url).toBe('http://evolution:8080/instance/fetchInstances?instanceName=ss-demo');
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('secret-key');
  });

  it('returns null when the school has no instance (404 or an empty list)', async () => {
    expect(await client([{ status: 404, body: { response: { message: 'not found' } } }]).api.find('ss-x')).toBeNull();
    expect(await client([{ body: [] }]).api.find('ss-x')).toBeNull();
  });

  it('rethrows other lookup failures', async () => {
    await expect(client([{ status: 401, body: {} }]).api.find('ss-x')).rejects.toMatchObject({ permanent: true, status: 401 });
  });

  it('creates an instance with a QR and fetches the QR image', async () => {
    const { api, calls } = client([{ body: {} }, { body: { base64: 'data:image/png;base64,AAA' } }, { body: { pairingCode: null } }]);
    await api.create('ss-demo');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ instanceName: 'ss-demo', integration: 'WHATSAPP-BAILEYS', qrcode: true });
    expect(await api.qr('ss-demo')).toBe('data:image/png;base64,AAA');
    expect(await api.qr('ss-demo')).toBeNull();
  });

  it('logs out then deletes, and ignores "not connected" and "already gone"', async () => {
    const { api, calls } = client([
      { status: 400, body: { response: { message: 'not connected' } } },
      { status: 404, body: {} },
    ]);
    await api.remove('ss-demo');
    expect(calls.map((c) => `${c.init.method} ${c.url.split('8080')[1]}`)).toEqual(['DELETE /instance/logout/ss-demo', 'DELETE /instance/delete/ss-demo']);
  });

  it('fails the delete when the server really refuses it', async () => {
    await expect(client([{}, { status: 500, body: {} }]).api.remove('ss-demo')).rejects.toBeInstanceOf(EvolutionError);
  });

  it('sends text and returns the WhatsApp message id', async () => {
    const { api, calls } = client([{ body: { key: { id: 'WA123' } } }]);
    expect(await api.sendText('ss-demo', '923001234567', 'Hello')).toBe('WA123');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ number: '923001234567', text: 'Hello' });
  });

  it('maps a refusal to a DeliveryError that does not echo the message text', async () => {
    const { api } = client([{ status: 400, body: { response: { message: [{ exists: false }] } } }]);
    const error = await api.sendText('ss-demo', '923000000000', 'secret text').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeliveryError);
    expect(error).toMatchObject({ message: NOT_ON_WHATSAPP, permanent: true });
    expect((error as Error).message).not.toContain('secret text');
  });

  it('retries later when the server cannot be reached', async () => {
    const api = new EvolutionClient(config, (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    await expect(api.sendText('ss-demo', '923001234567', 'x')).rejects.toMatchObject({ message: 'WhatsApp server unreachable', permanent: false });
  });

  it('survives a non-JSON answer', async () => {
    const api = new EvolutionClient(config, (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch);
    await expect(api.sendText('ss-demo', '923001234567', 'x')).rejects.toMatchObject({ message: 'WhatsApp server answered 502', permanent: false });
  });
});

describe('LinkedWhatsAppDriver', () => {
  it('sends the rendered text, not a Meta template', async () => {
    const { api, calls } = client([{ body: { key: { id: 'WA9' } } }]);
    const driver = new LinkedWhatsAppDriver('ss-demo', api);
    const result = await driver.send({ to: '923001234567', template: 'announcement', params: {}, text: 'School is closed tomorrow' });
    expect(result).toEqual({ providerMessageId: 'WA9' });
    expect(driver.kind).toBe('whatsapp');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ number: '923001234567', text: 'School is closed tomorrow' });
  });
});
