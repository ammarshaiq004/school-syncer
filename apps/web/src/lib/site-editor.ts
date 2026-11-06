import type { SiteConfig } from "./site";

/** Colour pairs a school can start from in the website editor. */
export const PALETTES: { name: string; primary: string; accent: string }[] = [
  { name: "Indigo and amber", primary: "#4f46e5", accent: "#f59e0b" },
  { name: "Teal and orange", primary: "#0f766e", accent: "#f97316" },
  { name: "Crimson and sky", primary: "#be123c", accent: "#0ea5e9" },
  { name: "Forest and gold", primary: "#166534", accent: "#eab308" },
  { name: "Navy and coral", primary: "#1e3a8a", accent: "#fb7185" },
  { name: "Plum and mint", primary: "#7e22ce", accent: "#14b8a6" },
];

export type SectionKey = keyof SiteConfig;

/**
 * What to save: the choices already saved plus every section the editor touched.
 * Untouched sections stay out, so they keep following the defaults (live student
 * counts, the school's own address) instead of freezing today's values.
 */
export function contentToSave(saved: Partial<SiteConfig>, draft: SiteConfig, touched: ReadonlySet<SectionKey>): Partial<SiteConfig> {
  const out: Record<string, unknown> = { ...saved };
  for (const key of touched) out[key] = draft[key];
  return out as Partial<SiteConfig>;
}

/** Puts a section back on its defaults: dropped from what is saved, and redrawn from the defaults. */
export function resetSection(key: SectionKey, draft: SiteConfig, defaults: SiteConfig, touched: ReadonlySet<SectionKey>) {
  const next = new Set(touched);
  next.delete(key);
  return { draft: { ...draft, [key]: defaults[key] } as SiteConfig, touched: next, dropped: key };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Problems to fix before saving, in plain words. */
export function draftProblems(draft: SiteConfig): string[] {
  const problems: string[] = [];
  if (!HEX.test(draft.theme.primary)) problems.push("The main colour needs a value like #4f46e5.");
  if (!HEX.test(draft.theme.accent)) problems.push("The accent colour needs a value like #f59e0b.");
  if (!draft.hero.headline.trim()) problems.push("The home page needs a headline.");
  for (const e of draft.events) if (!e.date) problems.push(`The event "${e.title || "untitled"}" needs a date.`);
  for (const n of draft.news) if (!n.date) problems.push(`The news item "${n.title || "untitled"}" needs a date.`);
  return problems;
}
