import { hash } from "@/lib/site";

const SKIN = ["#f1c9a5", "#e3ab82", "#c98c63", "#a66d48", "#7d4f33"];
const HAIR = ["#1d1a1a", "#2b211c", "#4a3326", "#6b4a32", "#8c8c8c"];
const OUTFIT = ["f-b", "f-a", "f-leaf", "f-bd", "f-pink", "f-leafd"];
const BACK = ["f-bs", "f-as", "f-leafs", "f-bs2"];

/**
 * A friendly drawn portrait for a staff member, chosen from their name so the
 * same person always gets the same face. The school never needs photographs.
 */
export function Portrait({ name, label }: { name: string; label?: string }) {
  const h = hash(name);
  const pick = <T,>(list: T[], shift: number) => list[(h >>> shift) % list.length];
  const skin = pick(SKIN, 0);
  const hair = pick(HAIR, 3);
  const outfit = pick(OUTFIT, 6);
  const back = pick(BACK, 9);
  const style = (h >>> 12) % 6; // 0 short, 1 long, 2 bun, 3 side part, 4 dupatta, 5 bald with cap
  const glasses = (h >>> 16) % 3 === 0;
  const moustache = style !== 1 && style !== 2 && style !== 4 && (h >>> 18) % 2 === 0;
  const ink = { stroke: "var(--ink)", strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

  return (
    <svg viewBox="0 0 160 160" role="img" aria-label={label ?? name} className="portrait">
      <rect width="160" height="160" className={back} />
      <circle cx="132" cy="30" r="14" className="f-card" opacity=".55" />
      <path d="M-4 168c4-34 28-50 84-50s80 16 84 50z" className={outfit} {...ink} />
      <path d="M66 118l14 18 14-18" className="f-card" {...ink} />
      {style === 4 && <path d="M80 36c-30 0-44 20-44 46 0 20 6 38 8 60 14 8 62 8 72 0 2-22 8-40 8-60 0-26-14-46-44-46z" className="f-dupatta" {...ink} />}
      {style === 1 && <path d="M80 34c-28 0-42 20-42 44 0 22-4 40 6 56l72 0c10-16 6-34 6-56 0-24-14-44-42-44z" fill={hair} {...ink} />}
      <rect x="68" y="92" width="24" height="28" rx="8" fill={skin} {...ink} />
      <ellipse cx="80" cy="74" rx="29" ry="34" fill={skin} {...ink} />
      <ellipse cx="51" cy="78" rx="5" ry="8" fill={skin} {...ink} /><ellipse cx="109" cy="78" rx="5" ry="8" fill={skin} {...ink} />
      {style === 0 && <path d="M50 66c0-22 14-32 30-32s30 10 30 32c-8-10-20-14-30-14s-22 4-30 14z" fill={hair} {...ink} />}
      {style === 1 && <path d="M50 70c2-22 14-32 30-32s28 10 30 32c-10-8-18-16-30-16s-20 8-30 16z" fill={hair} {...ink} />}
      {style === 2 && (<><circle cx="80" cy="30" r="13" fill={hair} {...ink} /><path d="M50 68c0-20 14-30 30-30s30 10 30 30c-10-10-20-14-30-14s-20 4-30 14z" fill={hair} {...ink} /></>)}
      {style === 3 && <path d="M50 70c0-26 16-36 34-36 18 0 26 12 26 36-6-8-16-16-40-16-8 0-14 4-20 16z" fill={hair} {...ink} />}
      {style === 4 && <path d="M52 70c4-18 16-26 28-26s24 8 28 26c-8-8-18-10-28-10s-20 2-28 10z" className="f-dupatta" {...ink} />}
      {style === 5 && (<><path d="M50 62c4-18 16-24 30-24s26 6 30 24z" className="f-cap" {...ink} /><path d="M46 62h68" {...ink} /></>)}
      <g className="eyes">
        <ellipse cx="68" cy="76" rx="3.200" ry="4" fill="#1d1a1a" /><ellipse cx="92" cy="76" rx="3.200" ry="4" fill="#1d1a1a" />
      </g>
      {glasses && (<><circle cx="68" cy="76" r="9" fill="none" {...ink} strokeWidth="2.500" /><circle cx="92" cy="76" r="9" fill="none" {...ink} strokeWidth="2.500" /><path d="M77 76h6" {...ink} strokeWidth="2.500" /></>)}
      {moustache && <path d="M68 94q12-7 24 0q-12 4-24 0z" fill={hair} />}
      <path d="M70 100q10 8 20 0" fill="none" {...ink} strokeWidth="2.800" />
      <path d="M58 88q-2 4 0 6M102 88q2 4 0 6" fill="none" stroke="#e58b8b" strokeWidth="5" strokeLinecap="round" opacity=".45" />
    </svg>
  );
}
