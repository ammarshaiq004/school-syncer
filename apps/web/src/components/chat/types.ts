/** Shapes returned by the /chat and /parent/chat endpoints. */

export type ThreadRole = "PARENT" | "STAFF" | "OBSERVER";

export interface ChatThread {
  id: string;
  student: { id: string; name: string; photoUrl: string | null; className: string | null };
  guardian: { id: string; name: string } | null;
  staff: { id: string; name: string } | null;
  role: ThreadRole;
  canPost: boolean;
  lastMessageAt: string | null;
  lastMessage: { preview: string; senderId: string | null; mine: boolean; createdAt: string } | null;
  unread: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  body: string;
  senderId: string | null;
  senderName: string | null;
  mine: boolean;
  createdAt: string;
  readAt: string | null;
}

/** A message in the conversation pane; `pending` while the send is in flight. */
export type ShownMessage = ChatMessage & { pending?: boolean };

export interface MessagesPage {
  items: ChatMessage[];
  hasMore: boolean;
}

export interface ChatContactGroup {
  student: { id: string; name: string; photoUrl: string | null; relation: string; className: string | null };
  contacts: { userId: string; name: string; isClassTeacher: boolean; subjects: string[]; threadId: string | null }[];
}

export interface ChatUnread {
  total: number;
  threads: Record<string, number>;
}

/** Messages are capped at 2000 characters by the API. */
export const MAX_MESSAGE_LENGTH = 2000;

/** The person on the other side of the thread, from the viewer's point of view. */
export function counterpart(t: ChatThread): string {
  if (t.role === "PARENT") return t.staff?.name ?? "Former staff member";
  if (t.role === "STAFF") return t.guardian?.name ?? "Former parent account";
  return `${t.guardian?.name ?? "Former parent account"} and ${t.staff?.name ?? "former staff member"}`;
}

/** Second line under the name: who the conversation is about. */
export function aboutLine(t: ChatThread): string {
  const cls = t.student.className ? `, ${t.student.className}` : "";
  return t.role === "STAFF" ? `Parent of ${t.student.name}${cls}` : `About ${t.student.name}${cls}`;
}

const timeFmt = new Intl.DateTimeFormat("en-PK", { hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("en-PK", { weekday: "short" });
const shortDateFmt = new Intl.DateTimeFormat("en-PK", { day: "numeric", month: "short" });
const longDateFmt = new Intl.DateTimeFormat("en-PK", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
function daysAgo(d: Date, now = new Date()) {
  const a = new Date(dayKey(d));
  const b = new Date(dayKey(now));
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export const messageTime = (iso: string) => timeFmt.format(new Date(iso));

/** Compact stamp for the thread list: time today, "Yesterday", weekday this week, else date. */
export function listStamp(iso: string): string {
  const d = new Date(iso);
  const ago = daysAgo(d);
  if (ago <= 0) return timeFmt.format(d);
  if (ago === 1) return "Yesterday";
  if (ago < 7) return weekdayFmt.format(d);
  return shortDateFmt.format(d);
}

/** Day separator label inside a conversation. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const ago = daysAgo(d);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  return longDateFmt.format(d);
}

export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));
