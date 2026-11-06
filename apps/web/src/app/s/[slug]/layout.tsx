import type { ReactNode } from "react";
import { SiteFonts } from "@/components/site/site-fonts";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteFonts>{children}</SiteFonts>;
}
