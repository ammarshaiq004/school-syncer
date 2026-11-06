"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EVENT_KINDS, longDate, monthGrid, monthName, parseDay, shortDate, type EventKind, type SiteConfig } from "@/lib/site";
import { Icon } from "./icons";

const modeKey = (slug: string) => `ss-mode:${slug}`;

function siteRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ss");
}

/**
 * Wires the page to the browser: scroll reveals, count-up numbers, the header
 * shrinking on scroll, the reading-progress bar and the current-section link.
 * It renders nothing; the page is complete HTML without it.
 */
export function SiteEffects({ slug, preview = false }: { slug: string; preview?: boolean }) {
  useEffect(() => {
    const root = siteRoot();
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.setAttribute("data-js", "1");
    if (preview) {
      // The editor's frame: show everything at once, including sections added while typing.
      const show = () => root.querySelectorAll("[data-reveal]:not([data-in])").forEach((el) => el.setAttribute("data-in", ""));
      show();
      const watch = new MutationObserver(show);
      watch.observe(root, { childList: true, subtree: true });
      return () => watch.disconnect();
    }
    try {
      const saved = localStorage.getItem(modeKey(slug));
      if (saved === "light" || saved === "dark") root.setAttribute("data-mode", saved);
    } catch {
      /* private mode: the school's default appearance stays */
    }

    const counters = Array.from(root.querySelectorAll<HTMLElement>("[data-count]"));
    if (!reduce) for (const el of counters) el.textContent = "0";
    const countUp = (el: HTMLElement) => {
      const target = Number(el.dataset.count);
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 1500);
        el.textContent = Math.round(target * (1 - (1 - t) ** 4)).toLocaleString("en-US");
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.setAttribute("data-in", "");
          if (el.dataset.count !== undefined && !reduce) countUp(el);
          io.unobserve(el);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    root.querySelectorAll("[data-reveal], [data-count]").forEach((el) => io.observe(el));

    const header = root.querySelector<HTMLElement>(".hdr");
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        root.style.setProperty("--p", max > 0 ? String(Math.min(1, window.scrollY / max)) : "0");
        header?.setAttribute("data-scrolled", window.scrollY > 24 ? "1" : "0");
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>(".nav a[href^='#']"));
    const spy = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          for (const a of links) a.setAttribute("aria-current", String(a.getAttribute("href") === `#${e.target.id}`));
        }
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    root.querySelectorAll("section[id]").forEach((s) => spy.observe(s));

    return () => {
      io.disconnect();
      spy.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [slug, preview]);
  return null;
}

/** Sticky header with the section links, light/dark switch and a full-screen menu on phones. */
export function SiteHeader({
  slug,
  brand,
  links,
  applyHref,
  menuLabel,
  children,
}: {
  slug: string;
  brand: ReactNode;
  links: { href: string; label: string }[];
  applyHref: string | null;
  menuLabel: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const toggleMode = useCallback(() => {
    const root = siteRoot();
    if (!root) return;
    const current = root.getAttribute("data-mode");
    const dark = current === "dark" || (current === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    root.setAttribute("data-mode", next);
    try {
      localStorage.setItem(modeKey(slug), next);
    } catch {
      /* not saved; fine */
    }
  }, [slug]);

  return (
    <>
    <header className="hdr" data-scrolled="0">
      <div className="wrap hdr-in">
        {brand}
        <nav className="nav" aria-label="Sections">
          {links.map((l) => (
            <a key={l.href} href={l.href}>{l.label}</a>
          ))}
        </nav>
        <div className="hdr-end">
          <button type="button" className="icon-btn mode-btn" onClick={toggleMode} aria-label="Switch between light and dark">
            <Icon name="moon" className="i-moon" size={22} />
            <Icon name="sun" className="i-sun" size={22} />
          </button>
          {applyHref && (
            <a className="btn sm apply" href={applyHref}>
              Apply online <Icon name="arrow" size={18} className="nudge" />
            </a>
          )}
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label={menuLabel} aria-expanded={open} aria-controls="ss-menu">
            <Icon name="menu" size={26} />
          </button>
        </div>
      </div>
    </header>
    {/* Outside the header: its blur would otherwise become the menu's containing block. */}
      <div id="ss-menu" className="mnav" data-open={open ? "1" : "0"} role="dialog" aria-modal="true" aria-label={menuLabel}>
        <button type="button" className="icon-btn mclose" onClick={() => setOpen(false)} aria-label="Close menu" tabIndex={open ? 0 : -1}>
          <Icon name="close" size={26} />
        </button>
        {links.map((l) => (
          <a key={l.href} className="l" href={l.href} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>{l.label}</a>
        ))}
        {applyHref && (
          <a className="btn" href={applyHref} tabIndex={open ? 0 : -1}>
            Apply online <Icon name="arrow" size={18} className="nudge" />
          </a>
        )}
        {children}
      </div>
    </>
  );
}

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const KIND_LABEL = Object.fromEntries(EVENT_KINDS.map((k) => [k.value, k.label])) as Record<EventKind, string>;
const pad = (n: number) => String(n).padStart(2, "0");

/** Month calendar of the school's events: days with events can be opened, the list shows the month. */
export function SiteCalendar({ events, today }: { events: SiteConfig["events"]; today: string }) {
  const first = useMemo(() => [...events].sort((a, b) => a.date.localeCompare(b.date)).find((e) => e.date >= today)?.date ?? today, [events, today]);
  const start = parseDay(first);
  const [cursor, setCursor] = useState({ y: start.y, m: start.m });
  const [picked, setPicked] = useState<string | null>(null);

  const prefix = `${cursor.y}-${pad(cursor.m + 1)}-`;
  const inMonth = events.filter((e) => e.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
  const byDay = new Map<number, typeof events>();
  for (const e of inMonth) byDay.set(parseDay(e.date).d, [...(byDay.get(parseDay(e.date).d) ?? []), e]);
  const shown = picked ? inMonth.filter((e) => e.date === picked) : inMonth;
  const kinds = [...new Set(inMonth.map((e) => e.kind))];
  const todayParts = parseDay(today);

  const move = (delta: number) => {
    const d = new Date(Date.UTC(cursor.y, cursor.m + delta, 1));
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    setPicked(null);
  };

  return (
    <div className="cal">
      <div className="cal-head">
        <h3 aria-live="polite">{monthName(cursor.m)} {cursor.y}</h3>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="Previous month"><Icon name="chevronLeft" size={20} /></button>
          <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="Next month"><Icon name="chevronRight" size={20} /></button>
        </div>
      </div>
      <div className="cal-grid" role="grid" aria-label={`${monthName(cursor.m)} ${cursor.y}`}>
        {DOW.map((d) => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {monthGrid(cursor.y, cursor.m).flat().map((day, i) => {
          if (!day) return <div key={i} role="gridcell" />;
          const evs = byDay.get(day);
          const iso = `${prefix}${pad(day)}`;
          const isToday = todayParts.y === cursor.y && todayParts.m === cursor.m && todayParts.d === day;
          if (!evs) return <div key={i} role="gridcell" className="cal-day" data-today={isToday ? "1" : undefined}>{day}</div>;
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              className="cal-day"
              data-has="1"
              data-today={isToday ? "1" : undefined}
              aria-selected={picked === iso}
              aria-label={`${longDate(iso)}: ${evs.map((e) => e.title).join(", ")}`}
              onClick={() => setPicked(picked === iso ? null : iso)}
            >
              {day}
              <i className={`kind-${evs[0].kind}`} />
            </button>
          );
        })}
      </div>
      {kinds.length > 0 && (
        <div className="legend" aria-hidden="true">
          {kinds.map((k) => <span key={k} className={`kind-${k}`}>{KIND_LABEL[k]}</span>)}
        </div>
      )}
      {shown.length > 0 ? (
        <ul className="evs">
          {shown.map((e, i) => (
            <li key={`${e.date}-${i}`}>
              <time dateTime={e.date}><small>{monthName(parseDay(e.date).m).slice(0, 3)}</small>{parseDay(e.date).d}</time>
              <div>
                <b>{e.title}</b>
                <span>{[KIND_LABEL[e.kind], e.time, e.place].filter(Boolean).join(" · ")}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="evs-empty">Nothing is scheduled in {monthName(cursor.m)}. {events.length > 0 && <>Try another month, such as {shortDate(first)}.</>}</p>
      )}
    </div>
  );
}
