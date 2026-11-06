import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import {
  initials, longDate, monthName, parseDay, rupees, siteStyles, splitLastWord, telLink, upcoming, whatsappLink,
  type PublicSite,
} from "@/lib/site";
import { GalleryScene } from "./gallery-art";
import { CampusScene, Crest, LearningScene, Scribble } from "./hero-art";
import { Icon, type IconName } from "./icons";
import { Portrait } from "./portrait";
import { SiteCalendar, SiteEffects, SiteHeader } from "./site-client";
import "./site.css";

const d = (n: number) => ({ "--d": n }) as CSSProperties;

/** The school's own website: one long page of sections, complete HTML before any script runs. */
export function SitePage({ data, today, preview = false }: { data: PublicSite; today: string; preview?: boolean }) {
  const { school, site, campuses, admissionsOpen } = data;
  const { theme, show, hero, about, contact } = site;
  const slug = school.slug;
  const applyHref = admissionsOpen ? `/apply/${slug}` : null;
  const rtl = school.locale === "ur";
  const mark = initials(school.name);

  const events = site.events;
  const future = upcoming(events, today);
  const hasNews = show.news && site.news.length > 0;
  const hasCalendar = show.calendar && events.length > 0;
  const has = {
    about: show.about,
    programs: show.programs && site.programs.length > 0,
    admissions: show.admissions,
    fees: show.fees && site.fees.rows.length > 0,
    news: hasNews || hasCalendar,
    gallery: show.gallery && site.gallery.length > 0,
    faculty: show.faculty && site.faculty.length > 0,
    testimonials: show.testimonials && site.testimonials.length > 0,
    faq: show.faq && site.faq.length > 0,
  };
  const links = [
    has.about && { href: "#about", label: "About" },
    has.programs && { href: "#programs", label: "Programmes" },
    has.admissions && { href: "#admissions", label: "Admissions" },
    has.news && { href: "#news", label: "News" },
    has.gallery && { href: "#life", label: "Campus life" },
    has.faculty && { href: "#teachers", label: "Teachers" },
    { href: "#contact", label: "Contact" },
  ].filter(Boolean) as { href: string; label: string }[];
  const footLinks = [...links, has.fees && { href: "#fees", label: "Fees" }, has.faq && { href: "#faq", label: "Questions" }].filter(Boolean) as { href: string; label: string }[];

  const brand = (
    <a href="#top" className="brand" aria-label={`${school.name}, back to top`}>
      {school.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={school.logoUrl} alt="" width={44} height={44} />
      ) : (
        <Crest text={mark} />
      )}
      <span className="brand-t">
        <span className="brand-n">{school.name}</span>
        {hero.tagline && <span className="brand-s">{hero.tagline}</span>}
      </span>
    </a>
  );

  const words = hero.headline.trim().split(/\s+/).filter(Boolean);
  const [lead, lastWord] = splitLastWord(hero.headline);
  const leadWords = lead ? lead.split(/\s+/) : [];
  const address = contact.address || school.city || "";
  const phone = school.phone || campuses.find((c) => c.phone)?.phone || "";
  const wa = whatsappLink(contact.whatsapp);
  const mapHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${school.name} ${address}`)}` : null;
  const motifs = [...site.about.values.map((v) => v.title), ...site.programs.map((p) => p.title)];
  if (site.about.motto) motifs.unshift(site.about.motto);
  const social = [
    contact.facebook && { href: contact.facebook, icon: "facebook" as const, label: "Facebook" },
    contact.instagram && { href: contact.instagram, icon: "instagram" as const, label: "Instagram" },
    contact.youtube && { href: contact.youtube, icon: "youtube" as const, label: "YouTube" },
    contact.website && { href: contact.website, icon: "globe" as const, label: "Website" },
  ].filter(Boolean) as { href: string; icon: IconName; label: string }[];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "School",
    name: school.name,
    description: site.seo.description,
    ...(phone && { telephone: phone }),
    ...(school.email && { email: school.email }),
    ...(address && { address: { "@type": "PostalAddress", streetAddress: address, addressLocality: school.city ?? undefined, addressCountry: "PK" } }),
    ...(social.length && { sameAs: social.map((s) => s.href) }),
  };

  return (
    <div
      id="top"
      className="ss"
      data-mode={theme.appearance}
      data-font={theme.font}
      data-corners={theme.corners}
      lang={rtl ? "ur" : "en"}
      dir={rtl ? "rtl" : "ltr"}
      suppressHydrationWarning
    >
      <style dangerouslySetInnerHTML={{ __html: siteStyles(".ss", theme.primary, theme.accent) }} />
      {/* Client-rendered previews cannot run inline scripts; SiteEffects does the same work there. */}
      {!preview && (
        <>
          {/* Before first paint: switch the page into script mode and apply the visitor's saved light/dark choice. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){var r=document.currentScript.parentElement;r.setAttribute('data-js','1');try{var m=localStorage.getItem(${JSON.stringify(`ss-mode:${slug}`)});if(m==='light'||m==='dark')r.setAttribute('data-mode',m)}catch(e){}})()`,
            }}
          />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
        </>
      )}
      <a className="skip" href="#main">Skip to content</a>
      <div className="progress" aria-hidden="true" />
      <SiteEffects slug={slug} preview={preview} />

      {hero.notice && (
        <div className="notice">
          <div className="wrap">
            <span>{hero.notice}</span>
            {applyHref && <a href={applyHref}>Apply online</a>}
          </div>
        </div>
      )}

      <SiteHeader slug={slug} brand={brand} links={links} applyHref={applyHref} menuLabel="Open menu">
        {(phone || wa) && (
          <p style={{ marginTop: "1.5rem", color: "var(--ink-2)" }}>
            {phone && <a href={telLink(phone)}>{phone}</a>}
          </p>
        )}
      </SiteHeader>

      <main id="main">
        {/* ------------------------------ hero ------------------------------ */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap hero-grid">
            <div>
              <h1 id="hero-title">
                {leadWords.map((w, i) => (
                  <span key={i}>
                    <span className="w"><span style={{ "--i": i } as CSSProperties}>{w}</span></span>{" "}
                  </span>
                ))}
                <span className="w last"><span style={{ "--i": leadWords.length } as CSSProperties}><Scribble>{lastWord || words[0]}</Scribble></span></span>
              </h1>
              {hero.subheadline && <p className="lede">{hero.subheadline}</p>}
              <div className="hero-cta">
                {applyHref ? (
                  <a className="btn" href={applyHref}>Apply online <Icon name="arrow" size={20} className="nudge" /></a>
                ) : (
                  <a className="btn" href="#contact">Contact the school <Icon name="arrow" size={20} className="nudge" /></a>
                )}
                {has.programs ? (
                  <a className="btn ghost" href="#programs">Explore programmes</a>
                ) : (
                  <a className="btn ghost" href="#about">About the school</a>
                )}
              </div>
              {site.admissions.deadline && (
                <p className="hero-note"><Icon name="calendar" size={20} /> {site.admissions.deadline}</p>
              )}
            </div>
            <div className="scene-wrap">{theme.scene === "learning" ? <LearningScene /> : <CampusScene />}</div>
          </div>
        </section>

        {motifs.length > 0 && (
          <div className="band" aria-hidden="true">
            <div className="track">
              {[0, 1].map((n) => (
                <div className="item" key={n} aria-hidden={n === 1 ? "true" : undefined}>
                  {Array.from({ length: Math.max(1, Math.ceil(10 / motifs.length)) }, () => motifs).flat().map((t, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "2.5rem" }}>
                      {t}
                      <svg viewBox="-8 -8 16 16"><path d="M0-7C1-2 2-1 7 0 2 1 1 2 0 7-1 2-2 1-7 0-2-1-1-2 0-7z" /></svg>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------ stats ----------------------------- */}
        {site.stats.length > 0 && (
          <section className="sec" aria-label="The school in numbers" style={{ paddingBlock: "clamp(3rem,6vw,5rem) 0" }}>
            <div className="wrap stats" style={{ "--n": site.stats.length } as CSSProperties}>
              {site.stats.map((s, i) => (
                <div className="stat" key={s.label} data-reveal="pop" style={d(i)}>
                  <div className="stat-n"><span data-count={s.value}>{s.value.toLocaleString("en-US")}</span>{s.suffix}</div>
                  <p className="stat-l">{s.label}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ------------------------------ about ----------------------------- */}
        {has.about && (
          <section className="sec" id="about" aria-labelledby="about-h">
            <div className="wrap about-grid">
              <div data-reveal="left">
                <h2 className="h2" id="about-h">{about.title}</h2>
                <div className="about-body">
                  {about.body.split(/\n\s*\n/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
                </div>
                {about.motto && (
                  <p className="motto"><Icon name="quote" /> {about.motto}</p>
                )}
              </div>
              {about.values.length > 0 && (
                <ul className="values">
                  {about.values.map((v, i) => (
                    <li className="value" key={v.title} data-reveal="up" style={d(i)}>
                      <span className="value-i"><Icon name={v.icon} size={28} /></span>
                      <h3>{v.title}</h3>
                      <p>{v.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* ---------------------------- programmes -------------------------- */}
        {has.programs && (
          <section className="sec alt" id="programs" aria-labelledby="prog-h">
            <div className="wrap">
              <div className="sec-head" data-reveal="up">
                <h2 id="prog-h">Programmes for every stage</h2>
                <p>From a child’s first day to the last exam, each stage has teachers and a plan built for it.</p>
              </div>
              <ul className="prog">
                {site.programs.map((p, i) => (
                  <li className="prog-row" key={p.title} data-reveal={i % 2 ? "right" : "left"} style={d(i % 3)}>
                    <span className="prog-i"><Icon name={p.icon} /></span>
                    <h3>{p.title} {p.ages && <span className="age">{p.ages}</span>}</h3>
                    <p>{p.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ---------------------------- admissions -------------------------- */}
        {has.admissions && (
          <section className="sec" id="admissions" aria-labelledby="adm-h">
            <div className="wrap">
              <div className="sec-head" data-reveal="up">
                <h2 id="adm-h">{admissionsOpen ? "Joining us is simple" : "How admission works"}</h2>
                {site.admissions.intro && <p>{site.admissions.intro}</p>}
              </div>
              {site.admissions.steps.length > 0 && <Road steps={site.admissions.steps} />}
              <div className="adm-aside" style={site.admissions.requirements.length === 0 ? { gridTemplateColumns: "1fr" } : undefined}>
                {site.admissions.requirements.length > 0 && (
                  <div className="panel" data-reveal="up">
                    <h3>What to bring</h3>
                    <ul className="ticks" data-reveal="none">
                      {site.admissions.requirements.map((r, i) => (
                        <li key={r} style={d(i)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 12.5l4.7 4.7L19.5 7" pathLength="1" /></svg>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="panel cta" data-reveal="up" style={d(1)}>
                  <svg className="art" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M3 12l18-8-6 17-3-7z" strokeLinejoin="round" /><path d="M12 14l9-10" /></svg>
                  <h3>{admissionsOpen ? "Ready to apply?" : "Talk to the admissions office"}</h3>
                  {site.admissions.deadline && <span className="deadline"><Icon name="calendar" size={18} /> {site.admissions.deadline}</span>}
                  <p>{admissionsOpen ? "The form takes about two minutes. We reply within two working days." : "Online applications are not open right now. Call or message the office and we will help."}</p>
                  {applyHref ? (
                    <a className="btn onb" href={applyHref}>Apply online <Icon name="arrow" size={20} className="nudge" /></a>
                  ) : (
                    <a className="btn onb" href="#contact">Contact the office <Icon name="arrow" size={20} className="nudge" /></a>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ------------------------------- fees ----------------------------- */}
        {has.fees && (
          <section className="sec alt" id="fees" aria-labelledby="fees-h">
            <div className="wrap fees-grid">
              <div data-reveal="left">
                <div className="sec-head" style={{ marginBottom: 0 }}>
                  <h2 id="fees-h">Fees, laid out plainly</h2>
                  <p>What you will pay, so there are no surprises at the fee counter.</p>
                </div>
              </div>
              <div className="ticket" data-reveal="pop">
                <h3>Fee schedule</h3>
                <dl>
                  {site.fees.rows.map((r) => (
                    <div className="fee" key={r.label}>
                      <dt>{r.label}</dt>
                      <span className="dots" aria-hidden="true" />
                      <dd>{rupees(r.amount)}{r.per && <small>{r.per}</small>}</dd>
                    </div>
                  ))}
                </dl>
                {site.fees.note && <p className="note">{site.fees.note}</p>}
              </div>
            </div>
          </section>
        )}

        {/* ------------------------------- news ----------------------------- */}
        {has.news && (
          <section className="sec" id="news" aria-labelledby="news-h">
            <div className="wrap">
              <div className="sec-head" data-reveal="up">
                <h2 id="news-h">{hasNews && hasCalendar ? "News and what’s coming up" : hasNews ? "News from school" : "School calendar"}</h2>
              </div>
              <div className={`news-grid ${hasNews && hasCalendar ? "both" : ""}`}>
                {hasNews && (
                  <div data-reveal="left">
                    {(() => {
                      const [first, ...rest] = [...site.news].sort((a, b) => b.date.localeCompare(a.date));
                      const f = parseDay(first.date);
                      return (
                        <>
                          <article className="news-feature">
                            <span className="datestamp" aria-label={longDate(first.date)}><b>{f.d}</b><span>{monthName(f.m).slice(0, 3)}</span></span>
                            <h3>{first.title}</h3>
                            <p>{first.text}</p>
                          </article>
                          {rest.length > 0 && (
                            <ul className="news-list">
                              {rest.map((n) => {
                                const p = parseDay(n.date);
                                return (
                                  <li key={n.title + n.date}>
                                    <span className="datestamp" aria-label={longDate(n.date)}><b>{p.d}</b><span>{monthName(p.m).slice(0, 3)}</span></span>
                                    <article><h3>{n.title}</h3><p>{n.text}</p></article>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
                {hasCalendar && (
                  <div data-reveal="right">
                    <SiteCalendar events={events} today={future[0]?.date ?? today} />
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ----------------------------- gallery ---------------------------- */}
        {has.gallery && (
          <section className="sec alt" id="life" aria-labelledby="life-h">
            <div className="wrap">
              <div className="sec-head" data-reveal="up">
                <h2 id="life-h">A day on campus</h2>
                <p>Classrooms, labs, the playground and the garden: the places where a school day happens.</p>
              </div>
              <div className="gal" data-four={site.gallery.length % 4 === 0 ? "" : undefined}>
                {site.gallery.map((g, i) => (
                  <figure className="tile" key={g.caption + i} data-reveal="clip" style={d(i % 4)}>
                    <GalleryScene art={g.art} label={g.caption} />
                    <figcaption>{g.caption}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ----------------------------- faculty ---------------------------- */}
        {has.faculty && (
          <section className="sec" id="teachers" aria-labelledby="fac-h">
            <div className="wrap fac-pad">
              <div className="sec-head" data-reveal="up">
                <h2 id="fac-h">The people who teach your child</h2>
              </div>
              <ul className="fac">
                {site.faculty.map((f, i) => (
                  <li className="person" key={f.name} data-reveal="up" style={d(i % 4)}>
                    <div className="arch"><Portrait name={f.name} /></div>
                    <h3>{f.name}</h3>
                    <p className="role">{f.role}</p>
                    {f.bio && <p>{f.bio}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* --------------------------- testimonials ------------------------- */}
        {has.testimonials && (
          <section className="sec alt" aria-labelledby="quotes-h">
            <div className="wrap">
              <div className="sec-head" data-reveal="up">
                <h2 id="quotes-h">What families say</h2>
              </div>
              <div className="quotes">
                {site.testimonials.map((t, i) => (
                  <figure className="quote" key={t.name + i} data-reveal="pop" style={{ ...d(i), margin: 0 }}>
                    <Icon name="quote" className="qi" size={40} />
                    <blockquote>{t.quote}</blockquote>
                    <figcaption className="who">
                      <span className="av"><Portrait name={t.name} /></span>
                      <span><b>{t.name}</b><span>{t.relation}</span></span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* -------------------------------- faq ----------------------------- */}
        {has.faq && (
          <section className="sec" id="faq" aria-labelledby="faq-h">
            <div className="wrap faq-grid">
              <div className="faq-side" data-reveal="left">
                <h2 className="h2" id="faq-h">Questions parents ask</h2>
                <p style={{ marginTop: "1rem", color: "var(--ink-2)" }}>Can’t find yours? <a className="link" href="#contact">Ask the office</a>.</p>
                <svg className="bubble" viewBox="0 0 280 200" aria-hidden="true" focusable="false">
                  <g className="bob"><path d="M30 30h170a18 18 0 0 1 18 18v66a18 18 0 0 1-18 18h-90l-34 30v-30H30a18 18 0 0 1-18-18V48a18 18 0 0 1 18-18z" className="f-bs s-ink" strokeWidth="3.500" strokeLinejoin="round" />
                    <path d="M94 74c0-14 12-20 24-20s24 8 24 20c0 18-22 16-22 34" className="s-b nf" strokeWidth="9" strokeLinecap="round" /><circle cx="120" cy="124" r="6" className="f-b" /></g>
                  <g className="bob slow"><circle cx="236" cy="52" r="26" className="f-a s-ink" strokeWidth="3.500" /><path d="M226 52l7 7 13-14" className="s-ink nf" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>
                </svg>
              </div>
              <div data-reveal="right">
                {site.faq.map((f) => (
                  <details className="q" key={f.q}>
                    <summary>{f.q}<span className="pm"><Icon name="plus" size={20} /></span></summary>
                    <div className="ans">{f.a}</div>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ------------------------------ closing --------------------------- */}
        <section className="sec" style={{ paddingBlock: "clamp(2rem,4vw,3rem) clamp(3rem,6vw,5rem)" }} aria-labelledby="close-h">
          <div className="wrap">
            <div className="close" data-reveal="pop">
              <span className="dots" aria-hidden="true" />
              <div>
                <h2 id="close-h">{admissionsOpen ? `Come and see ${school.name} for yourself` : `Visit ${school.name}`}</h2>
                <p>Meet the teachers, walk the classrooms and ask anything. We would love to show you around.</p>
                <div className="hero-cta">
                  {applyHref ? <a className="btn onb" href={applyHref}>Apply online <Icon name="arrow" size={20} className="nudge" /></a> : <a className="btn onb" href="#contact">Get in touch <Icon name="arrow" size={20} className="nudge" /></a>}
                  {phone && <a className="btn ghost" href={telLink(phone)}><Icon name="phone" size={20} /> {phone}</a>}
                </div>
              </div>
              <svg className="art" viewBox="0 0 320 240" aria-hidden="true" focusable="false">
                <circle cx="160" cy="130" r="104" fill="currentColor" opacity=".12" />
                <g className="plane" style={{ animationDuration: "9s" }}><path d="M0 0l60-20-18 48-10-18z M32 10l28-30" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" /></g>
                <g className="bob"><rect x="96" y="104" width="128" height="96" rx="10" fill="var(--card)" stroke="var(--ink)" strokeWidth="4" /><path d="M96 114l64 48 64-48" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" /><circle cx="160" cy="162" r="14" fill="var(--a)" stroke="var(--ink)" strokeWidth="3" /><path d="M153 162l5 5 9-10" fill="none" stroke="var(--ink)" strokeWidth="3.500" strokeLinecap="round" strokeLinejoin="round" /></g>
              </svg>
            </div>
          </div>
        </section>

        {/* ------------------------------ contact --------------------------- */}
        <section className="sec alt" id="contact" aria-labelledby="contact-h">
          <div className="wrap contact-grid">
            <div data-reveal="left">
              <h2 className="h2" id="contact-h">Find us, call us, write to us</h2>
              <ul className="ways">
                {address && <li><a className={mapHref ? "way" : "way"} href={mapHref ?? undefined}><span className="way-i"><Icon name="pin" /></span><span><b>Address</b><span>{address}</span></span></a></li>}
                {phone && <li><a className="way" href={telLink(phone)}><span className="way-i"><Icon name="phone" /></span><span><b>Phone</b><span>{phone}</span></span></a></li>}
                {wa && <li><a className="way" href={wa} rel="noopener noreferrer" target="_blank"><span className="way-i"><Icon name="whatsapp" /></span><span><b>WhatsApp</b><span>{contact.whatsapp}</span></span></a></li>}
                {school.email && <li><a className="way" href={`mailto:${school.email}`}><span className="way-i"><Icon name="mail" /></span><span><b>Email</b><span>{school.email}</span></span></a></li>}
                {contact.hours && <li><div className="way"><span className="way-i"><Icon name="clock" /></span><span><b>Office hours</b><span>{contact.hours}</span></span></div></li>}
              </ul>
              {campuses.length > 1 && (
                <ul className="campuses" aria-label="Campuses">
                  {campuses.map((c) => (
                    <li key={c.name}><b>{c.name}</b>{(c.address || c.phone) && <span>{[c.address, c.phone].filter(Boolean).join(" · ")}</span>}</li>
                  ))}
                </ul>
              )}
              {social.length > 0 && (
                <div className="social">
                  {social.map((s) => (
                    <a key={s.label} href={s.href} aria-label={s.label} rel="noopener noreferrer" target="_blank"><Icon name={s.icon} size={22} /></a>
                  ))}
                </div>
              )}
            </div>
            <div className="mapbox" data-reveal="right" role="img" aria-label="Illustrated map showing the school’s location">
              <MapArt />
              {mapHref && <a className="btn sm" href={mapHref} rel="noopener noreferrer" target="_blank">Open in Maps <Icon name="arrow" size={18} className="nudge" /></a>}
            </div>
          </div>
        </section>
      </main>

      {/* ------------------------------- footer ------------------------------ */}
      <footer className="foot">
        <Skyline />
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <div className="brand">
                {school.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={school.logoUrl} alt="" width={44} height={44} style={{ background: "#fff", padding: 3 }} />
                ) : <Crest text={mark} />}
                <span className="brand-t"><span className="brand-n">{school.name}</span>{hero.tagline && <span className="brand-s">{hero.tagline}</span>}</span>
              </div>
              {site.seo.description && <p style={{ marginTop: "1.2rem", maxWidth: "26rem", color: "rgb(255 255 255 / 0.82)" }}>{site.seo.description}</p>}
              {applyHref && <a className="btn alt" href={applyHref}>Apply online <Icon name="arrow" size={20} className="nudge" /></a>}
            </div>
            <nav aria-label="Footer">
              <h3>Explore</h3>
              <ul>{footLinks.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul>
            </nav>
            <div>
              <h3>For families</h3>
              <ul>
                <li><a href="/login">Parent and student sign in</a></li>
                {applyHref && <li><a href={applyHref}>Admission enquiry</a></li>}
                {phone && <li><a href={telLink(phone)}>{phone}</a></li>}
                {school.email && <li><a href={`mailto:${school.email}`}>{school.email}</a></li>}
              </ul>
            </div>
          </div>
          <div className="foot-bar">
            <span>© {new Date().getFullYear()} {school.name}</span>
            <span>Website by <Link href="/">SchoolSyncer</Link></span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** The admissions steps along a winding road (wide screens) or as a stack (phones). */
function Road({ steps }: { steps: { title: string; text: string }[] }) {
  const n = steps.length;
  const y = (i: number) => ((i + 0.5) / n) * 100;
  const x = (i: number) => (i % 2 ? 76 : 24);
  const k = (50 / n) * 0.9;
  let path = `M ${x(0)} ${y(0)}`;
  for (let i = 1; i < n; i++) path += ` C ${x(i - 1)} ${y(i - 1) + k}, ${x(i)} ${y(i) - k}, ${x(i)} ${y(i)}`;
  return (
    <div className="road" data-reveal="none">
      {n > 1 && (
        <svg className="road-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path className="bed" d={path} />
          <path className="dash" d={path} />
        </svg>
      )}
      <ol className="steps">
        {steps.map((s, i) => (
          <li className="step" key={s.title} data-reveal={i % 2 ? "right" : "left"} style={d(i)}>
            <span className="step-n" aria-hidden="true">{i + 1}</span>
            <div><h3>{s.title}</h3><p>{s.text}</p></div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Hand-drawn street map with a bouncing pin: a stand-in for an embedded map. */
function MapArt(): ReactNode {
  return (
    <svg viewBox="0 0 640 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="640" height="420" className="m-block" opacity=".4" />
      {[[20, 20, 130, 90], [170, 20, 100, 90], [300, 20, 140, 90], [470, 20, 150, 90], [20, 140, 110, 80], [150, 140, 120, 80], [470, 140, 70, 80], [560, 140, 60, 80], [20, 250, 130, 70], [170, 250, 100, 70], [300, 250, 90, 70], [420, 250, 110, 70], [560, 250, 60, 70], [20, 350, 160, 50], [210, 350, 110, 50], [350, 350, 150, 50], [530, 350, 90, 50]].map(([x, yy, w, h], i) => (
        <rect key={i} x={x} y={yy} width={w} height={h} rx="10" className="m-block" />
      ))}
      <rect x="300" y="140" width="150" height="80" rx="14" className="m-park" />
      {[[330, 170], [360, 190], [395, 168], [425, 192], [345, 205]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="11" className="f-leaf" />)}
      <path d="M-20 330C120 290 200 380 330 330S520 270 680 320" className="m-river" strokeWidth="30" />
      <path d="M-20 330C120 290 200 380 330 330S520 270 680 320" fill="none" stroke="var(--card)" strokeWidth="2" strokeDasharray="2 12" strokeLinecap="round" opacity=".7" />
      {["M0 125H640", "M0 235H640", "M155 0V420", "M285 0V420", "M455 0V420", "M545 0V420"].map((p, i) => <path key={i} d={p} className="m-road" strokeWidth={i < 2 ? 14 : 10} />)}
      <path d="M0 40L640 380" className="m-road" strokeWidth="12" opacity=".0" />
      <g transform="translate(370 190)">
        <circle className="pinring s-a nf" r="34" strokeWidth="4" />
        <ellipse cx="0" cy="2" rx="14" ry="5" className="f-shadow" />
        <g className="pin">
          <path d="M0 0C-26-30-34-46-34-62a34 34 0 0 1 68 0C34-46 26-30 0 0z" className="f-a s-ink" strokeWidth="4" strokeLinejoin="round" />
          <path d="M-14-66l14-12 14 12v14h-28z" className="f-card" />
          <path d="M-4-52v-9h8v9" className="s-ink nf" strokeWidth="3" />
        </g>
      </g>
    </svg>
  );
}

/** A row of rooftops, domes and trees along the footer's top edge. */
function Skyline() {
  const parts: { w: number; h: number; kind: "box" | "tri" | "dome" | "tree" }[] = [
    { w: 70, h: 14, kind: "box" }, { w: 50, h: 30, kind: "tri" }, { w: 90, h: 18, kind: "box" }, { w: 40, h: 24, kind: "tree" },
    { w: 80, h: 26, kind: "dome" }, { w: 60, h: 12, kind: "box" }, { w: 54, h: 34, kind: "tri" }, { w: 36, h: 22, kind: "tree" },
  ];
  let xPos = 0;
  let dPath = "M0 40";
  let i = 0;
  while (xPos < 1440) {
    const p = parts[i++ % parts.length];
    const base = 40;
    const top = base - p.h;
    if (p.kind === "box") dPath += ` L${xPos} ${top} H${xPos + p.w}`;
    else if (p.kind === "tri") dPath += ` L${xPos} ${top + 10} L${xPos + p.w / 2} ${top - 2} L${xPos + p.w} ${top + 10}`;
    else if (p.kind === "dome") dPath += ` L${xPos} ${top + 8} Q${xPos + p.w / 2} ${top - 14} ${xPos + p.w} ${top + 8}`;
    else dPath += ` L${xPos} ${top + 14} Q${xPos + p.w / 2} ${top - 12} ${xPos + p.w} ${top + 14}`;
    dPath += ` L${xPos + p.w} ${base}`;
    xPos += p.w;
  }
  dPath += " V40z";
  return (
    <svg className="skyline" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={dPath} />
    </svg>
  );
}
