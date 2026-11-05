import { createHmac } from 'node:crypto';
import { canReply, deliveryReport, groupThreads, parseWebhook, validSignature } from './whatsapp-inbox.js';

const payload = {
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: '1055' },
            contacts: [{ wa_id: '923001234567', profile: { name: 'Imran Khan' } }],
            messages: [
              { from: '923001234567', id: 'wamid.1', timestamp: '1793900000', type: 'text', text: { body: 'Ahmed is unwell today' } },
              { from: '923001234567', id: 'wamid.2', timestamp: '1793900100', type: 'image' },
              { from: '', id: 'wamid.3' },
            ],
            statuses: [
              { id: 'wamid.out', status: 'delivered', timestamp: '1793900200' },
              { id: 'wamid.out', status: 'weird', timestamp: '1793900300' },
            ],
          },
        },
      ],
    },
  ],
};

describe('parseWebhook', () => {
  it('reads parents’ messages and delivery receipts, skipping what it cannot use', () => {
    const { messages, receipts } = parseWebhook(payload);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ phoneNumberId: '1055', from: '923001234567', name: 'Imran Khan', id: 'wamid.1', text: 'Ahmed is unwell today' });
    expect(messages[1].text).toBe('[image]');
    expect(receipts).toEqual([{ id: 'wamid.out', status: 'delivered', at: new Date(1793900200 * 1000) }]);
  });

  it('copes with payloads of any other shape', () => {
    for (const bad of [null, {}, { entry: 'x' }, { entry: [null, { changes: [{}] }] }]) {
      expect(parseWebhook(bad)).toEqual({ messages: [], receipts: [] });
    }
  });
});

describe('validSignature', () => {
  const body = JSON.stringify(payload);
  const header = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;

  it('accepts Meta’s signature over the raw body', () => {
    expect(validSignature(Buffer.from(body), header, 'app-secret')).toBe(true);
  });

  it('rejects a wrong secret, a changed body and a missing header', () => {
    expect(validSignature(Buffer.from(body), header, 'other')).toBe(false);
    expect(validSignature(Buffer.from(body + ' '), header, 'app-secret')).toBe(false);
    expect(validSignature(Buffer.from(body), undefined, 'app-secret')).toBe(false);
    expect(validSignature(Buffer.from(body), header, '')).toBe(false);
  });
});

describe('canReply', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('allows a free reply for 24 hours after the parent wrote', () => {
    expect(canReply(new Date('2026-11-04T12:30:00Z'), now)).toBe(true);
    expect(canReply(new Date('2026-11-04T11:59:00Z'), now)).toBe(false);
    expect(canReply(null, now)).toBe(false);
  });
});

describe('groupThreads', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 5, h));
  it('makes one thread per number with unread incoming messages counted', () => {
    const threads = groupThreads([
      { phone: '1', direction: 'OUT', body: 'Noted', contactName: null, readAt: null, createdAt: at(10) },
      { phone: '2', direction: 'IN', body: 'Hello', contactName: 'Sana', readAt: null, createdAt: at(9) },
      { phone: '1', direction: 'IN', body: 'He is ill', contactName: 'Imran', readAt: null, createdAt: at(8) },
      { phone: '1', direction: 'IN', body: 'Earlier', contactName: null, readAt: at(7), createdAt: at(7) },
    ]);
    expect(threads.map((t) => t.phone)).toEqual(['1', '2']);
    expect(threads[0]).toMatchObject({ name: 'Imran', lastBody: 'Noted', lastDirection: 'OUT', unread: 1, lastInboundAt: at(8) });
    expect(threads[1]).toMatchObject({ name: 'Sana', unread: 1 });
  });
});

describe('deliveryReport', () => {
  const log = (o: Partial<Parameters<typeof deliveryReport>[0][number]>) => ({
    template: 'fees.reminder',
    channel: 'WHATSAPP',
    status: 'SENT',
    error: null,
    createdAt: new Date('2026-11-05T08:00:00Z'),
    deliveredAt: null,
    readAt: null,
    ...o,
  });

  it('counts outcomes, receipts, types, days and the commonest errors', () => {
    const report = deliveryReport([
      log({ deliveredAt: new Date(), readAt: new Date() }),
      log({ deliveredAt: new Date() }),
      log({ status: 'FAILED', error: 'WhatsApp API 400: number 923001234567 is not on WhatsApp' }),
      log({ status: 'FAILED', error: 'WhatsApp API 400: number 923331112223 is not on WhatsApp' }),
      log({ status: 'LOGGED', template: 'attendance.absent', createdAt: new Date('2026-11-04T08:00:00Z') }),
      log({ status: 'QUEUED' }),
    ]);
    expect(report.totals).toEqual({ total: 6, sent: 2, failed: 2, queued: 1, notDelivered: 1, delivered: 2, read: 1 });
    expect(report.byTemplate[0]).toMatchObject({ template: 'fees.reminder', total: 5, sent: 2, failed: 2, delivered: 2, read: 1 });
    expect(report.byDay).toEqual([
      { date: '2026-11-04', count: 1 },
      { date: '2026-11-05', count: 5 },
    ]);
    expect(report.topErrors).toHaveLength(1);
    expect(report.topErrors[0].count).toBe(2);
    expect(report.topErrors[0].error).not.toMatch(/92300123/);
  });
});
