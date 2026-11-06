/** True for the Ctrl+/ (or Cmd+/) shortcut that opens Aon. */
export const isAonShortcut = (e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">) =>
  e.key === "/" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;

/** "1.2M", "850K", "400": token counts are big, so the panel shows them short. */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
