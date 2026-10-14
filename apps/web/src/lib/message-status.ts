/** How the message log shows a NotificationLog status (apps/api/prisma/schema.prisma). */
export const STATUS_TONE = { SENT: "success", FAILED: "danger", LOGGED: "neutral", QUEUED: "warning" } as const;
export const STATUS_LABEL: Record<string, string> = { SENT: "Sent", FAILED: "Failed", QUEUED: "Queued", LOGGED: "Not delivered" };

/** The line under a message: why it was not delivered, the provider's error, or the retry under way. */
export function statusDetail(l: { status: string; error: string | null; attempts: number }): string | null {
  if (l.status === "LOGGED") return "Not delivered: no provider configured";
  if (l.status === "FAILED") return `Failed after ${l.attempts} attempt${l.attempts === 1 ? "" : "s"}${l.error ? `: ${l.error}` : ""}`;
  if (l.status === "QUEUED" && l.error) return `Retrying (attempt ${l.attempts} failed): ${l.error}`;
  return null;
}
