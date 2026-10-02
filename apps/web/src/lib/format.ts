/** "Rs 12,500" */
export const rupees = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/** "5 Oct 2026" from an ISO date or Date. */
export const day = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Today in the browser's local timezone, as YYYY-MM-DD. */
export const todayIso = () => new Date().toLocaleDateString("en-CA");
export const thisMonth = () => todayIso().slice(0, 7);

export const fullName = (s: { firstName: string; lastName?: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(" ");

/** "1 student", "3 students". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
