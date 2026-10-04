import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/cn";

/** Indigo square logo mark. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-white shadow-card", className)} aria-hidden>
      <GraduationCap className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}

/** Mark plus wordmark. */
export function BrandLockup({ className, suffix }: { className?: string; suffix?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark />
      <span className="truncate font-display text-[15px] font-semibold text-fg">
        SchoolSyncer
        {suffix && <span className="ms-1.5 font-sans text-xs font-medium text-fg-muted">{suffix}</span>}
      </span>
    </span>
  );
}
