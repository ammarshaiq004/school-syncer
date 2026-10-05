import type { Prisma } from '@prisma/client';
import { nextDay } from '../common/date-range.js';
import { startOfLocalDay } from '../common/dates.js';

export interface AuditFilters {
  entity?: string;
  userId?: string;
  action?: string;
  /** Inclusive local days, YYYY-MM-DD. */
  from?: string;
  to?: string;
}

/** The Prisma filter for GET /audit, always scoped to the caller's school. */
export function auditWhere(schoolId: string, f: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { schoolId };
  if (f.entity) where.entity = f.entity;
  // 'platform' = entries written by SchoolSyncer staff from the console (no school user).
  if (f.userId) where.userId = f.userId === 'platform' ? null : f.userId;
  // "user" matches user.create, user.update...; "user.update" matches exactly that.
  if (f.action) where.action = f.action.includes('.') ? f.action : { startsWith: `${f.action}.` };
  if (f.from || f.to) {
    where.createdAt = {
      ...(f.from ? { gte: startOfLocalDay(f.from) } : {}),
      ...(f.to ? { lt: startOfLocalDay(nextDay(f.to)) } : {}),
    };
  }
  return where;
}

const supportName = (support: unknown): string | null =>
  support && typeof support === 'object' && typeof (support as { adminName?: unknown }).adminName === 'string'
    ? (support as { adminName: string }).adminName
    : null;

/**
 * Who made a change, for display. School users by name; console entries
 * (userId null) carry the SchoolSyncer staff name in after.by. Changes made
 * in a support session name the user acted as and the staff member behind it.
 */
export function actorOf(
  entry: { userId: string | null; after: unknown; support?: unknown },
  names: Map<string, string>,
): { kind: 'user' | 'platform' | 'system'; id: string | null; name: string } {
  if (entry.userId) {
    const name = names.get(entry.userId) ?? 'Removed user';
    const via = supportName(entry.support);
    return { kind: 'user', id: entry.userId, name: via ? `${name} (via SchoolSyncer support: ${via})` : name };
  }
  const after = entry.after;
  const by =
    after && typeof after === 'object' && !Array.isArray(after) && typeof (after as { by?: unknown }).by === 'string'
      ? (after as { by: string }).by
      : null;
  return by ? { kind: 'platform', id: null, name: `${by} (SchoolSyncer)` } : { kind: 'system', id: null, name: 'System' };
}
