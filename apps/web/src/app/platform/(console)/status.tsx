import { StatusPill, type Tone } from "@/components/ui";

/** Subscription and bill statuses used across the console. */
const STATUS: Record<string, { label: string; tone: Tone; color: string }> = {
  TRIAL: { label: "Trial", tone: "info", color: "var(--info)" },
  ACTIVE: { label: "Active", tone: "success", color: "var(--success)" },
  PAST_DUE: { label: "Past due", tone: "warning", color: "var(--warning)" },
  SUSPENDED: { label: "Suspended", tone: "danger", color: "var(--danger)" },
  CANCELLED: { label: "Cancelled", tone: "neutral", color: "var(--chart-6)" },
  UNPAID: { label: "Unpaid", tone: "warning", color: "var(--warning)" },
  PAID: { label: "Paid", tone: "success", color: "var(--success)" },
  VOID: { label: "Void", tone: "neutral", color: "var(--chart-6)" },
};

export const STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"] as const;

export const statusLabel = (status: string) => STATUS[status]?.label ?? status;
export const statusColor = (status: string) => STATUS[status]?.color ?? "var(--chart-6)";

/** Options for a status select (subscription statuses). */
export const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <StatusPill status="none" tone="neutral" label="No plan" />;
  const s = STATUS[status];
  return <StatusPill status={status} tone={s?.tone} label={s?.label} />;
}

export const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
