import { createHmac, timingSafeEqual } from 'node:crypto';
import { localDate } from '../common/dates.js';
import { REPLY_WINDOW_MS } from './drivers.js';

export interface InboundMessage {
  /** The business number the parent wrote to (WhatsApp Cloud API phone number id). */
  phoneNumberId: string;
  /** International format without "+". */
  from: string;
  name: string | null;
  id: string;
  text: string;
  at: Date;
}

export interface DeliveryReceipt {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
}

/** What Meta's webhook carried: messages from parents and delivery receipts for ours. Unknown shapes are skipped. */
export function parseWebhook(payload: unknown): { messages: InboundMessage[]; receipts: DeliveryReceipt[] } {
  const messages: InboundMessage[] = [];
  const receipts: DeliveryReceipt[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return { messages, receipts };
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] } | null)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> } | null)?.value;
      if (!value || typeof value !== 'object') continue;
      const phoneNumberId = String((value.metadata as { phone_number_id?: unknown } | undefined)?.phone_number_id ?? '');
      const contacts = (value.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
      for (const m of (value.messages as Record<string, unknown>[] | undefined) ?? []) {
        const from = String(m.from ?? '');
        const id = String(m.id ?? '');
        if (!phoneNumberId || !from || !id) continue;
        const type = String(m.type ?? 'text');
        const body = type === 'text' ? String((m.text as { body?: unknown } | undefined)?.body ?? '') : `[${type}]`;
        messages.push({
          phoneNumberId,
          from,
          name: contacts.find((c) => c.wa_id === from)?.profile?.name ?? null,
          id,
          text: body.slice(0, 4000),
          at: new Date(Number(m.timestamp) * 1000 || Date.now()),
        });
      }
      for (const s of (value.statuses as Record<string, unknown>[] | undefined) ?? []) {
        const status = String(s.status);
        if (!s.id || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
        receipts.push({ id: String(s.id), status: status as DeliveryReceipt['status'], at: new Date(Number(s.timestamp) * 1000 || Date.now()) });
      }
    }
  }
  return { messages, receipts };
}

/** Meta signs the raw body with the app secret: "sha256=<hex hmac>" in X-Hub-Signature-256. */
export function validSignature(raw: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A reply can be free text only while the parent's last message is under 24 hours old. */
export const canReply = (lastInboundAt: Date | null, now = new Date()): boolean =>
  !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < REPLY_WINDOW_MS;

export interface Thread {
  phone: string;
  name: string | null;
  lastBody: string;
  lastAt: Date;
  lastDirection: 'IN' | 'OUT';
  unread: number;
  lastInboundAt: Date | null;
}

/** One row per phone number, newest conversation first. `rows` must be newest first. */
export function groupThreads(
  rows: { phone: string; direction: 'IN' | 'OUT'; body: string; contactName: string | null; readAt: Date | null; createdAt: Date }[],
): Thread[] {
  const threads = new Map<string, Thread>();
  for (const r of rows) {
    let t = threads.get(r.phone);
    if (!t) {
      t = { phone: r.phone, name: null, lastBody: r.body, lastAt: r.createdAt, lastDirection: r.direction, unread: 0, lastInboundAt: null };
      threads.set(r.phone, t);
    }
    if (r.direction === 'IN') {
      t.name ??= r.contactName;
      t.lastInboundAt ??= r.createdAt;
      if (!r.readAt) t.unread++;
    }
  }
  return [...threads.values()];
}

export interface LogRow {
  template: string;
  channel: string;
  status: string;
  error: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
}

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const sorted = (map: Map<string, number>) => [...map].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

/** Delivery report over a period's message log: totals, per message type, per day and the commonest errors. */
export function deliveryReport(rows: LogRow[]) {
  const byTemplate = new Map<string, { total: number; sent: number; failed: number; delivered: number; read: number }>();
  const byDay = new Map<string, number>();
  const errors = new Map<string, number>();
  const totals = { total: rows.length, sent: 0, failed: 0, queued: 0, notDelivered: 0, delivered: 0, read: 0 };
  for (const r of rows) {
    const t = byTemplate.get(r.template) ?? { total: 0, sent: 0, failed: 0, delivered: 0, read: 0 };
    t.total++;
    if (r.status === 'SENT') {
      totals.sent++;
      t.sent++;
    } else if (r.status === 'FAILED') {
      totals.failed++;
      t.failed++;
    } else if (r.status === 'LOGGED') totals.notDelivered++;
    else totals.queued++;
    if (r.deliveredAt || r.readAt) {
      totals.delivered++;
      t.delivered++;
    }
    if (r.readAt) {
      totals.read++;
      t.read++;
    }
    byTemplate.set(r.template, t);
    bump(byDay, localDate(r.createdAt));
    // Errors can quote the recipient's number; drop it so the same refusal groups together.
    if (r.status === 'FAILED' && r.error) bump(errors, r.error.replace(/\+?\d[\d -]{5,}\d/g, '<number>').slice(0, 120));
  }
  return {
    totals,
    byTemplate: [...byTemplate].map(([template, v]) => ({ template, ...v })).sort((a, b) => b.total - a.total),
    byDay: [...byDay].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    topErrors: sorted(errors).slice(0, 5).map(({ key, count }) => ({ error: key, count })),
  };
}
