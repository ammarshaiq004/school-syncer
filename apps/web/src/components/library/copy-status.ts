/** Label and pill tone for a library book copy's status. */
export const COPY_STATUS: Record<string, { label: string; tone: "success" | "info" | "danger" | "neutral" }> = {
  AVAILABLE: { label: "On the shelf", tone: "success" },
  ON_LOAN: { label: "On loan", tone: "info" },
  LOST: { label: "Lost", tone: "danger" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
};
