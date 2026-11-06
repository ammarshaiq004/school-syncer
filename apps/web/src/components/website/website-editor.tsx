"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Eye, Globe, Image as ImageIcon, Laptop, MonitorSmartphone, Palette, Pencil, RotateCcw, Save, School, Smartphone, Tablet } from "lucide-react";
import {
  Alert, Button, Card, CardHeader, buttonClass, SegmentedControl, Switch, TabPanel, Tabs, TextareaField, TextField, useToast,
} from "@/components/ui";
import { PREVIEW_READY, PREVIEW_DRAFT } from "@/components/site/site-preview";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  EVENT_KINDS, GALLERY_ARTS, SITE_FONTS, SITE_ICONS,
  type PublicSite, type SiteConfig, type SiteEditorData, type SiteScene,
} from "@/lib/site";
import { contentToSave, draftProblems, PALETTES, resetSection, type SectionKey } from "@/lib/site-editor";
import { ChoiceCards, ColorField, LineListEditor, ListEditor, type FieldDef } from "./fields";

export interface SchoolFacts {
  name: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  locale: string;
  mode: "PHYSICAL" | "ONLINE" | "HYBRID";
}
export interface CampusFacts { name: string; address: string | null; phone: string | null }

const ICON_OPTIONS = SITE_ICONS.map((i) => ({ value: i, label: i[0].toUpperCase() + i.slice(1) }));

type Tab = "look" | "home" | "about" | "admissions" | "news" | "people" | "contact";
const SECTION_TOGGLES: { key: keyof SiteConfig["show"]; label: string }[] = [
  { key: "about", label: "About us" },
  { key: "programs", label: "Programmes" },
  { key: "admissions", label: "Admissions" },
  { key: "fees", label: "Fees" },
  { key: "news", label: "News" },
  { key: "calendar", label: "Calendar" },
  { key: "gallery", label: "Campus life" },
  { key: "faculty", label: "Teachers" },
  { key: "testimonials", label: "Family quotes" },
  { key: "faq", label: "Questions" },
];

export function WebsiteEditor({
  data,
  school,
  campuses,
  admissionsOpen,
  lockedReason,
  onSaved,
}: {
  data: SiteEditorData;
  school: SchoolFacts;
  campuses: CampusFacts[];
  admissionsOpen: boolean;
  /** Why editing is switched off, or null when the viewer can edit. */
  lockedReason: string | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const canEdit = lockedReason === null;
  const [draft, setDraft] = useState<SiteConfig>(data.config);
  const [saved, setSaved] = useState<Partial<SiteConfig>>(data.saved);
  const [touched, setTouched] = useState<Set<SectionKey>>(new Set());
  const [published, setPublished] = useState(data.published);
  const [publishedOnServer, setPublishedOnServer] = useState(data.published);
  const [tab, setTab] = useState<Tab>("look");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [dropped, setDropped] = useState(false);
  const dirty = touched.size > 0 || dropped || published !== publishedOnServer;
  const problems = draftProblems(draft);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Changes one section and remembers it was touched. */
  const edit = useCallback(<K extends SectionKey>(key: K, value: SiteConfig[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  }, []);
  const patch = <K extends "theme" | "show" | "hero" | "about" | "admissions" | "fees" | "contact" | "seo">(key: K, change: Partial<SiteConfig[K]>) =>
    edit(key, { ...draft[key], ...change });
  const reset = (key: SectionKey) => {
    const r = resetSection(key, draft, data.defaults, touched);
    setDraft(r.draft);
    setTouched(r.touched);
    // Drop the saved copy too, or the old choice comes back on save.
    setSaved((s) => {
      const next = { ...s };
      delete next[key];
      return next;
    });
    setDropped(true);
  };

  async function save() {
    if (problems.length) return setError(problems[0]);
    setBusy(true);
    setError("");
    try {
      const res = await api<{ published: boolean; saved: Partial<SiteConfig> }>("/school/site", {
        method: "PUT",
        body: { published, content: contentToSave(saved, draft, touched) },
      });
      setSaved(res.saved);
      setPublishedOnServer(res.published);
      setTouched(new Set());
      setDropped(false);
      toast.success(res.published ? "Website saved and live" : "Website saved", res.published ? "Visitors see the changes within a minute." : "It is not published yet, so visitors cannot see it.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const liveUrl = typeof window === "undefined" ? `/s/${data.slug}` : `${window.location.origin}/s/${data.slug}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.info("Copy this address", liveUrl);
    }
  }

  const payload: PublicSite = useMemo(
    () => ({
      school: { ...school, slug: data.slug, logoUrl: school.logoUrl ?? data.logoUrl },
      campuses,
      admissionsOpen,
      site: draft,
    }),
    [school, data.slug, data.logoUrl, campuses, admissionsOpen, draft],
  );

  const tabs = [
    { value: "look", label: "Look" },
    { value: "home", label: "Home" },
    { value: "about", label: "About" },
    { value: "admissions", label: "Admissions" },
    { value: "news", label: "News" },
    { value: "people", label: "People" },
    { value: "contact", label: "Contact" },
  ];

  const resetButton = (key: SectionKey, label = "Use suggested wording") => (
    <Button type="button" variant="ghost" size="sm" icon={<RotateCcw />} onClick={() => reset(key)} disabled={!canEdit}>{label}</Button>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* status and save */}
      <Card padding="md" className="sticky top-2 z-20 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", publishedOnServer ? "bg-success-tint text-success" : "bg-neutral-tint text-neutral-text")}>
            <Globe className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">{publishedOnServer ? "Your website is live" : "Your website is not published"}</p>
            <p className="truncate text-xs text-fg-muted">
              {publishedOnServer ? <code className="font-mono">{liveUrl.replace(/^https?:\/\//, "")}</code> : "Visitors cannot see it until you publish."}
            </p>
          </div>
        </div>
        <Switch checked={published} onCheckedChange={setPublished} disabled={!canEdit} label="Published" />
        <div className="flex flex-wrap items-center gap-2">
          {publishedOnServer && (
            <>
              <Button type="button" variant="secondary" size="sm" icon={copied ? <Check /> : <Copy />} onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
              <a className={buttonClass("secondary", "sm")} href={`/s/${data.slug}`} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open site</a>
            </>
          )}
          <SegmentedControl<"edit" | "preview">
            aria-label="Editor or preview"
            className="xl:hidden"
            value={view}
            onChange={setView}
            options={[{ value: "edit", label: "Edit", icon: <Pencil /> }, { value: "preview", label: "Preview", icon: <Eye /> }]}
          />
          {canEdit && <Button type="button" icon={<Save />} loading={busy} disabled={!dirty} onClick={save}>{dirty ? "Save changes" : "Saved"}</Button>}
        </div>
      </Card>
      {!canEdit && <Alert tone="info">{lockedReason}</Alert>}
      {error && <Alert tone="danger" onDismiss={() => setError("")}>{error}</Alert>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
        <div className={cn("min-w-0", view === "preview" && "hidden xl:block")}>
          <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as Tab)} aria-label="Website sections">
            {/* ---------------------------- look ---------------------------- */}
            <TabPanel value="look">
              <fieldset disabled={!canEdit} className="flex flex-col gap-5">
                <Card>
                  <CardHeader icon={<Palette />} title="Colours" description="Two colours drive the whole site. Text and buttons adjust themselves so they stay readable." />
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Colour pairs">
                      {PALETTES.map((p) => {
                        const on = p.primary === draft.theme.primary && p.accent === draft.theme.accent;
                        return (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => patch("theme", { primary: p.primary, accent: p.accent })}
                            aria-pressed={on}
                            className={cn("flex items-center gap-2 rounded-full border py-1 pe-3 ps-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring", on ? "border-primary bg-primary-tint text-fg" : "border-border bg-surface text-fg-secondary hover:border-border-strong")}
                          >
                            <span className="flex">
                              <span className="size-5 rounded-full border border-black/10" style={{ background: p.primary }} />
                              <span className="-ms-1.5 size-5 rounded-full border border-black/10" style={{ background: p.accent }} />
                            </span>
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <ColorField label="Main colour" value={draft.theme.primary} onChange={(primary) => patch("theme", { primary })} hint="Buttons, headings accents, the hero artwork" />
                      <ColorField label="Accent colour" value={draft.theme.accent} onChange={(accent) => patch("theme", { accent })} hint="Highlights, the sun, small details" />
                    </div>
                  </div>
                </Card>
                <Card>
                  <CardHeader icon={<ImageIcon />} title="Style" description="No photographs needed: the illustrations are drawn in your colours." />
                  <div className="flex flex-col gap-5">
                    <ChoiceCards
                      label="Hero illustration"
                      columns={2}
                      value={draft.theme.scene}
                      onChange={(scene: SiteScene) => patch("theme", { scene })}
                      options={[
                        { value: "campus", title: "School campus", text: "A school building with a clock tower, trees and children arriving.", visual: <School className="size-5 text-brand" /> },
                        { value: "learning", title: "Online classroom", text: "A live class on a laptop with books, a globe and a light bulb.", visual: <Laptop className="size-5 text-brand" /> },
                      ]}
                    />
                    <ChoiceCards
                      label="Fonts"
                      value={draft.theme.font}
                      onChange={(font) => patch("theme", { font })}
                      options={SITE_FONTS.map((f) => ({ value: f.value, title: f.label, text: f.sample }))}
                    />
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-fg-secondary">Corners</span>
                        <SegmentedControl aria-label="Corners" size="md" value={draft.theme.corners} onChange={(corners) => patch("theme", { corners })} options={[{ value: "soft", label: "Soft and round" }, { value: "sharp", label: "Sharp and formal" }]} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-fg-secondary">Appearance</span>
                        <SegmentedControl aria-label="Appearance" size="md" value={draft.theme.appearance} onChange={(appearance) => patch("theme", { appearance })} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "auto", label: "Follow visitor" }]} />
                        <span className="text-xs text-fg-muted">Visitors can always switch with the moon button.</span>
                      </div>
                    </div>
                  </div>
                </Card>
                <Card>
                  <CardHeader icon={<MonitorSmartphone />} title="Sections to show" description="Sections without content are hidden automatically. Switch one off to hide it even when it has content." />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {SECTION_TOGGLES.map((s) => (
                      <Switch key={s.key} checked={draft.show[s.key]} onCheckedChange={(on) => patch("show", { [s.key]: on })} label={s.label} />
                    ))}
                  </div>
                </Card>
              </fieldset>
            </TabPanel>

            {/* ---------------------------- home ---------------------------- */}
            <TabPanel value="home">
              <fieldset disabled={!canEdit} className="flex flex-col gap-5">
                <Card>
                  <CardHeader title="Home page opening" description="The first thing a parent reads. Say what makes the school different, in plain words." action={resetButton("hero")} />
                  <div className="grid gap-4">
                    <TextField label="Headline" maxLength={120} value={draft.hero.headline} onChange={(e) => patch("hero", { headline: e.target.value })} hint="The last word gets a hand-drawn underline" />
                    <TextareaField label="Short introduction" rows={3} maxLength={260} value={draft.hero.subheadline} onChange={(e) => patch("hero", { subheadline: e.target.value })} />
                    <TextField label="Tagline" maxLength={90} value={draft.hero.tagline} onChange={(e) => patch("hero", { tagline: e.target.value })} hint="Shown under the school name in the header and footer" />
                    <TextField label="Announcement bar" maxLength={90} value={draft.hero.notice} onChange={(e) => patch("hero", { notice: e.target.value })} hint="Optional. For example: Admissions open for 2027. Leave empty to hide." />
                  </div>
                </Card>
                <Card>
                  <CardHeader
                    title="Numbers"
                    description="Live counts of students and teachers are used until you write your own."
                    action={resetButton("stats", "Use live counts")}
                  />
                  <ListEditor
                    items={draft.stats}
                    onChange={(v) => edit("stats", v)}
                    max={4}
                    noun="number"
                    blank={{ value: 0, suffix: "+", label: "" }}
                    titleOf={(s) => `${s.value}${s.suffix} ${s.label}`}
                    fields={[
                      { key: "value", label: "Number", kind: "number" },
                      { key: "suffix", label: "After the number", max: 6, placeholder: "+" },
                      { key: "label", label: "Label", max: 40, placeholder: "Students", wide: true },
                    ] as FieldDef<SiteConfig["stats"][number]>[]}
                    empty="No numbers: this strip is hidden."
                  />
                </Card>
              </fieldset>
            </TabPanel>

            {/* ---------------------------- about --------------------------- */}
            <TabPanel value="about">
              <fieldset disabled={!canEdit} className="flex flex-col gap-5">
                <Card>
                  <CardHeader title="About the school" action={resetButton("about")} />
                  <div className="grid gap-4">
                    <TextField label="Heading" maxLength={80} value={draft.about.title} onChange={(e) => patch("about", { title: e.target.value })} />
                    <TextareaField label="Story" rows={6} maxLength={2400} value={draft.about.body} onChange={(e) => patch("about", { body: e.target.value })} hint="Leave a blank line between paragraphs" />
                    <TextField label="Motto" maxLength={80} value={draft.about.motto} onChange={(e) => patch("about", { motto: e.target.value })} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="What the school stands for" description="Up to four short values, each with a drawn icon." />
                  <ListEditor
                    items={draft.about.values}
                    onChange={(values) => patch("about", { values })}
                    max={4}
                    noun="value"
                    blank={{ title: "", text: "", icon: "star" as const }}
                    titleOf={(v) => v.title}
                    fields={[
                      { key: "title", label: "Title", max: 40 },
                      { key: "icon", label: "Icon", kind: "select", options: ICON_OPTIONS },
                      { key: "text", label: "One line", max: 200, wide: true },
                    ] as FieldDef<SiteConfig["about"]["values"][number]>[]}
                  />
                </Card>
                <Card>
                  <CardHeader title="Programmes" description="The stages or courses the school teaches." action={resetButton("programs")} />
                  <ListEditor
                    items={draft.programs}
                    onChange={(v) => edit("programs", v)}
                    max={6}
                    noun="programme"
                    blank={{ title: "", ages: "", text: "", icon: "book" as const }}
                    titleOf={(p) => p.title}
                    fields={[
                      { key: "title", label: "Name", max: 60 },
                      { key: "ages", label: "Ages or grades", max: 40, placeholder: "Grades 1 to 5" },
                      { key: "icon", label: "Icon", kind: "select", options: ICON_OPTIONS },
                      { key: "text", label: "Description", kind: "textarea", max: 300 },
                    ] as FieldDef<SiteConfig["programs"][number]>[]}
                  />
                </Card>
              </fieldset>
            </TabPanel>

            {/* -------------------------- admissions ------------------------ */}
            <TabPanel value="admissions">
              <fieldset disabled={!canEdit} className="flex flex-col gap-5">
                {!admissionsOpen && (
                  <Alert tone="warning" title="Online applications are off">
                    The Apply online button appears only while your plan includes admissions and the subscription is active. Until then visitors are asked to contact the office.
                  </Alert>
                )}
                <Card>
                  <CardHeader title="How admission works" description="Online applications go to Admissions in this portal." action={resetButton("admissions")} />
                  <div className="grid gap-4">
                    <TextareaField label="Introduction" rows={2} maxLength={400} value={draft.admissions.intro} onChange={(e) => patch("admissions", { intro: e.target.value })} />
                    <TextField label="Deadline or intake note" maxLength={100} value={draft.admissions.deadline} onChange={(e) => patch("admissions", { deadline: e.target.value })} hint="For example: Applications close on 30 November" />
                    <div className="flex flex-col gap-2">
                      <span className="text-[13px] font-medium text-fg-secondary">Steps</span>
                      <ListEditor
                        items={draft.admissions.steps}
                        onChange={(steps) => patch("admissions", { steps })}
                        max={5}
                        noun="step"
                        blank={{ title: "", text: "" }}
                        titleOf={(s) => s.title}
                        fields={[
                          { key: "title", label: "Step", max: 60 },
                          { key: "text", label: "What happens", max: 240, wide: true },
                        ] as FieldDef<SiteConfig["admissions"]["steps"][number]>[]}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-[13px] font-medium text-fg-secondary">What to bring</span>
                      <LineListEditor items={draft.admissions.requirements} onChange={(requirements) => patch("admissions", { requirements })} max={8} noun="document" />
                    </div>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Fees" description="Optional. A public fee schedule saves parents a phone call." />
                  <div className="grid gap-4">
                    <ListEditor
                      items={draft.fees.rows}
                      onChange={(rows) => patch("fees", { rows })}
                      max={8}
                      noun="fee"
                      blank={{ label: "", amount: 0, per: "/ month" }}
                      titleOf={(r) => r.label}
                      fields={[
                        { key: "label", label: "Fee", max: 60, placeholder: "Primary tuition" },
                        { key: "amount", label: "Amount in rupees", kind: "number" },
                        { key: "per", label: "Per", max: 30, placeholder: "/ month" },
                      ] as FieldDef<SiteConfig["fees"]["rows"][number]>[]}
                      empty="No fees listed: the fees section is hidden."
                    />
                    <TextareaField label="Note under the fees" rows={2} maxLength={300} value={draft.fees.note} onChange={(e) => patch("fees", { note: e.target.value })} />
                  </div>
                </Card>
              </fieldset>
            </TabPanel>

            {/* ----------------------------- news --------------------------- */}
            <TabPanel value="news">
              <fieldset disabled={!canEdit} className="flex flex-col gap-5">
                <Card>
                  <CardHeader title="News" description="The newest item is shown first and largest." />
                  <ListEditor
                    items={draft.news}
                    onChange={(v) => edit("news", v)}
                    max={6}
                    noun="news item"
                    blank={{ title: "", date: new Date().toISOString().slice(0, 10), text: "" }}
                    titleOf={(n) => n.title}
                    fields={[
                      { key: "title", label: "Headline", max: 100 },
                      { key: "date", label: "Date", kind: "date" },
                      { key: "text", label: "Short story", kind: "textarea", max: 400 },
                    ] as FieldDef<SiteConfig["news"][number]>[]}
                    empty="No news yet."
                  />
                </Card>
                <Card>
                  <CardHeader title="Calendar" description="Open days, exams, holidays and events. Past events stay on the calendar for the month they happened." />
                  <ListEditor
                    items={draft.events}
                    onChange={(v) => edit("events", v)}
                    max={16}
                    noun="event"
                    blank={{ title: "", date: new Date().toISOString().slice(0, 10), time: "", place: "", kind: "event" as const }}
                    titleOf={(e) => e.title}
                    fields={[
                      { key: "title", label: "Event", max: 80 },
                      { key: "date", label: "Date", kind: "date" },
                      { key: "kind", label: "Kind", kind: "select", options: EVENT_KINDS },
                      { key: "time", label: "Time", max: 30, placeholder: "10:00 am" },
                      { key: "place", label: "Place", max: 60, wide: true },
                    ] as FieldDef<SiteConfig["events"][number]>[]}
                    empty="No events yet."
                  />
                </Card>
              </fieldset>
            </TabPanel>

            {/* ---------------------------- people -------------------------- */}
            <TabPanel value="people">
              <fieldset disabled={!canEdit} className="flex flex-col gap-5">
                <Card>
                  <CardHeader title="Campus life" description="Drawn scenes with a caption. Pick the scene that fits each place." action={resetButton("gallery")} />
                  <ListEditor
                    items={draft.gallery}
                    onChange={(v) => edit("gallery", v)}
                    max={8}
                    noun="scene"
                    blank={{ caption: "", art: "science" as const }}
                    titleOf={(g) => g.caption}
                    fields={[
                      { key: "caption", label: "Caption", max: 60 },
                      { key: "art", label: "Scene", kind: "select", options: GALLERY_ARTS },
                    ] as FieldDef<SiteConfig["gallery"][number]>[]}
                  />
                </Card>
                <Card>
                  <CardHeader title="Teachers and leaders" description="Each person gets a friendly drawn portrait. No photographs are used." />
                  <ListEditor
                    items={draft.faculty}
                    onChange={(v) => edit("faculty", v)}
                    max={8}
                    noun="person"
                    blank={{ name: "", role: "", bio: "" }}
                    titleOf={(f) => f.name}
                    fields={[
                      { key: "name", label: "Name", max: 60 },
                      { key: "role", label: "Role", max: 60 },
                      { key: "bio", label: "One line about them", max: 200, wide: true },
                    ] as FieldDef<SiteConfig["faculty"][number]>[]}
                    empty="No teachers listed: this section is hidden."
                  />
                </Card>
                <Card>
                  <CardHeader title="What families say" description="Only add quotes you have permission to use." />
                  <ListEditor
                    items={draft.testimonials}
                    onChange={(v) => edit("testimonials", v)}
                    max={4}
                    noun="quote"
                    blank={{ quote: "", name: "", relation: "" }}
                    titleOf={(t) => t.name}
                    fields={[
                      { key: "quote", label: "Quote", kind: "textarea", max: 320 },
                      { key: "name", label: "Name", max: 60 },
                      { key: "relation", label: "Relation", max: 60, placeholder: "Mother of a Grade 3 student" },
                    ] as FieldDef<SiteConfig["testimonials"][number]>[]}
                    empty="No quotes: this section is hidden."
                  />
                </Card>
              </fieldset>
            </TabPanel>

            {/* --------------------------- contact -------------------------- */}
            <TabPanel value="contact">
              <fieldset disabled={!canEdit} className="flex flex-col gap-5">
                <Card>
                  <CardHeader title="Questions parents ask" action={resetButton("faq")} />
                  <ListEditor
                    items={draft.faq}
                    onChange={(v) => edit("faq", v)}
                    max={10}
                    noun="question"
                    blank={{ q: "", a: "" }}
                    titleOf={(f) => f.q}
                    fields={[
                      { key: "q", label: "Question", max: 140, wide: true },
                      { key: "a", label: "Answer", kind: "textarea", max: 600 },
                    ] as FieldDef<SiteConfig["faq"][number]>[]}
                  />
                </Card>
                <Card>
                  <CardHeader title="Contact details" description="The phone number and email come from System settings, School profile." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Address" maxLength={200} value={draft.contact.address} onChange={(e) => patch("contact", { address: e.target.value })} wrapperClassName="sm:col-span-2" />
                    <TextField label="Office hours" maxLength={100} value={draft.contact.hours} onChange={(e) => patch("contact", { hours: e.target.value })} />
                    <TextField label="WhatsApp number" maxLength={20} inputMode="tel" value={draft.contact.whatsapp} onChange={(e) => patch("contact", { whatsapp: e.target.value })} placeholder="0300 1234567" />
                    <TextField label="Facebook page" type="url" value={draft.contact.facebook ?? ""} onChange={(e) => patch("contact", { facebook: e.target.value })} placeholder="https://facebook.com/yourschool" />
                    <TextField label="Instagram" type="url" value={draft.contact.instagram ?? ""} onChange={(e) => patch("contact", { instagram: e.target.value })} placeholder="https://instagram.com/yourschool" />
                    <TextField label="YouTube" type="url" value={draft.contact.youtube ?? ""} onChange={(e) => patch("contact", { youtube: e.target.value })} placeholder="https://youtube.com/@yourschool" />
                    <TextField label="Other website" type="url" value={draft.contact.website ?? ""} onChange={(e) => patch("contact", { website: e.target.value })} placeholder="https://" />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Search engines" description="What Google shows when someone searches for the school." action={resetButton("seo")} />
                  <div className="grid gap-4">
                    <TextField label="Page title" maxLength={70} value={draft.seo.title} onChange={(e) => patch("seo", { title: e.target.value })} />
                    <TextareaField label="Description" rows={2} maxLength={160} value={draft.seo.description} onChange={(e) => patch("seo", { description: e.target.value })} hint={`${draft.seo.description.length} of 160 characters`} />
                  </div>
                </Card>
              </fieldset>
            </TabPanel>
          </Tabs>
        </div>

        <div className={cn("min-w-0 xl:sticky xl:top-24", view === "edit" && "hidden xl:block")}>
          <PreviewPane payload={payload} slug={data.slug} />
        </div>
      </div>
    </div>
  );
}

const DEVICES = { phone: 390, tablet: 820, desktop: 1280 } as const;
type Device = keyof typeof DEVICES;

/** The site in a frame, drawn from the unsaved draft, at phone, tablet or desktop width. */
function PreviewPane({ payload, slug }: { payload: PublicSite; slug: string }) {
  const [device, setDevice] = useState<Device>("phone");
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 640 });
  const latest = useRef(payload);

  const send = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: PREVIEW_DRAFT, data: latest.current }, window.location.origin);
  }, []);

  useEffect(() => {
    const onReady = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.source === frame.current?.contentWindow && e.data?.type === PREVIEW_READY) send();
    };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [send]);

  useEffect(() => {
    latest.current = payload;
    const t = setTimeout(send, 150);
    return () => clearTimeout(t);
  }, [payload, send]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const deviceWidth = DEVICES[device];
  const scale = size.w > 0 ? Math.min(1, size.w / deviceWidth) : 1;
  return (
    <Card padding="sm" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <p className="text-sm font-semibold text-fg">Live preview</p>
        <SegmentedControl<Device>
          aria-label="Preview size"
          value={device}
          onChange={setDevice}
          options={[
            { value: "phone", label: "Phone", icon: <Smartphone /> },
            { value: "tablet", label: "Tablet", icon: <Tablet /> },
            { value: "desktop", label: "Desktop", icon: <Laptop /> },
          ]}
        />
      </div>
      <div ref={box} className="relative h-[calc(100dvh-15rem)] min-h-[460px] overflow-hidden rounded-lg border border-border bg-surface-3">
        <iframe
          ref={frame}
          title="Website preview"
          src={`/site-preview/${slug}`}
          onLoad={send}
          className="absolute start-0 top-0 origin-top-left border-0 bg-white"
          style={{ width: deviceWidth, height: size.h / scale, transform: `scale(${scale})`, marginInlineStart: Math.max(0, (size.w - deviceWidth * scale) / 2) }}
        />
      </div>
      <p className="px-1 pb-1 text-xs text-fg-muted">Changes show here as you type. Nothing is public until you save and publish.</p>
    </Card>
  );
}
