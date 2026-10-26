"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PublicSite } from "@/lib/site";
import { SitePage } from "./site-page";

/** Fallback when the server could not reach the API: the browser asks for the page itself. */
export function SiteLoader({ slug, today }: { slug: string; today: string }) {
  const [data, setData] = useState<PublicSite | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PublicSite>(`/public/${slug}/site`).then(setData, (e: Error) => setError(e.message));
  }, [slug]);

  if (data) return <SitePage data={data} today={today} />;
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "2rem", textAlign: "center" }}>
      <p role={error ? "alert" : "status"}>{error || "Loading the school’s website…"}</p>
    </main>
  );
}
