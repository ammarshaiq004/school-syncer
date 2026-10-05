import { extendTailwindMerge } from "tailwind-merge";

type ClassValue = string | number | bigint | boolean | null | undefined;

/** tailwind-merge that knows our custom theme scales (see globals.css @theme). */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ["card", "raised", "overlay"],
      font: ["display"],
    },
  },
});

/** Joins class names, skipping falsy values; later Tailwind classes win over conflicting earlier ones (e.g. `w-40` over `w-full`). */
export function cn(...classes: ClassValue[]): string {
  return twMerge(classes.filter((c): c is string => typeof c === "string" && c !== ""));
}
