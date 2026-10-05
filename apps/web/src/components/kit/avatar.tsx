import { cn } from "@/lib/cn";

const TINTS = [
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200",
  "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-200",
  "bg-slate-200 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** "Ayesha Khan" -> "AK"; "Bilal" -> "BI". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable tint classes for a name (same name, same colour). */
export const avatarTint = (name: string) => TINTS[hash(name) % TINTS.length];

const SIZE = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-lg",
} as const;

export interface AvatarProps {
  name: string;
  /** Photo URL; falls back to initials. */
  src?: string | null;
  size?: keyof typeof SIZE;
  className?: string;
}

/** Round avatar: photo or initials on a deterministic tint. */
export function Avatar({ name, src, size = "sm", className }: AvatarProps) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold", SIZE[size], !src && avatarTint(name), className)}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      {!src && <span className="sr-only">{name}</span>}
    </span>
  );
}

/** Overlapping avatars with a "+N" chip. */
export function AvatarStack({ names, max = 4, size = "sm", className }: { names: string[]; max?: number; size?: keyof typeof SIZE; className?: string }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className={cn("inline-flex items-center -space-x-2", className)}>
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size={size} className="ring-2 ring-surface" />
      ))}
      {rest > 0 && (
        <span className={cn("inline-grid place-items-center rounded-full bg-surface-3 font-semibold text-fg-secondary ring-2 ring-surface", SIZE[size])} title={names.slice(max).join(", ")}>
          +{rest}
        </span>
      )}
    </span>
  );
}
