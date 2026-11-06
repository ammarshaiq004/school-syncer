import { cn } from "@/lib/cn";

/** Hudhud, Aon's hoopoe: a small drawn bird, no image file needed. Decorative, so hidden from screen readers. */
export function AonMascot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-full", className)}>
      <g fill="#C8651B">
        <path d="M24 17 20 3l7 9Z" />
        <path d="M28 15 28 1l5 11Z" />
        <path d="M32 16 38 3l1 13Z" />
      </g>
      <g fill="#241a14">
        <circle cx="20" cy="3" r="2" />
        <circle cx="28" cy="1.5" r="2" />
        <circle cx="38" cy="3" r="2" />
      </g>
      <ellipse cx="34" cy="42" rx="17" ry="14" fill="#E3A064" />
      <path d="M30 36c10-4 22 0 25 8-8 6-20 6-28 0Z" fill="#241a14" />
      <path d="M33 38c7-1 14 1 18 5M31 43c7 0 13 1 18 4" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="27" cy="25" r="10" fill="#EBB27A" />
      <path d="M18 27C11 28 6 31 3 36" stroke="#3a2a20" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <circle cx="25" cy="23" r="1.8" fill="#241a14" />
      <circle cx="25.6" cy="22.4" r=".6" fill="#fff" />
      <path d="M30 54v6M37 54v6" stroke="#3a2a20" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
