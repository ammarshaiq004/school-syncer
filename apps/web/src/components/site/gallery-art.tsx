import type { ReactNode } from "react";
import type { GalleryArt } from "@/lib/site";

/** Eight "life at school" scenes, hand-drawn at 320x240 in the site's colours. */

const Frame = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <>
    <rect width="320" height="240" className={tone} />
    <path d="M0 196C60 184 120 204 190 194S280 184 320 194V240H0z" className="f-leaf" opacity=".55" />
    {children}
  </>
);

const S = { strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

const SCENES: Record<GalleryArt, ReactNode> = {
  science: (
    <Frame tone="f-bs">
      <rect x="30" y="176" width="260" height="14" rx="4" className="f-bd s-ink" {...S} />
      <path d="M118 66h30v50l36 62a8 8 0 0 1-7 12H89a8 8 0 0 1-7-12l36-62z" className="f-card s-ink" {...S} />
      <path d="M104 148h58l22 30a8 8 0 0 1-7 12H89a8 8 0 0 1-7-12z" className="f-a" />
      <path d="M104 148h58" className="s-ink nf" strokeWidth="2.500" strokeLinecap="round" />
      <path d="M112 62h42" className="s-ink nf" strokeWidth="5" strokeLinecap="round" />
      <g className="bubbles">
        <circle cx="128" cy="140" r="5" className="f-card s-ink" strokeWidth="2.500" />
        <circle cx="142" cy="130" r="3.500" className="f-card s-ink" strokeWidth="2.500" />
        <circle cx="134" cy="118" r="3" className="f-card s-ink" strokeWidth="2.500" />
      </g>
      <path d="M208 190v-54h40v54z" className="f-card s-ink" {...S} />
      <path d="M208 166h40v24h-40z" className="f-b" /><path d="M208 136v54h40v-54z" className="s-ink nf" {...S} />
      <path d="M204 136h48" className="s-ink nf" strokeWidth="4" strokeLinecap="round" />
      <path d="M62 190V118M82 190v-62" className="s-ink nf" strokeWidth="0" />
      <g transform="translate(62 190)"><rect x="-10" y="-76" width="14" height="76" rx="7" className="f-card s-ink" {...S} /><rect x="-10" y="-30" width="14" height="30" rx="7" className="f-leaf" /><rect x="-10" y="-76" width="14" height="76" rx="7" className="s-ink nf" {...S} /></g>
      <g transform="translate(246 82)"><g className="orbit">
        <ellipse rx="24" ry="8" className="s-a nf" strokeWidth="3" /><ellipse rx="24" ry="8" transform="rotate(60)" className="s-a nf" strokeWidth="3" /><ellipse rx="24" ry="8" transform="rotate(120)" className="s-a nf" strokeWidth="3" />
      </g><circle r="5" className="f-ink" /></g>
    </Frame>
  ),
  library: (
    <Frame tone="f-as">
      <rect x="28" y="30" width="264" height="140" rx="8" className="f-bd s-ink" {...S} />
      {[0, 1].map((r) => (
        <g key={r} transform={`translate(0 ${r * 62})`}>
          <rect x="40" y="76" width="240" height="6" className="f-ink" />
          {[[44, 28, "f-a"], [60, 36, "f-card"], [76, 30, "f-b"], [92, 38, "f-leaf"], [108, 28, "f-card"], [124, 34, "f-a"], [140, 40, "f-b"], [158, 30, "f-card"], [174, 36, "f-leaf"]].map(([x, h, c], i) => (
            <rect key={i} x={x as number} y={76 - (h as number)} width="14" height={h as number} rx="2" className={`${c as string} s-ink`} strokeWidth="2.500" />
          ))}
        </g>
      ))}
      <g transform="translate(236 112)"><g className="bob">
        <rect x="-26" y="-6" width="52" height="40" rx="5" className="f-card s-ink" {...S} />
        <path d="M0-6v40M-18 6h12M-18 14h10M6 6h12M6 14h10" className="s-ink nf" strokeWidth="2.500" strokeLinecap="round" />
      </g></g>
      <g transform="translate(40 200)">
        <rect x="0" y="-16" width="64" height="16" rx="3" className="f-b s-ink" strokeWidth="3" /><rect x="6" y="-32" width="54" height="16" rx="3" className="f-a s-ink" strokeWidth="3" /><rect x="10" y="-48" width="46" height="16" rx="3" className="f-card s-ink" strokeWidth="3" />
      </g>
    </Frame>
  ),
  sports: (
    <Frame tone="f-sky">
      <path d="M0 150h320v90H0z" className="f-leaf" />
      <path d="M0 150h320" className="s-card nf" strokeWidth="4" />
      <path d="M40 210h240" className="s-card nf" strokeWidth="4" strokeDasharray="14 12" strokeLinecap="round" />
      <path d="M232 150V92h56v58" className="s-card nf" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M232 100l56 40M232 124l56-24M260 92v58" className="s-card nf" strokeWidth="1.500" opacity=".7" />
      <g transform="translate(90 70)"><g className="bounce">
        <circle r="26" className="f-card s-ink" {...S} />
        <path d="M0-12l11 8-4 13h-14l-4-13z" className="f-ink" />
        <path d="M0-12v-14M11-4l14-6M7 9l9 12M-7 9l-9 12M-11-4l-14-6" className="s-ink nf" strokeWidth="2.500" strokeLinecap="round" />
      </g></g>
      <ellipse cx="90" cy="188" rx="22" ry="5" className="f-shadow bshadow" />
      <path d="M180 48l10 22M200 38l-4 26" className="s-a nf" strokeWidth="4" strokeLinecap="round" />
      {[[40, 206], [190, 214]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y}l9-26 9 26z`} className="f-a s-ink" {...S} />
      ))}
    </Frame>
  ),
  art: (
    <Frame tone="f-skya2">
      <path d="M96 190l36-110M184 190l-36-110M140 190l0-100" className="s-ink nf" strokeWidth="5" strokeLinecap="round" />
      <rect x="86" y="48" width="108" height="86" rx="6" className="f-card s-ink" {...S} />
      <path d="M96 118c20-26 34-4 52-26s28 6 38 8v24H96z" className="f-leaf" />
      <circle cx="170" cy="72" r="10" className="f-a" />
      <path d="M96 118c20-26 34-4 52-26s28 6 38 8" className="s-ink nf" strokeWidth="2.500" strokeLinecap="round" />
      <g transform="translate(236 150)"><g className="bob slow">
        <path d="M0-30c28 0 44 18 44 36 0 14-10 20-20 18-8-2-8 6-12 10-10 8-40-6-40-34S-22-30 0-30z" className="f-card s-ink" {...S} transform="scale(.9)" />
        <circle cx="-14" cy="-6" r="6" className="f-a" /><circle cx="6" cy="-14" r="6" className="f-b" /><circle cx="22" cy="0" r="6" className="f-leaf" /><circle cx="-8" cy="12" r="6" className="f-pink" />
      </g></g>
      <g transform="translate(40 120) rotate(-30)"><rect width="10" height="48" rx="3" className="f-b s-ink" {...S} /><path d="M0 0l5-16 5 16z" className="f-a s-ink" {...S} /></g>
    </Frame>
  ),
  music: (
    <Frame tone="f-bs2">
      <ellipse cx="110" cy="176" rx="60" ry="14" className="f-shadow" />
      <path d="M52 112v54c0 12 26 20 58 20s58-8 58-20v-54z" className="f-b s-ink" {...S} />
      <ellipse cx="110" cy="112" rx="58" ry="18" className="f-card s-ink" {...S} />
      <path d="M62 126l12 54M158 126l-12 54M96 130l2 56M124 130l-2 56" className="s-paper nf" strokeWidth="2.500" strokeLinecap="round" opacity=".6" />
      <g className="drum-sticks"><path d="M80 52l36 50M152 40l-34 62" className="s-a nf" strokeWidth="6" strokeLinecap="round" /></g>
      {[[214, 150, 0], [254, 120, 0.5], [236, 76, 1], [282, 168, 1.5]].map(([x, y, d], i) => (
        <g key={i} transform={`translate(${x} ${y})`}><g className="mnote" style={{ animationDelay: `${d}s` }}>
          <ellipse cx="0" cy="14" rx="9" ry="7" className="f-ink" transform="rotate(-20)" />
          <path d="M8 12V-18q10 4 14 12" className="s-ink nf" strokeWidth="3.500" strokeLinecap="round" />
        </g></g>
      ))}
    </Frame>
  ),
  garden: (
    <Frame tone="f-sky">
      <g className="sun-s" transform="translate(262 52)"><circle r="22" className="f-a" /><circle r="30" className="s-a nf" strokeWidth="3" strokeDasharray="4 9" strokeLinecap="round" /></g>
      <path d="M0 176h320v64H0z" className="f-soil" />
      {[[70, 1], [130, 1.15], [190, 0.9], [250, 1.05]].map(([x, s], i) => (
        <g key={i} transform={`translate(${x} 176) scale(${s})`}>
          <g className="grow" style={{ animationDelay: `${i * 0.5}s` }}>
            <path d="M0 0V-62" className="s-leafd nf" strokeWidth="5" strokeLinecap="round" />
            <path d="M0-22c-18 0-26-12-26-22 16 0 26 8 26 22zM0-34c18 0 26-12 26-22-16 0-26 8-26 22z" className="f-leaf s-ink" strokeWidth="2.500" strokeLinejoin="round" />
            <circle cy="-70" r="12" className={i % 2 ? "f-a s-ink" : "f-pink s-ink"} strokeWidth="2.500" />
            <circle cy="-70" r="4.500" className="f-card" />
          </g>
        </g>
      ))}
      <g transform="translate(30 130)"><g className="tilt">
        <path d="M0 0h34l-4 30H4z" className="f-b s-ink" {...S} /><path d="M34 8l24-12" className="s-ink nf" strokeWidth="5" strokeLinecap="round" />
        <path d="M4 0c0-10 30-10 30 0" className="s-ink nf" strokeWidth="3" />
      </g></g>
    </Frame>
  ),
  computer: (
    <Frame tone="f-as">
      <rect x="62" y="44" width="196" height="124" rx="10" className="f-ink" />
      <rect x="72" y="54" width="176" height="104" rx="4" className="f-card" />
      <path d="M86 76h50M86 92h80M100 108h60M100 124h92" className="s-b nf" strokeWidth="5" strokeLinecap="round" />
      <path d="M144 76h30M174 92h20M168 108h26" className="s-a nf" strokeWidth="5" strokeLinecap="round" />
      <rect x="198" y="120" width="8" height="14" className="f-ink caret" />
      <path d="M140 168h40l8 22h-56z" className="f-bd s-ink" {...S} />
      <rect x="100" y="190" width="120" height="12" rx="6" className="f-card s-ink" {...S} />
      <g transform="translate(274 72)"><g className="bob"><rect x="-18" y="-18" width="36" height="36" rx="8" className="f-a s-ink" {...S} /><path d="M-6-6l-8 6 8 6M6-6l8 6-8 6" className="s-ink nf" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></g></g>
    </Frame>
  ),
  assembly: (
    <Frame tone="f-skya2">
      <path d="M80 190V50" className="s-ink nf" strokeWidth="5" strokeLinecap="round" />
      <path className="flag f-b s-ink" strokeWidth="3" strokeLinejoin="round" d="M82 50q22-12 44 0t44 0v34q-22 12-44 0t-44 0z" />
      <path d="M96 58l10 10-10 10" className="s-card nf" strokeWidth="0" />
      <circle cx="146" cy="67" r="9" className="f-card" /><circle cx="150" cy="65" r="8" className="f-b" />
      {[[140, "f-a"], [180, "f-b"], [220, "f-leaf"], [260, "f-pink"], [160, "f-leafd"], [200, "f-a"], [240, "f-b"]].map(([x, c], i) => {
        const row = i < 4 ? 0 : 1;
        return (
          <g key={i} transform={`translate(${(x as number) + (row ? 0 : 0)} ${row ? 190 : 162})`}>
            <g className="cheer" style={{ animationDelay: `${i * 0.18}s` }}>
              <rect x="-10" y="-18" width="20" height="30" rx="8" className={`${c as string} s-ink`} strokeWidth="2.500" />
              <circle cy="-28" r="10" className="f-skin s-ink" strokeWidth="2.500" />
              <path d="M-9-31a10 10 0 0 1 18 0z" className="f-ink" />
            </g>
          </g>
        );
      })}
    </Frame>
  ),
};

export function GalleryScene({ art, label }: { art: GalleryArt; label: string }) {
  return (
    <svg viewBox="0 0 320 240" role="img" aria-label={label} className="gscene" preserveAspectRatio="xMidYMid slice">
      {SCENES[art] ?? SCENES.science}
    </svg>
  );
}
