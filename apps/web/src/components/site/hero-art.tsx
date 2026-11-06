import type { ReactNode } from "react";

/**
 * The home page's hero illustrations. Hand-drawn SVG, coloured only through
 * the site's CSS variables (classes in site.css), so each school's colours
 * repaint them, and animated with CSS so reduced-motion can switch it off.
 */

/** The scene's frame: an arched window, like a school doorway. */
const ARCH = "M8 540V320A312 312 0 0 1 632 320V540Q632 556 616 556H24Q8 556 8 540Z";
const Sun = () => (
  <g className="sun" transform="translate(172 150)">
    <g className="spin-slow">
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="0" y1={i % 2 ? -48 : -52} x2="0" y2={i % 2 ? -58 : -68} transform={`rotate(${i * 30})`} className="s-a" strokeWidth="6" strokeLinecap="round" />
      ))}
    </g>
    <circle r="36" className="f-a" />
    <circle r="36" className="f-glint" />
  </g>
);

const Moon = () => (
  <g className="moon" transform="translate(172 150)">
    <circle r="34" className="f-moon" />
    <circle cx="14" cy="-10" r="30" className="f-sky" />
    <circle cx="-14" cy="14" r="3" className="f-moonshade" />
    <circle cx="-4" cy="26" r="2" className="f-moonshade" />
  </g>
);

const Stars = () => (
  <g className="stars">
    {[[300, 70], [440, 130], [520, 230], [96, 250], [250, 40], [380, 52], [560, 140]].map(([x, y], i) => (
      <path
        key={i}
        d="M0-7C1 -2 2 -1 7 0 2 1 1 2 0 7-1 2-2 1-7 0-2-1-1-2 0-7z"
        transform={`translate(${x} ${y}) scale(${0.6 + (i % 3) * 0.25})`}
        className="f-moon twinkle"
        style={{ animationDelay: `${i * 0.45}s` }}
      />
    ))}
  </g>
);

const Cloud = ({ x, y, s = 1, cls }: { x: number; y: number; s?: number; cls: string }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <g className={`cloud ${cls}`}>
      <path d="M-46 14a20 20 0 0 1 9-37 26 26 0 0 1 49-6 22 22 0 0 1 33 11 17 17 0 0 1-3 32z" className="f-cloud" />
    </g>
  </g>
);

const Bird = ({ x, y, cls, s = 1 }: { x: number; y: number; cls: string; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <g className={`bird ${cls}`}>
      <path className="flap s-ink nf" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M-14 0Q-7-9 0 0Q7-9 14 0" />
    </g>
  </g>
);

const Tree = ({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="-6" y="-34" width="12" height="38" rx="3" className="f-trunk s-ink" strokeWidth="3" />
    <g className="sway" style={{ animationDelay: `${delay}s` }}>
      <circle cx="0" cy="-62" r="34" className="f-leafd s-ink" strokeWidth="3" />
      <circle cx="-26" cy="-42" r="24" className="f-leaf s-ink" strokeWidth="3" />
      <circle cx="26" cy="-44" r="22" className="f-leaf s-ink" strokeWidth="3" />
      <path d="M-14-70q8-8 18-4" className="s-hi nf" strokeWidth="4" strokeLinecap="round" />
    </g>
  </g>
);

const Kid = ({ cls, shirt, x, y, flip = false }: { cls: string; shirt: string; x: number; y: number; flip?: boolean }) => (
  <g transform={`translate(${x} ${y})`}>
    <g className={`kid ${cls}`}>
      <g transform={flip ? "scale(-1 1)" : undefined}>
        <ellipse cx="0" cy="26" rx="11" ry="3" className="f-shadow" />
        <g className="leg l1"><rect x="-5" y="12" width="5" height="13" rx="2.500" className="f-ink" /></g>
        <g className="leg l2"><rect x="1" y="12" width="5" height="13" rx="2.500" className="f-ink" /></g>
        <rect x="-11" y="-6" width="9" height="18" rx="4" className="f-pack s-ink" strokeWidth="2.500" />
        <rect x="-8" y="-8" width="17" height="22" rx="7" className={`${shirt} s-ink`} strokeWidth="2.500" />
        <circle cx="2" cy="-17" r="9" className="f-skin s-ink" strokeWidth="2.500" />
        <path d="M-6-18a9 9 0 0 1 16-3c-3-2-9-3-16 3z" className="f-ink" />
      </g>
    </g>
  </g>
);

const Window = ({ x, y, w = 18, h = 28 }: { x: number; y: number; w?: number; h?: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d={`M0 ${h}V${w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${h}z`} className="win s-ink" strokeWidth="2.500" />
    <path d={`M${w / 2} ${w / 2 - 4}V${h}M0 ${h * 0.55}H${w}`} className="s-ink nf" strokeWidth="1.600" />
  </g>
);

export function CampusScene() {
  return (
    <svg viewBox="0 0 640 560" role="img" aria-label="Illustration of the school building with its clock tower, trees and children walking in" className="scene">
      {/* sky */}
      <defs><clipPath id="ss-arch"><path d={ARCH} /></clipPath></defs>
      <g clipPath="url(#ss-arch)">
      <path d={ARCH} className="f-sky" />
      <Stars />
      <Sun />
      <Moon />
      <Cloud x={440} y={104} cls="c1" s={1.05} />
      <Cloud x={92} y={262} cls="c2" s={0.78} />
      <Cloud x={560} y={246} cls="c3" s={0.6} />
      <Bird x={300} y={150} cls="b1" />
      <Bird x={350} y={176} cls="b2" s={0.75} />
      <Bird x={262} y={186} cls="b3" s={0.6} />

      {/* far hills and ground */}
      <path d="M0 404C90 346 190 352 286 394S500 346 640 388V560H0z" className="f-hill" />
      <path d="M0 440C120 410 240 428 330 436S540 412 640 432V560H0z" className="f-leaf" />
      <path d="M0 470C140 456 300 474 640 462V560H0z" className="f-leafd" />

      {/* path */}
      <path d="M286 458h68l92 102H194z" className="f-path" />
      <path d="M300 482h40M290 508h60M274 536h92" className="s-pathline nf" strokeWidth="3" strokeLinecap="round" />

      {/* building */}
      <g className="building">
        <rect x="118" y="350" width="108" height="98" className="f-card s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <rect x="414" y="350" width="108" height="98" className="f-card s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M108 350l12-26h100l12 26z" className="f-bd s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M412 350l12-26h100l12 26z" className="f-bd s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        {[134, 166, 198].map((x) => <Window key={x} x={x - 8} y={376} w={16} h={26} />)}
        {[442, 474, 506].map((x) => <Window key={x} x={x - 8} y={376} w={16} h={26} />)}

        {/* tower */}
        <rect x="292" y="174" width="56" height="96" className="f-card s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M282 176L320 118l38 58z" className="f-bd s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M320 118V74" className="s-ink nf" strokeWidth="3.500" strokeLinecap="round" />
        <g transform="translate(320 76)"><path className="flag f-a s-ink" strokeWidth="2.500" strokeLinejoin="round" d="M0 0q14-8 28 0t28 0v22q-14 8-28 0t-28 0z" /></g>
        <circle cx="320" cy="212" r="18" className="f-clock s-ink" strokeWidth="3" />
        <path d="M320 212V200" className="s-ink nf hand-m" strokeWidth="3" strokeLinecap="round" />
        <path d="M320 212l7 4" className="s-ink nf" strokeWidth="3" strokeLinecap="round" />
        <circle cx="320" cy="212" r="2" className="f-ink" />

        {/* main hall */}
        <rect x="204" y="296" width="232" height="152" className="f-card s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M192 298L320 232l128 66z" className="f-b s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M222 292L320 242l98 50" className="s-hi nf" strokeWidth="3" strokeLinecap="round" opacity=".5" />
        <circle cx="320" cy="272" r="13" className="win s-ink" strokeWidth="3" />
        {[230, 262].map((x) => <Window key={x} x={x} y={328} />)}
        {[374, 406].map((x) => <Window key={x} x={x - 10} y={328} />)}
        <path d="M296 448V398a24 24 0 0 1 48 0V448z" className="f-door s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M320 374V448" className="s-ink nf" strokeWidth="2.500" />
        <circle cx="312" cy="420" r="2.500" className="f-a" /><circle cx="328" cy="420" r="2.500" className="f-a" />
        <rect x="280" y="448" width="80" height="9" className="f-step s-ink" strokeWidth="3" strokeLinejoin="round" />
        <rect x="268" y="457" width="104" height="9" className="f-step s-ink" strokeWidth="3" strokeLinejoin="round" />
      </g>

      {/* planting */}
      <Tree x={62} y={470} s={1.08} />
      <Tree x={590} y={474} s={0.98} delay={1.2} />
      <Tree x={158} y={466} s={0.62} delay={0.6} />
      {[[236, 468], [404, 470], [196, 488], [448, 492]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <ellipse cx="0" cy="0" rx="22" ry="12" className="f-leafd s-ink" strokeWidth="3" />
          <circle cx="-8" cy="-3" r="2.600" className="f-a" /><circle cx="6" cy="1" r="2.600" className="f-b" />
        </g>
      ))}

      {/* children arriving */}
      <Kid cls="k1" shirt="f-a" x={300} y={492} />
      <Kid cls="k2" shirt="f-b" x={354} y={512} flip />
      <Kid cls="k3" shirt="f-leaf" x={262} y={532} />

      {/* things in the air */}
      <g transform="translate(70 318)"><g className="bob">
        <rect x="-18" y="-13" width="36" height="26" rx="4" className="f-b s-ink" strokeWidth="3" transform="rotate(-10)" />
        <path d="M-12-6h20M-12 0h14" className="s-paper nf" strokeWidth="2.500" strokeLinecap="round" transform="rotate(-10)" />
      </g></g>
      <g transform="translate(572 178)"><g className="bob slow">
        <g transform="rotate(35)">
          <rect x="-5" y="-26" width="10" height="42" rx="2" className="f-a s-ink" strokeWidth="3" />
          <path d="M-5 16h10l-5 11z" className="f-skin s-ink" strokeWidth="3" strokeLinejoin="round" />
          <rect x="-5" y="-26" width="10" height="7" className="f-pink s-ink" strokeWidth="3" />
        </g>
      </g></g>
      <g className="plane"><path d="M0 0l30-10-9 24-5-9z M16 5l14-15" className="f-card s-ink" strokeWidth="2.500" strokeLinejoin="round" /></g>
      </g>
      <path d={ARCH} className="nf s-ink" strokeWidth="4" />
    </svg>
  );
}

const Tile = ({ x, y, w, h, who, cls }: { x: number; y: number; w: number; h: number; who: string; cls?: string }) => (
  <g transform={`translate(${x} ${y})`} className={cls}>
    <rect width={w} height={h} rx="8" className="f-bs" />
    <circle cx={w / 2} cy={h * 0.4} r={h * 0.17} className="f-skin" />
    <path d={`M${w * 0.22} ${h}c0-${h * 0.3} ${w * 0.12}-${h * 0.36} ${w * 0.28}-${h * 0.36}s${w * 0.28} .06 ${w * 0.28} ${h * 0.36}z`} className={who} />
  </g>
);

export function LearningScene() {
  return (
    <svg viewBox="0 0 640 560" role="img" aria-label="Illustration of an online class on a laptop surrounded by books, a globe and a light bulb" className="scene">
      <defs><clipPath id="ss-arch"><path d={ARCH} /></clipPath></defs>
      <g clipPath="url(#ss-arch)">
      <path d={ARCH} className="f-sky" />
      <Stars />
      <Sun />
      <Moon />
      <Cloud x={470} y={92} cls="c1" s={0.9} />
      <Cloud x={84} y={300} cls="c2" s={0.7} />
      <path d="M0 430C100 392 200 400 300 426S500 392 640 420V560H0z" className="f-hill" />
      <path d="M0 470C140 450 300 480 640 458V560H0z" className="f-leaf" />

      {/* laptop */}
      <g className="laptop">
        <rect x="150" y="176" width="340" height="226" rx="16" className="f-ink" />
        <rect x="162" y="188" width="316" height="202" rx="8" className="f-card" />
        <circle cx="176" cy="200" r="3.200" className="f-a" /><circle cx="188" cy="200" r="3.200" className="f-leaf" /><circle cx="200" cy="200" r="3.200" className="f-b" />
        <rect x="360" y="195" width="104" height="10" rx="5" className="f-bs2" />
        <Tile x={176} y={214} w={140} h={74} who="f-b" />
        <Tile x={324} y={214} w={140} h={74} who="f-a" cls="speaker" />
        <Tile x={176} y={296} w={140} h={74} who="f-leaf" />
        <Tile x={324} y={296} w={140} h={74} who="f-bd" />
        <rect x="324" y="214" width="140" height="74" rx="8" className="s-a nf ring" strokeWidth="3" />
        <path d="M110 402h420l-30 34H140z" className="f-bs2 s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <rect x="270" y="402" width="100" height="8" rx="4" className="f-bs" />
      </g>

      {/* orbiting atom */}
      <g transform="translate(92 214)">
        <g className="spin-med">
          <ellipse rx="44" ry="15" className="s-b nf" strokeWidth="4" />
          <ellipse rx="44" ry="15" transform="rotate(60)" className="s-b nf" strokeWidth="4" />
          <ellipse rx="44" ry="15" transform="rotate(120)" className="s-b nf" strokeWidth="4" />
        </g>
        <circle r="10" className="f-a s-ink" strokeWidth="3" />
      </g>

      {/* globe */}
      <g transform="translate(556 252)"><g className="bob slow">
        <circle r="40" className="f-bs2 s-ink" strokeWidth="3.500" />
        <ellipse rx="16" ry="40" className="s-ink nf" strokeWidth="2.500" />
        <path d="M-40 0H40M-34-20H34M-34 20H34" className="s-ink nf" strokeWidth="2.500" />
        <path d="M-22-18c10-6 20-4 26 6s-6 14-14 12-12-12-12-18z" className="f-leaf" opacity=".9" />
        <path d="M-40 52h80" className="s-ink nf" strokeWidth="0" />
      </g></g>

      {/* light bulb */}
      <g transform="translate(520 120)"><g className="bob">
        <circle r="48" className="f-glint pulse" />
        <path d="M0-26a22 22 0 0 0-13 40c3 3 5 6 5 10h16c0-4 2-7 5-10A22 22 0 0 0 0-26z" className="f-a s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M-8 28h16M-6 35h12" className="s-ink nf" strokeWidth="3.500" strokeLinecap="round" />
        <path d="M-6-8l6 8 6-8" className="s-paper nf" strokeWidth="2.500" strokeLinecap="round" strokeLinejoin="round" />
      </g></g>

      {/* floating cards */}
      <g transform="translate(110 130)"><g className="bob slow">
        <rect x="-44" y="-26" width="88" height="52" rx="14" className="f-card s-ink" strokeWidth="3.500" />
        <path d="M-14 26l-6 14 18-14z" className="f-card s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <path d="M-14-26h28M-14 26h4" className="s-ink nf" strokeWidth="0" />
        <path d="M-26-6h52M-26 6h34" className="s-bs2 nf" strokeWidth="5" strokeLinecap="round" />
      </g></g>
      <g transform="translate(254 98)"><g className="bob">
        <rect x="-34" y="-30" width="68" height="60" rx="10" className="f-card s-ink" strokeWidth="3.500" />
        <path d="M-20-10h8M-20 4h8M-20 18h8" className="s-ink nf" strokeWidth="3" strokeLinecap="round" />
        <path d="M-6-10l4 4 8-8M-6 4l4 4 8-8" className="s-leaf nf" strokeWidth="3.500" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="18" r="5" className="f-pink" />
      </g></g>

      {/* books */}
      <g transform="translate(66 462)">
        <rect x="0" y="-20" width="96" height="20" rx="4" className="f-b s-ink" strokeWidth="3.500" />
        <rect x="8" y="-40" width="82" height="20" rx="4" className="f-a s-ink" strokeWidth="3.500" />
        <rect x="14" y="-60" width="70" height="20" rx="4" className="f-leaf s-ink" strokeWidth="3.500" />
        <path d="M14-10h60M22-30h50M26-50h40" className="s-paper nf" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g transform="translate(540 470)">
        <path d="M-24 0h48l-6-44h-36z" className="f-pot s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        <g className="sway">
          <path d="M0-44C-4-70-20-82-32-80c0 20 10 32 32 36z" className="f-leaf s-ink" strokeWidth="3.500" strokeLinejoin="round" />
          <path d="M0-44C6-76 22-86 34-82c0 22-12 34-34 38z" className="f-leafd s-ink" strokeWidth="3.500" strokeLinejoin="round" />
        </g>
      </g>
      <g className="plane"><path d="M0 0l30-10-9 24-5-9z M16 5l14-15" className="f-card s-ink" strokeWidth="2.500" strokeLinejoin="round" /></g>
      </g>
      <path d={ARCH} className="nf s-ink" strokeWidth="4" />
    </svg>
  );
}

/** A hand-drawn scribble that draws itself under a word. */
export function Scribble({ children }: { children: ReactNode }) {
  return (
    <span className="mark">
      {children}
      <svg className="mark-line" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M3 9C30 3 52 12 86 7s58-6 84-1 20 1 27-2" pathLength="1" />
      </svg>
    </span>
  );
}

/** Scalloped edge between sections. `flip` turns it to hang from the section above. */
export function Wave({ className = "", flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg className={`wave ${flip ? "flip" : ""} ${className}`} viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 60V28C120 4 240 4 360 28s240 24 360 0 240-24 360 0 240 24 360 0V60z" />
    </svg>
  );
}

/** The school's mark when it has not uploaded a logo: its initials on a crest. */
export function Crest({ text, size = 44 }: { text: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="crest" aria-hidden="true" focusable="false">
      <path d="M24 2l17 6v14c0 11-7 19-17 24C14 41 7 33 7 22V8z" className="f-b s-ink" strokeWidth="2.500" strokeLinejoin="round" />
      <path d="M24 2l17 6v14c0 11-7 19-17 24" className="f-bd" opacity=".35" />
      <path d="M13 11l11-4 11 4" className="s-a nf" strokeWidth="2.500" strokeLinecap="round" strokeLinejoin="round" />
      <text x="24" y="31" textAnchor="middle" className="crest-text" fontSize={text.length > 1 ? 15 : 19} fontWeight="700">{text}</text>
    </svg>
  );
}
