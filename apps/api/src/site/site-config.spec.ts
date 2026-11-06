import { defaultSite, publicSite, resolveSite, roundedCount, siteInputSchema, type SiteSource } from './site-config.js';

const src: SiteSource = {
  name: 'Bright Future School',
  city: 'Lahore',
  mode: 'PHYSICAL',
  campuses: [{ name: 'Main', address: '12 Canal Road, Lahore' }],
  counts: { students: 1234, teachers: 57, campuses: 1 },
};

describe('roundedCount', () => {
  it('shows small numbers exactly and rounds bigger ones down to a round figure', () => {
    expect(roundedCount(7)).toBe(7);
    expect(roundedCount(48)).toBe(45);
    expect(roundedCount(437)).toBe(430);
    expect(roundedCount(1234)).toBe(1200);
  });
});

describe('defaultSite', () => {
  it('builds a complete site from the school record', () => {
    const site = defaultSite(src);
    expect(site.hero.headline).toContain('Bright Future School');
    expect(site.contact.address).toBe('12 Canal Road, Lahore');
    expect(site.stats).toEqual([
      { value: 1200, suffix: '+', label: 'Students' },
      { value: 55, suffix: '+', label: 'Teachers' },
    ]);
    expect(site.programs.length).toBeGreaterThan(0);
    expect(site.admissions.steps.length).toBeGreaterThan(0);
  });

  it('uses the learning scene for an online school and drops zero counts', () => {
    const site = defaultSite({ ...src, mode: 'ONLINE', city: null, counts: { students: 0, teachers: 3, campuses: 1 } });
    expect(site.theme.scene).toBe('learning');
    expect(site.stats).toEqual([{ value: 3, suffix: '', label: 'Teachers' }]);
    expect(site.hero.tagline).not.toContain('in null');
  });

  it('counts campuses only when there is more than one', () => {
    const site = defaultSite({ ...src, counts: { students: 10, teachers: 2, campuses: 3 } });
    expect(site.stats.map((s) => s.label)).toContain('Campuses');
  });
});

describe('resolveSite', () => {
  it('lays saved sections over the defaults and leaves the rest alone', () => {
    const site = resolveSite(src, {
      theme: { primary: '#0f766e' },
      hero: { headline: 'Learn with joy' },
      news: [{ title: 'Open day', date: '2026-11-01', text: 'Come and see.' }],
    });
    expect(site.theme.primary).toBe('#0f766e');
    expect(site.theme.accent).toBe('#f59e0b');
    expect(site.hero.headline).toBe('Learn with joy');
    expect(site.hero.subheadline).toBe(defaultSite(src).hero.subheadline);
    expect(site.news).toHaveLength(1);
    expect(site.faq).toEqual(defaultSite(src).faq);
  });

  it('lets a school empty a list on purpose', () => {
    expect(resolveSite(src, { gallery: [] }).gallery).toEqual([]);
  });

  it('falls back to the defaults when the stored row no longer validates', () => {
    expect(resolveSite(src, { theme: { primary: 'red' } })).toEqual(defaultSite(src));
    expect(resolveSite(src, null)).toEqual(defaultSite(src));
  });
});

describe('siteInputSchema', () => {
  it('accepts a partial save', () => {
    expect(siteInputSchema.safeParse({ hero: { tagline: 'Hi' } }).success).toBe(true);
  });

  it('rejects bad colours, unknown fonts, bad dates and non-web links', () => {
    expect(siteInputSchema.safeParse({ theme: { primary: '#abc' } }).success).toBe(false);
    expect(siteInputSchema.safeParse({ theme: { font: 'comic' } }).success).toBe(false);
    expect(siteInputSchema.safeParse({ events: [{ title: 'x', date: 'soon', time: '', place: '', kind: 'event' }] }).success).toBe(false);
    expect(siteInputSchema.safeParse({ contact: { facebook: 'javascript:alert(1)' } }).success).toBe(false);
  });

  it('treats a blank link as not set and caps list sizes', () => {
    const blank = siteInputSchema.parse({ contact: { facebook: '  ' } });
    expect(blank.contact?.facebook).toBeUndefined();
    const many = Array.from({ length: 11 }, () => ({ q: 'q', a: 'a' }));
    expect(siteInputSchema.safeParse({ faq: many }).success).toBe(false);
  });
});

describe('publicSite', () => {
  it('returns the school facts with the resolved site', () => {
    const school = { name: src.name, slug: 'bright', city: 'Lahore', phone: '042', email: null, logoUrl: null, locale: 'en', mode: 'PHYSICAL' as const };
    const view = publicSite(school, [{ name: 'Main', address: null, phone: null }], src.counts, { hero: { tagline: 'Hello' } }, true);
    expect(view.admissionsOpen).toBe(true);
    expect(view.site.hero.tagline).toBe('Hello');
    expect(view.school.slug).toBe('bright');
  });
});
