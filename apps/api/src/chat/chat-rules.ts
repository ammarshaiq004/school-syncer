import { z } from 'zod';

export const MAX_BODY = 2000;

export const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a message')
    .max(MAX_BODY, `Messages can be up to ${MAX_BODY} characters`),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;

export const createThreadSchema = z.object({
  studentId: z.string().min(1),
  staffUserId: z.string().min(1),
});
export type CreateThread = z.infer<typeof createThreadSchema>;

export const messagesQuerySchema = z.object({
  /** Return messages sent after this message id (polling). */
  after: z.string().min(1).optional(),
  /** Return messages sent before this message id (loading older history). */
  before: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

export const threadsQuerySchema = z.object({
  /** mine (default): threads I take part in. all: setup roles' safeguarding view of every thread in campus scope. */
  scope: z.enum(['mine', 'all']).default('mine'),
  studentId: z.string().min(1).optional(),
});
export type ThreadsQuery = z.infer<typeof threadsQuerySchema>;

export type ThreadRole = 'PARENT' | 'STAFF' | 'OBSERVER';

export interface ThreadParticipants {
  guardianUserId: string | null;
  staffUserId: string | null;
}

/**
 * How a user relates to a thread. A participant is the guardian (who must
 * still be a guardian of the thread's student) or the staff member; setup
 * roles with the campus in scope may observe read-only; everyone else has no
 * access (null).
 */
export function threadRole(
  thread: ThreadParticipants,
  userId: string,
  opts: { isGuardianOfStudent: boolean; canObserve: boolean },
): ThreadRole | null {
  if (thread.guardianUserId === userId && opts.isGuardianOfStudent)
    return 'PARENT';
  if (thread.staffUserId === userId) return 'STAFF';
  if (opts.canObserve) return 'OBSERVER';
  return null;
}

/** Only participants post, and only while both sides still exist (a removed account makes the thread read-only). */
export function canPost(
  thread: ThreadParticipants,
  role: ThreadRole | null,
): boolean {
  if (role !== 'PARENT' && role !== 'STAFF') return false;
  return thread.guardianUserId !== null && thread.staffUserId !== null;
}

export interface ContactSource {
  classTeacher: { id: string; name: string } | null;
  subjects: { subject: string; teacher: { id: string; name: string } | null }[];
}

export interface Contact {
  userId: string;
  name: string;
  isClassTeacher: boolean;
  subjects: string[];
}

/**
 * A student's teachers as chat contacts: the class teacher first, then subject
 * teachers by name, one entry per person with the subjects they teach.
 */
export function buildContacts(src: ContactSource): Contact[] {
  const byId = new Map<string, Contact>();
  if (src.classTeacher) {
    byId.set(src.classTeacher.id, {
      userId: src.classTeacher.id,
      name: src.classTeacher.name,
      isClassTeacher: true,
      subjects: [],
    });
  }
  for (const s of src.subjects) {
    if (!s.teacher) continue;
    const existing = byId.get(s.teacher.id);
    if (existing) {
      if (!existing.subjects.includes(s.subject))
        existing.subjects.push(s.subject);
    } else {
      byId.set(s.teacher.id, {
        userId: s.teacher.id,
        name: s.teacher.name,
        isClassTeacher: false,
        subjects: [s.subject],
      });
    }
  }
  for (const c of byId.values()) c.subjects.sort((a, b) => a.localeCompare(b));
  return [...byId.values()].sort(
    (a, b) =>
      Number(b.isClassTeacher) - Number(a.isClassTeacher) ||
      a.name.localeCompare(b.name),
  );
}

/** A short preview of a message for thread lists. */
export function preview(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
