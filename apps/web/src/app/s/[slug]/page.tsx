import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { SiteLoader } from "@/components/site/site-loader";
import { SitePage } from "@/components/site/site-page";
import type { PublicSite } from "@/lib/site";

/** Where the server asks for the page: an internal address when the API has one, else the public one. */
const API_BASE = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

/** The site, null when the school has none, or "unreachable" when the server cannot ask. */
async function load(slug: string): Promise<PublicSite | null | "unreachable"> {
  if (!/^https?:\/\//.test(API_BASE)) return "unreachable";
  try {
    const res = await fetch(`${API_BASE}/public/${encodeURIComponent(slug)}/site`, { next: { revalidate: 30 } });
    if (res.status === 404) return null;
    return res.ok ? ((await res.json()) as PublicSite) : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function generateMetadata({ params }: PageProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data || data === "unreachable") return { title: "School website", robots: { index: false } };
  const { site, school } = data;
  return {
    title: { absolute: site.seo.title || school.name },
    description: site.seo.description || site.hero.tagline,
    openGraph: { title: site.seo.title || school.name, description: site.seo.description, type: "website", siteName: school.name },
  };
}

export async function generateViewport({ params }: PageProps<"/s/[slug]">): Promise<Viewport> {
  const { slug } = await params;
  const data = await load(slug);
  return data && data !== "unreachable" ? { themeColor: data.site.theme.primary } : {};
}

export default async function SchoolSitePage({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const data = await load(slug);
  if (data === null) notFound();
  // Pakistan time, so "upcoming" flips at the school's midnight.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
  return data === "unreachable" ? <SiteLoader slug={slug} today={today} /> : <SitePage data={data} today={today} />;
}
