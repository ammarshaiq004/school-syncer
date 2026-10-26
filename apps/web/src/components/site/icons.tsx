import type { ReactNode, SVGProps } from "react";
import type { SiteIcon } from "@/lib/site";

/**
 * The school site's own icon set: drawn on a 24px grid with one 1.75px
 * rounded stroke, and a soft accent fill (`.d`) behind the main shape.
 */
const D = ({ d }: { d: string }) => <path d={d} className="d" />;

const ICONS = {
  book: (
    <>
      <D d="M3 5.5c3-1.2 6-1 9 .8v13c-3-1.8-6-2-9-.8z" />
      <path d="M3 5.5c3-1.2 6-1 9 .8 3-1.8 6-2 9-.8v13c-3-1.2-6-1-9 .8-3-1.8-6-2-9-.8z" />
      <path d="M12 6.3v13" />
    </>
  ),
  atom: (
    <>
      <circle cx="12" cy="12" r="2" className="d" />
      <ellipse cx="12" cy="12" rx="10" ry="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
    </>
  ),
  palette: (
    <>
      <D d="M12 3C6.5 3 3 7 3 11.5 3 16.5 7 21 12 21c1.6 0 2-1 1.6-2-.5-1.3.2-2.4 1.6-2.4H17c2.2 0 4-1.6 4-4C21 7 17 3 12 3z" />
      <path d="M12 3C6.5 3 3 7 3 11.5 3 16.5 7 21 12 21c1.6 0 2-1 1.6-2-.5-1.3.2-2.4 1.6-2.4H17c2.2 0 4-1.6 4-4C21 7 17 3 12 3z" />
      <circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15" cy="8" r="1" />
    </>
  ),
  calculator: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <rect x="8" y="6" width="8" height="3.2" rx=".8" className="d" />
      <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" strokeWidth="2.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" className="d" />
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M4.5 7.5h15M4.5 16.5h15" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.8" className="d" />
      <rect x="4" y="5" width="16" height="11" rx="1.8" />
      <path d="M2 19.5h20M3.5 19.5l.8-3.5M20.5 19.5l-.8-3.5" />
      <path d="M10.6 8.6v4l3.4-2z" />
    </>
  ),
  music: (
    <>
      <circle cx="7" cy="18" r="2.4" className="d" />
      <circle cx="17" cy="16" r="2.4" className="d" />
      <path d="M9.4 18V6l10-2v12" />
      <circle cx="7" cy="18" r="2.4" /><circle cx="17" cy="16" r="2.4" />
    </>
  ),
  trophy: (
    <>
      <D d="M7 4h10v5a5 5 0 01-10 0z" />
      <path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 21h8M9 18h6" />
    </>
  ),
  heart: (
    <>
      <D d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0112 7.6a4.3 4.3 0 018 2.2C20 15.4 12 20 12 20z" />
      <path d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0112 7.6a4.3 4.3 0 018 2.2C20 15.4 12 20 12 20z" />
    </>
  ),
  pencil: (
    <>
      <D d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3M5 16l3 3" />
    </>
  ),
  star: (
    <>
      <D d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </>
  ),
  leaf: (
    <>
      <D d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15z" />
      <path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15zM5 19L14 10" />
    </>
  ),
  bulb: (
    <>
      <D d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0012 3z" />
      <path d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0012 3zM9.5 20h5M10.5 22.2h3" />
    </>
  ),
  shield: (
    <>
      <D d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6z" />
      <path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  flask: (
    <>
      <path d="M7.2 15.5h9.6l2.7 4.5a1.5 1.5 0 01-1.3 2.2H5.8a1.5 1.5 0 01-1.3-2.2z" className="d" />
      <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2.2h12.4a1.5 1.5 0 001.3-2.2L14 9V3" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" className="d" />
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.5 2.7-5.7 6-5.7s6 2.200 6 5.700M16 5.200a3.200 3.200 0 010 5.600M18 14.600c2 .8 3.200 2.600 3.200 5.400" />
    </>
  ),
  /* interface icons */
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
  check: <path d="M4.5 12.500l4.700 4.700L19.500 7" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" className="d" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.500v2.200M12 19.300v2.200M2.500 12h2.200M19.300 12h2.200M5.300 5.300l1.500 1.500M17.200 17.200l1.500 1.500M5.300 18.700l1.500-1.500M17.200 6.800l1.500-1.500" />
    </>
  ),
  moon: (
    <>
      <D d="M20 14.500A8 8 0 019.500 4 8.500 8.500 0 1020 14.500z" />
      <path d="M20 14.500A8 8 0 019.500 4 8.500 8.500 0 1020 14.500z" />
    </>
  ),
  phone: <path d="M5 4h3.500l1.800 4.500-2.300 1.500a11 11 0 005 5l1.500-2.300L19 14.500V18a2 2 0 01-2 2A13 13 0 013 6a2 2 0 012-2z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.500" className="d" />
      <rect x="3" y="5" width="18" height="14" rx="2.500" />
      <path d="M3.500 7.500L12 13.500l8.500-6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.500-5.700-6.500-11A6.500 6.500 0 0112 3.500 6.500 6.500 0 0118.500 10c0 5.300-6.500 11-6.500 11z" className="d" />
      <path d="M12 21s-6.500-5.700-6.500-11A6.500 6.500 0 0112 3.500 6.500 6.500 0 0118.500 10c0 5.300-6.500 11-6.500 11z" />
      <circle cx="12" cy="10" r="2.300" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" className="d" />
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.500l3.500 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.500" y="5" width="17" height="15.500" rx="2.500" className="d" />
      <rect x="3.500" y="5" width="17" height="15.500" rx="2.500" />
      <path d="M3.500 10h17M8 3v4M16 3v4" />
    </>
  ),
  quote: <path d="M10 7C6.500 8 4.500 10.500 4.500 14v3h5v-5h-3c0-2 1.200-3.300 3.500-4zM19.500 7c-3.500 1-5.500 3.500-5.500 7v3h5v-5h-3c0-2 1.200-3.300 3.500-4z" className="fillink" />,
  whatsapp: (
    <>
      <path d="M4 20l1.200-4A8.500 8.500 0 1112 20.500a8.500 8.500 0 01-4-1z" className="d" />
      <path d="M4 20l1.200-4A8.500 8.500 0 1112 20.500a8.500 8.500 0 01-4-1zL4 20z" />
      <path d="M9 8.500c0 3.500 3 6.500 6.500 6.500l1-1.600-2-1-.8.800c-1-.4-2-1.400-2.400-2.400l.8-.8-1-2z" />
    </>
  ),
  facebook: <path d="M14 21v-8h2.700l.5-3.200H14V7.800c0-1 .5-1.800 1.900-1.800h1.500V3.200C17 3.100 16 3 15 3c-2.500 0-4.100 1.500-4.100 4.200v2.600H8V13h2.900v8z" />,
  instagram: (
    <>
      <rect x="3.500" y="3.500" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r=".6" className="fillink" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.500" y="5.500" width="19" height="13" rx="4" />
      <path d="M10.200 9.300v5.400l4.600-2.700z" />
    </>
  ),
  apply: (
    <>
      <path d="M6 3h9l4 4v14H6z" className="d" />
      <path d="M6 3h9l4 4v14H6zM14.500 3v4.500H19M9 12h6M9 16h4" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24, ...rest }: { name: IconName | SiteIcon; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {ICONS[name as IconName] ?? ICONS.star}
    </svg>
  );
}
