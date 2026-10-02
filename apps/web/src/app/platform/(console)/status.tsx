import { Badge } from "@/components/ui";

const STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  TRIAL: { label: "Trial", tone: "blue" },
  ACTIVE: { label: "Active", tone: "green" },
  PAST_DUE: { label: "Past due", tone: "amber" },
  SUSPENDED: { label: "Suspended", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
  UNPAID: { label: "Unpaid", tone: "amber" },
  PAID: { label: "Paid", tone: "green" },
  VOID: { label: "Void", tone: "gray" },
};

export const STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"] as const;

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge>No plan</Badge>;
  const s = STATUS[status] ?? { label: status, tone: "gray" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
