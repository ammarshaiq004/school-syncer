/** Types and pure helpers for a school's public website (/s/<slug>). */

export type SiteFont = "editorial" | "modern" | "scholar" | "friendly" | "geometric";
export type SiteScene = "campus" | "learning";
export type SiteIcon =
  | "book" | "atom" | "palette" | "calculator" | "globe" | "laptop" | "music" | "trophy"
  | "heart" | "pencil" | "star" | "leaf" | "bulb" | "shield" | "flask" | "people";
export type GalleryArt = "science" | "library" | "sports" | "art" | "music" | "garden" | "computer" | "assembly";
export type EventKind = "academic" | "exam" | "holiday" | "event";

export const SITE_FONTS: { value: SiteFont; label: string; sample: string }[] = [
  { value: "editorial", label: "Editorial", sample: "Warm, bookish serif headings" },
  { value: "modern", label: "Modern", sample: "Clean, confident sans headings" },
  { value: "scholar", label: "Scholar", sample: "Classic, high-contrast serif" },
  { value: "friendly", label: "Friendly", sample: "Rounded and playful for young learners" },
  { value: "geometric", label: "Geometric", sample: "Crisp, contemporary shapes" },
];
export const SITE_ICONS: SiteIcon[] = [
  "book", "atom", "palette", "calculator", "globe", "laptop", "music", "trophy",
  "heart", "pencil", "star", "leaf", "bulb", "shield", "flask", "people",
];
export const GALLERY_ARTS: { value: GalleryArt; label: string }[] = [
  { value: "science", label: "Science lab" },
  { value: "library", label: "Library" },
  { value: "sports", label: "Sports" },
  { value: "art", label: "Art room" },
  { value: "music", label: "Music" },
  { value: "garden", label: "Garden" },
  { value: "computer", label: "Computer lab" },
  { value: "assembly", label: "Assembly" },
];
export const EVENT_KINDS: { value: EventKind; label: string }[] = [
  { value: "academic", label: "Academic" },
  { value: "exam", label: "Exam" },
  { value: "holiday", label: "Holiday" },
  { value: "event", label: "Event" },
];

export interface SiteConfig {
  theme: { primary: string; accent: string; font: SiteFont; scene: SiteScene; corners: "soft" | "sharp"; appearance: "light" | "dark" | "auto" };
  show: Record<"about" | "programs" | "admissions" | "news" | "calendar" | "gallery" | "faculty" | "fees" | "testimonials" | "faq", boolean>;
  hero: { tagline: string; headline: string; subheadline: string; notice: string };
  about: { title: string; body: string; motto: string; values: { title: string; text: string; icon: SiteIcon }[] };
  stats: { value: number; suffix: string; label: string }[];
  programs: { title: string; ages: string; text: string; icon: SiteIcon }[];
  admissions: { intro: string; steps: { title: string; text: string }[]; requirements: string[]; deadline: string };
  fees: { note: string; rows: { label: string; amount: number; per: string }[] };
  news: { title: string; date: string; text: string }[];
  events: { title: string; date: string; time: string; place: string; kind: EventKind }[];
  faculty: { name: string; role: string; bio: string }[];
  gallery: { caption: string; art: GalleryArt }[];
  testimonials: { quote: string; name: string; relation: string }[];
  faq: { q: string; a: string }[];
  contact: { address: string; hours: string; whatsapp: string; facebook?: string; instagram?: string; youtube?: string; website?: string };
  seo: { title: string; description: string };
}

export interface PublicSite {
  school: { name: string; slug: string; city: string | null; phone: string | null; email: string | null; logoUrl: string | null; locale: string; mode: "PHYSICAL" | "ONLINE" | "HYBRID" };
  campuses: { name: string; address: string | null; phone: string | null }[];
  admissionsOpen: boolean;
  site: SiteConfig;
}

/** What GET /school/site returns for the editor. */
export interface SiteEditorData {
  slug: string;
  logoUrl: string | null;
  published: boolean;
  saved: Partial<SiteConfig>;
  config: SiteConfig;
  defaults: SiteConfig;
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}
export function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}
/** `t` of the way from a to b, in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t) as RGB);
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Whichever of dark ink or white reads better on this fill. */
export function onColor(fill: string, ink = "#101323"): string {
  return contrast("#ffffff", fill) >= contrast(ink, fill) ? "#ffffff" : ink;
}
/** Moves a colour toward black or white (whichever helps) until it reads at `min` on `bg`. */
export function readable(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color;
  const target = luminance(bg) > 0.4 ? "#000000" : "#ffffff";
  for (let t = 0.05; t <= 1.001; t += 0.05) {
    const next = mix(color, target, t);
    if (contrast(next, bg) >= min) return next;
  }
  return target;
}

export interface SiteTokens {
  paper: string; paper2: string; card: string; ink: string; ink2: string; line: string;
  b: string; onB: string; bText: string; bSoft: string; bSoft2: string; bDeep: string;
  a: string; onA: string; aText: string; aSoft: string;
  leaf: string; leafDeep: string; sky: string; glow: string; foot: string; win: string; cloud: string; moon: string;
  /** 1 or 0: which sky the hero scene shows. */
  sunO: string; moonO: string;
}

/** The whole site's colours from the school's two choices, for one appearance. */
export function siteTokens(primary: string, accent: string, dark: boolean): SiteTokens {
  const paper = dark ? mix("#090c17", primary, 0.12) : mix("#fffdf8", primary, 0.045);
  const ink = dark ? mix("#f7f4ee", primary, 0.07) : mix("#0d1020", primary, 0.2);
  const b = dark ? readable(primary, paper, 3) : primary;
  const a = dark ? readable(accent, paper, 3) : accent;
  const leaf = mix(dark ? "#4fb884" : "#38a169", primary, 0.14);
  return {
    paper,
    paper2: dark ? mix(paper, primary, 0.11) : mix(paper, primary, 0.075),
    card: dark ? mix(paper, "#ffffff", 0.06) : mix("#ffffff", primary, 0.012),
    ink,
    ink2: readable(mix(ink, paper, 0.34), paper, 5),
    line: mix(paper, ink, dark ? 0.2 : 0.13),
    b,
    onB: onColor(b),
    bText: readable(primary, paper, 4.5),
    bSoft: mix(paper, primary, dark ? 0.24 : 0.14),
    bSoft2: mix(paper, primary, dark ? 0.4 : 0.28),
    bDeep: mix(b, "#000000", dark ? 0.4 : 0.34),
    a,
    onA: onColor(a),
    aText: readable(accent, paper, 4.5),
    aSoft: mix(paper, accent, dark ? 0.26 : 0.22),
    leaf,
    leafDeep: mix(leaf, "#000000", 0.28),
    sky: mix(paper, primary, dark ? 0.3 : 0.17),
    glow: mix(b, "#000000", 0.45),
    foot: dark ? mix("#05070e", primary, 0.16) : mix("#0d1020", primary, 0.26),
    win: dark ? "#ffd978" : mix("#ffffff", primary, 0.16),
    cloud: dark ? mix(paper, "#ffffff", 0.16) : "#ffffff",
    moon: "#fdf3cf",
    sunO: dark ? "0" : "1",
    moonO: dark ? "1" : "0",
  };
}

const cssName = (k: string) => "--" + k.replace(/[A-Z0-9]/g, (c) => "-" + c.toLowerCase());
export function tokenCss(t: SiteTokens): string {
  return Object.entries(t).map(([k, v]) => `${cssName(k)}:${v}`).join(";");
}

/** One stylesheet per school: light, dark, and "auto" following the visitor's system. */
export function siteStyles(scope: string, primary: string, accent: string): string {
  const light = tokenCss(siteTokens(primary, accent, false));
  const dark = tokenCss(siteTokens(primary, accent, true));
  return (
    `${scope}{${light};color-scheme:light}` +
    `${scope}[data-mode="dark"]{${dark};color-scheme:dark}` +
    `@media (prefers-color-scheme:dark){${scope}[data-mode="auto"]{${dark};color-scheme:dark}}`
  );
}

/* ------------------------------------------------------------------ */
/* Text, links, dates                                                  */
/* ------------------------------------------------------------------ */

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const skip = new Set(["the", "school", "academy", "of", "and", "&"]);
  const useful = words.filter((w) => !skip.has(w.toLowerCase()));
  const pick = (useful.length ? useful : words).slice(0, 2);
  return pick.map((w) => Array.from(w)[0]?.toUpperCase() ?? "").join("") || "S";
}

/** Stable small integer from a string, to pick an illustration variant. */
export function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

/** "Learn with joy" -> ["Learn with", "joy"], so the last word can carry the scribble underline. */
export function splitLastWord(text: string): [string, string] {
  const t = text.trim();
  const i = t.lastIndexOf(" ");
  return i < 0 ? ["", t] : [t.slice(0, i), t.slice(i + 1)];
}

/** https://wa.me link from a typed number, or null when it is not a plausible number. */
export function whatsappLink(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  // 03001234567 -> 923001234567
  const intl = digits.startsWith("0") ? "92" + digits.slice(1) : digits;
  return `https://wa.me/${intl}`;
}
/** tel: link keeping only digits and a leading plus. */
export function telLink(raw: string): string {
  return "tel:" + raw.replace(/[^\d+]/g, "");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: number) => MONTHS[m];
export function parseDay(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}
export function shortDate(iso: string): string {
  const { m, d } = parseDay(iso);
  return `${d} ${MONTHS[m].slice(0, 3)}`;
}
export function longDate(iso: string): string {
  const { y, m, d } = parseDay(iso);
  return `${d} ${MONTHS[m]} ${y}`;
}
export function rupees(n: number): string {
  return "Rs " + n.toLocaleString("en-PK");
}

/** Weeks of a month as rows of day numbers (null pads), Monday first. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/** Events from `today` on, soonest first. */
export function upcoming<T extends { date: string }>(events: T[], today: string): T[] {
  return events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}
