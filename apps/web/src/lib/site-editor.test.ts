import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentToSave, draftProblems, resetSection, type SectionKey } from "./site-editor.ts";
import type { SiteConfig } from "./site.ts";

const base = {
  theme: { primary: "#4f46e5", accent: "#f59e0b", font: "editorial", scene: "campus", corners: "soft", appearance: "light" },
  hero: { tagline: "T", headline: "Hello", subheadline: "", notice: "" },
  stats: [{ value: 480, suffix: "+", label: "Students" }],
  events: [],
  news: [],
} as unknown as SiteConfig;

describe("website editor", () => {
  it("saves only the sections the school touched, on top of what was saved", () => {
    const draft = { ...base, hero: { ...base.hero, headline: "New" } } as SiteConfig;
    const out = contentToSave({ theme: base.theme }, draft, new Set<SectionKey>(["hero"]));
    assert.deepEqual(Object.keys(out).sort(), ["hero", "theme"]);
    assert.equal(out.hero?.headline, "New");
    assert.ok(!("stats" in out), "untouched live counts stay out of the saved content");
  });

  it("resets a section to the defaults and forgets it was touched", () => {
    const defaults = { ...base, stats: [{ value: 500, suffix: "+", label: "Students" }] } as SiteConfig;
    const draft = { ...base, stats: [{ value: 1, suffix: "", label: "x" }] } as SiteConfig;
    const r = resetSection("stats", draft, defaults, new Set<SectionKey>(["stats", "hero"]));
    assert.equal(r.draft.stats[0].value, 500);
    assert.deepEqual([...r.touched], ["hero"]);
  });

  it("lists what blocks saving", () => {
    assert.deepEqual(draftProblems(base), []);
    const bad = {
      ...base,
      theme: { ...base.theme, primary: "blue" },
      hero: { ...base.hero, headline: " " },
      events: [{ title: "Sports day", date: "", time: "", place: "", kind: "event" }],
    } as SiteConfig;
    assert.equal(draftProblems(bad).length, 3);
  });
});
