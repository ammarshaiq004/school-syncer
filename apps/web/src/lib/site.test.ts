import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contrast, hash, initials, monthGrid, readable, siteStyles, siteTokens, splitLastWord, telLink, upcoming, whatsappLink,
} from "./site.ts";

describe("site colours", () => {
  it("keeps body text, brand text and button labels readable for any brand colour, light and dark", () => {
    for (const primary of ["#4f46e5", "#0f766e", "#facc15", "#be123c", "#111827", "#ffffff"]) {
      for (const dark of [false, true]) {
        const t = siteTokens(primary, "#f59e0b", dark);
        assert.ok(contrast(t.ink, t.paper) >= 7, `ink on paper ${primary} dark=${dark}`);
        assert.ok(contrast(t.ink2, t.paper) >= 4.5, `ink2 on paper ${primary} dark=${dark}`);
        assert.ok(contrast(t.bText, t.paper) >= 4.5, `brand text ${primary} dark=${dark}`);
        assert.ok(contrast(t.aText, t.paper) >= 4.5, `accent text ${primary} dark=${dark}`);
        assert.ok(contrast(t.onB, t.b) >= 4.5, `label on brand ${primary} dark=${dark}`);
        assert.ok(contrast(t.onA, t.a) >= 4.5, `label on accent ${primary} dark=${dark}`);
        assert.ok(contrast("#ffffff", t.foot) >= 7, `footer text ${primary} dark=${dark}`);
      }
    }
  });

  it("pulls an unreadable colour toward black or white only as far as needed", () => {
    assert.equal(readable("#000000", "#ffffff", 4.5), "#000000");
    assert.ok(contrast(readable("#ffee99", "#ffffff", 4.5), "#ffffff") >= 4.5);
  });

  it("writes light, dark and auto rules for the scope", () => {
    const css = siteStyles(".ss", "#4f46e5", "#f59e0b");
    assert.match(css, /^\.ss\{--paper:#/);
    assert.match(css, /\.ss\[data-mode="dark"\]\{/);
    assert.match(css, /prefers-color-scheme:dark\)\{\.ss\[data-mode="auto"\]/);
  });
});

describe("site text helpers", () => {
  it("makes initials without filler words", () => {
    assert.equal(initials("The Bright Future School"), "BF");
    assert.equal(initials("Al Noor Academy"), "AN");
    assert.equal(initials("School"), "S");
    assert.equal(initials("   "), "S");
  });

  it("hashes stably", () => {
    assert.equal(hash("Ayesha Khan"), hash("Ayesha Khan"));
    assert.notEqual(hash("Ayesha Khan"), hash("Bilal Ahmed"));
  });

  it("splits the last word of a headline", () => {
    assert.deepEqual(splitLastWord("Learn with joy"), ["Learn with", "joy"]);
    assert.deepEqual(splitLastWord("Joy"), ["", "Joy"]);
  });

  it("builds contact links", () => {
    assert.equal(whatsappLink("0300 1234567"), "https://wa.me/923001234567");
    assert.equal(whatsappLink("+92 300 1234567"), "https://wa.me/923001234567");
    assert.equal(whatsappLink("123"), null);
    assert.equal(telLink("+92 (42) 111-222"), "tel:+9242111222");
  });
});

describe("site calendar", () => {
  it("lays out a month Monday first", () => {
    const weeks = monthGrid(2026, 9); // October 2026 starts on a Thursday
    assert.deepEqual(weeks[0], [null, null, null, 1, 2, 3, 4]);
    assert.equal(weeks.at(-1)!.filter(Boolean).at(-1), 31);
    assert.ok(weeks.every((w) => w.length === 7));
  });

  it("lists upcoming events soonest first and drops past ones", () => {
    const events = [{ date: "2026-12-01" }, { date: "2026-10-01" }, { date: "2026-11-05" }];
    assert.deepEqual(upcoming(events, "2026-10-26").map((e) => e.date), ["2026-11-05", "2026-12-01"]);
  });
});
