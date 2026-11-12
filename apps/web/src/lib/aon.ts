/** True for the Ctrl+/ (or Cmd+/) shortcut that opens Aon. */
export const isAonShortcut = (e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">) =>
  e.key === "/" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;

/** "1.2M", "850K", "400": token counts are big, so the panel shows them short. */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** What Hudhud is doing; one pose per state, each with its own picture and motion (see aon-mascot). */
export type AonPose = "idle" | "listening" | "thinking" | "searching" | "success" | "sleeping";

/**
 * Hudhud's pose for the chat: asleep when the chat is closed, switched off at the limit or left alone for a while,
 * a short celebration when an answer lands, thinking and then searching while a question runs, listening while the
 * person speaks or types.
 */
export function aonPose(s: {
  active: boolean;
  blocked: boolean;
  celebrating: boolean;
  pending: boolean;
  slow: boolean;
  listening: boolean;
  drowsy: boolean;
}): AonPose {
  if (s.blocked || !s.active) return "sleeping";
  if (s.celebrating) return "success";
  if (s.pending) return s.slow ? "searching" : "thinking";
  if (s.listening) return "listening";
  return s.drowsy ? "sleeping" : "idle";
}
