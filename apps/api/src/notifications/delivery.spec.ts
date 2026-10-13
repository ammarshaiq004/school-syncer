import { Channel } from '@prisma/client';
import { backoffMs } from '../jobs/jobs.service.js';
import { DeliveryError, HttpSmsDriver, smsGatewayConfig, WhatsAppDriver } from './drivers.js';
import { maskPhone, maskPhonesIn } from './phone.js';
import { chooseSender } from './senders.js';

const platformWhatsApp = { NOTIFY_DRIVER: 'whatsapp', WHATSAPP_TOKEN: 'platform-token', WHATSAPP_PHONE_NUMBER_ID: '111' };
const own = { enabled: true, phoneNumberId: '222', token: 'school-token' };

describe('chooseSender', () => {
  it("uses the school's own WhatsApp number first", () => {
    const sender = chooseSender(platformWhatsApp, own);
    expect(sender.source).toBe('school');
    expect((sender.driver as WhatsAppDriver).config).toMatchObject({ phoneNumberId: '222', token: 'school-token' });
  });

  it('falls back to the platform number when the school has none, or switched it off, or it is incomplete', () => {
    for (const school of [null, { ...own, enabled: false }, { ...own, token: '' }]) {
      const sender = chooseSender(platformWhatsApp, school);
      expect(sender.source).toBe('platform');
      expect((sender.driver as WhatsAppDriver).config.phoneNumberId).toBe('111');
    }
  });

  it('uses the SMS gateway only when NOTIFY_DRIVER=sms and it is configured', () => {
    const sms = chooseSender({ NOTIFY_DRIVER: 'sms', SMS_GATEWAY_URL: 'https://sms.example.pk/send' }, null);
    expect(sms).toMatchObject({ source: 'platform' });
    expect(sms.driver.channel).toBe(Channel.SMS);
    expect(chooseSender({ NOTIFY_DRIVER: 'log', SMS_GATEWAY_URL: 'https://sms.example.pk/send' }, null).source).toBe('log');
  });

  it('only logs when nothing is configured', () => {
    expect(chooseSender({}, null)).toMatchObject({ source: 'log', driver: { kind: 'log' } });
    // whatsapp without credentials is not a sender
    expect(chooseSender({ NOTIFY_DRIVER: 'whatsapp' }, null).source).toBe('log');
  });
});

describe('HttpSmsDriver', () => {
  const message = { to: '923001234567', template: 'announcement' as const, params: {}, text: 'Hello & bye' };

  it('fills URL placeholders for query-string gateways', () => {
    const driver = new HttpSmsDriver(
      smsGatewayConfig({
        SMS_GATEWAY_URL: 'https://sms.example.pk/api?key={apiKey}&to={to}&mask={from}&msg={message}',
        SMS_GATEWAY_API_KEY: 'k 1',
        SMS_SENDER_ID: 'SCHOOL',
        SMS_GATEWAY_METHOD: 'get',
      })!,
    );
    const { url, init } = driver.request(message);
    expect(url).toBe('https://sms.example.pk/api?key=k%201&to=923001234567&mask=SCHOOL&msg=Hello%20%26%20bye');
    expect(init.method).toBe('GET');
  });

  it('posts JSON with a bearer key otherwise', () => {
    const driver = new HttpSmsDriver(smsGatewayConfig({ SMS_GATEWAY_URL: 'https://sms.example.pk/send', SMS_GATEWAY_API_KEY: 'key' })!);
    const { url, init } = driver.request(message);
    expect(url).toBe('https://sms.example.pk/send');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer key' });
    expect(JSON.parse(init.body as string)).toEqual({ to: '923001234567', from: '', message: 'Hello & bye' });
  });

  it('treats a 200 without the success marker as a refusal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ERROR: low balance', { status: 200 }));
    const driver = new HttpSmsDriver(
      smsGatewayConfig({ SMS_GATEWAY_URL: 'https://sms.example.pk/send', SMS_GATEWAY_SUCCESS_MATCH: '^OK' })!,
    );
    await expect(driver.send(message)).rejects.toThrow(/low balance/);
    fetchMock.mockRestore();
  });
});

describe('WhatsAppDriver', () => {
  const driver = new WhatsAppDriver({ token: 't', phoneNumberId: '222', language: 'en' });

  it('sends the template with the code button for reset codes, and reads the message id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }));
    const result = await driver.send({ to: '923001234567', template: 'password.reset', params: { code: '123456' }, text: '' });
    expect(result.providerMessageId).toBe('wamid.1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/222/messages');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.template.name).toBe('password_reset');
    expect(body.template.components[1]).toMatchObject({ type: 'button', parameters: [{ text: '123456' }] });
    fetchMock.mockRestore();
  });

  it('marks client errors as permanent and server errors as retryable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('bad number', { status: 400 }));
    const bad = await driver.send({ to: '92', template: 'announcement', params: {}, text: '' }).catch((e: DeliveryError) => e);
    expect(bad).toMatchObject({ permanent: true });
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
    const down = await driver.send({ to: '92', template: 'announcement', params: {}, text: '' }).catch((e: DeliveryError) => e);
    expect(down).toMatchObject({ permanent: false });
    fetchMock.mockRestore();
  });
});

describe('masking and backoff', () => {
  it('masks phone numbers for the server log', () => {
    expect(maskPhone('923001234567')).toBe('92300*****67');
    expect(maskPhonesIn('Recipient 923001234567 is not on WhatsApp (code 131026)')).toBe(
      'Recipient 92300*****67 is not on WhatsApp (code 131026)',
    );
  });

  it('doubles the retry delay up to a cap', () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, 1000))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(30)).toBe(6 * 60 * 60_000);
  });
});
