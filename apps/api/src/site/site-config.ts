import { z } from 'zod';

/**
 * A school's public website (served by the web app at /s/<slug>).
 *
 * The school saves only what it changed: `resolveSite` lays that over
 * defaults built from the school's own record and live counts, so a school
 * that has written nothing still gets a complete, honest site.
 */

export const SITE_FONTS = ['editorial', 'modern', 'scholar', 'friendly', 'geometric'] as const;
export const SITE_SCENES = ['campus', 'learning'] as const;
export const SITE_ICONS = [
  'book', 'atom', 'palette', 'calculator', 'globe', 'laptop', 'music', 'trophy',
  'heart', 'pencil', 'star', 'leaf', 'bulb', 'shield', 'flask', 'people',
] as const;
export const GALLERY_ART = ['science', 'library', 'sports', 'art', 'music', 'garden', 'computer', 'assembly'] as const;
export const EVENT_KINDS = ['academic', 'exam', 'holiday', 'event'] as const;

const text = (max: number) => z.string().trim().max(max);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #4f46e5');
/** A web or messaging address; blank clears it. */
const link = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.url({ protocol: /^https?$/ }).max(300).optional(),
);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31');
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max);

export const siteInputSchema = z
  .object({
    published: z.boolean(),
    theme: z
      .object({
        primary: hex,
        accent: hex,
        font: z.enum(SITE_FONTS),
        scene: z.enum(SITE_SCENES),
        corners: z.enum(['soft', 'sharp']),
        appearance: z.enum(['light', 'dark', 'auto']),
      })
      .partial(),
    show: z
      .object({
        about: z.boolean(),
        programs: z.boolean(),
        admissions: z.boolean(),
        news: z.boolean(),
        calendar: z.boolean(),
        gallery: z.boolean(),
        faculty: z.boolean(),
        fees: z.boolean(),
        testimonials: z.boolean(),
        faq: z.boolean(),
      })
      .partial(),
    hero: z
      .object({
        tagline: text(90),
        headline: text(120),
        subheadline: text(260),
        /** A line under the headline, e.g. "Admissions open for 2027". */
        notice: text(90),
      })
      .partial(),
    about: z
      .object({
        title: text(80),
        body: text(2400),
        motto: text(80),
        values: list(z.object({ title: text(40), text: text(200), icon: z.enum(SITE_ICONS) }), 4),
      })
      .partial(),
    stats: list(z.object({ value: z.number().int().min(0).max(1_000_000), suffix: text(6), label: text(40) }), 4),
    programs: list(
      z.object({ title: text(60), ages: text(40), text: text(300), icon: z.enum(SITE_ICONS) }),
      6,
    ),
    admissions: z
      .object({
        intro: text(400),
        steps: list(z.object({ title: text(60), text: text(240) }), 5),
        requirements: list(text(120), 8),
        deadline: text(100),
      })
      .partial(),
    fees: z
      .object({
        note: text(300),
        rows: list(z.object({ label: text(60), amount: z.number().int().min(0).max(10_000_000), per: text(30) }), 8),
      })
      .partial(),
    news: list(z.object({ title: text(100), date: day, text: text(400) }), 6),
    events: list(
      z.object({ title: text(80), date: day, time: text(30), place: text(60), kind: z.enum(EVENT_KINDS) }),
      16,
    ),
    faculty: list(z.object({ name: text(60), role: text(60), bio: text(200) }), 8),
    gallery: list(z.object({ caption: text(60), art: z.enum(GALLERY_ART) }), 8),
    testimonials: list(z.object({ quote: text(320), name: text(60), relation: text(60) }), 4),
    faq: list(z.object({ q: text(140), a: text(600) }), 10),
    contact: z
      .object({
        address: text(200),
        hours: text(100),
        whatsapp: text(20),
        facebook: link,
        instagram: link,
        youtube: link,
        website: link,
      })
      .partial(),
    seo: z.object({ title: text(70), description: text(160) }).partial(),
  })
  .partial();
export type SiteInput = z.infer<typeof siteInputSchema>;

export interface SiteConfig {
  theme: {
    primary: string;
    accent: string;
    font: (typeof SITE_FONTS)[number];
    scene: (typeof SITE_SCENES)[number];
    corners: 'soft' | 'sharp';
    appearance: 'light' | 'dark' | 'auto';
  };
  show: Record<'about' | 'programs' | 'admissions' | 'news' | 'calendar' | 'gallery' | 'faculty' | 'fees' | 'testimonials' | 'faq', boolean>;
  hero: { tagline: string; headline: string; subheadline: string; notice: string };
  about: { title: string; body: string; motto: string; values: { title: string; text: string; icon: (typeof SITE_ICONS)[number] }[] };
  stats: { value: number; suffix: string; label: string }[];
  programs: { title: string; ages: string; text: string; icon: (typeof SITE_ICONS)[number] }[];
  admissions: { intro: string; steps: { title: string; text: string }[]; requirements: string[]; deadline: string };
  fees: { note: string; rows: { label: string; amount: number; per: string }[] };
  news: { title: string; date: string; text: string }[];
  events: { title: string; date: string; time: string; place: string; kind: (typeof EVENT_KINDS)[number] }[];
  faculty: { name: string; role: string; bio: string }[];
  gallery: { caption: string; art: (typeof GALLERY_ART)[number] }[];
  testimonials: { quote: string; name: string; relation: string }[];
  faq: { q: string; a: string }[];
  contact: {
    address: string; hours: string; whatsapp: string;
    facebook?: string; instagram?: string; youtube?: string; website?: string;
  };
  seo: { title: string; description: string };
}

/** What the defaults are built from: the school's record and live counts. */
export interface SiteSource {
  name: string;
  city: string | null;
  mode: 'PHYSICAL' | 'ONLINE' | 'HYBRID';
  campuses: { name: string; address: string | null }[];
  counts: { students: number; teachers: number; campuses: number };
}

/** "1,200 students" reads as a fact, so live counts are rounded down to a round figure. */
export function roundedCount(n: number): number {
  if (n < 20) return n;
  const step = n < 100 ? 5 : n < 1000 ? 10 : 50;
  return n - (n % step);
}

export function defaultSite(src: SiteSource): SiteConfig {
  const online = src.mode === 'ONLINE';
  const where = src.city ? ` in ${src.city}` : '';
  const stats: SiteConfig['stats'] = [
    { value: roundedCount(src.counts.students), suffix: src.counts.students >= 20 ? '+' : '', label: 'Students' },
    { value: roundedCount(src.counts.teachers), suffix: src.counts.teachers >= 20 ? '+' : '', label: 'Teachers' },
    ...(src.counts.campuses > 1 ? [{ value: src.counts.campuses, suffix: '', label: 'Campuses' }] : []),
  ].filter((s) => s.value > 0);
  return {
    theme: { primary: '#4f46e5', accent: '#f59e0b', font: 'editorial', scene: online ? 'learning' : 'campus', corners: 'soft', appearance: 'light' },
    show: { about: true, programs: true, admissions: true, news: true, calendar: true, gallery: true, faculty: true, fees: true, testimonials: true, faq: true },
    hero: {
      tagline: `A school${where} where every child is known`,
      headline: `Where ${src.name} children learn to love learning`,
      subheadline: online
        ? 'Live classes, clear homework and caring teachers, from wherever your child learns best.'
        : 'Caring teachers, small steps that add up, and a place your child is glad to walk into each morning.',
      notice: '',
    },
    about: {
      title: `About ${src.name}`,
      body:
        `${src.name} is a school${where} built around one idea: children learn best when they feel known, safe and curious.\n\n` +
        'Our teachers keep classes focused and warm, report progress to parents honestly, and celebrate effort as much as results.',
      motto: 'Know every child. Teach every child.',
      values: [
        { title: 'Curiosity', text: 'Questions are welcome in every classroom.', icon: 'bulb' },
        { title: 'Kindness', text: 'We teach manners and care as seriously as maths.', icon: 'heart' },
        { title: 'Honesty', text: 'Parents hear how their child is really doing.', icon: 'shield' },
        { title: 'Effort', text: 'We celebrate trying hard, not only top marks.', icon: 'star' },
      ],
    },
    stats,
    programs: [
      { title: 'Early years', ages: 'Playgroup to KG', text: 'Play, stories and songs that build language, confidence and a love of school.', icon: 'palette' },
      { title: 'Primary', ages: 'Classes 1 to 5', text: 'Strong reading, writing and number sense, taught in small groups.', icon: 'book' },
      { title: 'Middle school', ages: 'Classes 6 to 8', text: 'Science, languages and projects that turn knowing into understanding.', icon: 'flask' },
      { title: 'Secondary', ages: 'Classes 9 to 10', text: 'Focused exam preparation with guidance on what comes after school.', icon: 'atom' },
    ],
    admissions: {
      intro: 'Apply online in two minutes. The admissions office will contact you to arrange a visit.',
      steps: [
        { title: 'Send the short form', text: 'Tell us about your child and how to reach you.' },
        { title: 'We contact you', text: 'Usually within two working days, by phone or WhatsApp.' },
        { title: 'Visit and assessment', text: 'Meet the teachers, see the classrooms and take a friendly entry assessment.' },
        { title: 'Join the school', text: 'Complete the paperwork and your child starts.' },
      ],
      requirements: ['Child’s birth certificate or B-form', 'Last school report card, if any', 'Two passport-size photographs', 'Parent or guardian CNIC copy'],
      deadline: '',
    },
    fees: { note: '', rows: [] },
    news: [],
    events: [],
    faculty: [],
    gallery: [
      { caption: 'Science lab', art: 'science' },
      { caption: 'Library hour', art: 'library' },
      { caption: 'Sports day', art: 'sports' },
      { caption: 'Art room', art: 'art' },
      { caption: 'Music class', art: 'music' },
      { caption: 'School garden', art: 'garden' },
    ],
    testimonials: [],
    faq: [
      { q: 'How do I apply?', a: 'Use the Apply online button on this page. The form takes about two minutes and goes straight to the admissions office.' },
      { q: 'When will the school contact me?', a: 'Usually within two working days, by phone or WhatsApp.' },
      { q: 'Can I visit the school first?', a: 'Yes. Mention it in your enquiry or call the office and we will arrange a time.' },
      { q: 'How do parents follow their child’s progress?', a: 'Parents get a login to see attendance, homework, results and fee dues for each child, on the web or the mobile app.' },
      { q: 'How are fees paid?', a: 'The office will share the fee details at admission. Many families pay online by JazzCash, Easypaisa or 1Bill when the school has enabled it.' },
    ],
    contact: {
      address: src.campuses.map((c) => c.address).find(Boolean) ?? (src.city ?? ''),
      hours: online ? 'Monday to Friday, 9:00 am to 4:00 pm' : 'Monday to Saturday, 8:00 am to 2:00 pm',
      whatsapp: '',
    },
    seo: { title: `${src.name}${src.city ? `, ${src.city}` : ''}`, description: `${src.name}${where}: programmes, admissions, news and contact details.` },
  };
}

/** The school's saved choices over the defaults, one section at a time. */
export function resolveSite(src: SiteSource, saved: unknown): SiteConfig {
  const base = defaultSite(src);
  const parsed = siteInputSchema.safeParse(saved ?? {});
  // A row that no longer validates (the schema tightened) falls back to defaults rather than breaking the site.
  const input: SiteInput = parsed.success ? parsed.data : {};
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(input)) {
    if (key === 'published' || value === undefined) continue;
    const fallback = (base as unknown as Record<string, unknown>)[key];
    out[key] = Array.isArray(value) || typeof value !== 'object' || value === null ? value : { ...(fallback as object), ...stripUndefined(value) };
  }
  return out as unknown as SiteConfig;
}

function stripUndefined(o: object): object {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** What the public page receives: the resolved site plus the facts it links to. */
export interface PublicSite {
  school: { name: string; slug: string; city: string | null; phone: string | null; email: string | null; logoUrl: string | null; locale: string; mode: SiteSource['mode'] };
  campuses: { name: string; address: string | null; phone: string | null }[];
  /** Whether the Apply online button leads somewhere (the plan includes admissions and the school is active). */
  admissionsOpen: boolean;
  site: SiteConfig;
}

export function publicSite(
  school: PublicSite['school'],
  campuses: PublicSite['campuses'],
  counts: SiteSource['counts'],
  saved: unknown,
  admissionsOpen: boolean,
): PublicSite {
  const site = resolveSite({ name: school.name, city: school.city, mode: school.mode, campuses, counts }, saved);
  // The school's own number is the fallback for the contact block.
  return { school, campuses, admissionsOpen, site };
}
