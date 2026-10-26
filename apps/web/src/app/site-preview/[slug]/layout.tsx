import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFonts } from "@/components/site/site-fonts";

export const metadata: Metadata = { title: "Website preview", robots: { index: false, follow: false } };

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return <SiteFonts>{children}</SiteFonts>;
}
