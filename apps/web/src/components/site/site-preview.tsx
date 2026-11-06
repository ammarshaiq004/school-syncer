"use client";

import { useEffect, useState } from "react";
import type { PublicSite } from "@/lib/site";
import { SitePage } from "./site-page";

export const PREVIEW_READY = "site-preview-ready";
export const PREVIEW_DRAFT = "site-preview-draft";

/**
 * Draws the site from drafts the editor posts to this frame, so edits show
 * before they are saved. Only the same origin's parent window is listened to.
 */
export function SitePreview() {
  const [data, setData] = useState<PublicSite | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      if (e.data?.type === PREVIEW_DRAFT) setData(e.data.data as PublicSite);
    };
    // A preview is not the live site: stay inside the frame when a link would leave it.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest("a");
      if (a && !a.getAttribute("href")?.startsWith("#")) e.preventDefault();
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("click", onClick);
    window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", onClick);
    };
  }, []);

  if (!data) {
    return <p role="status" style={{ padding: "2rem", textAlign: "center", fontFamily: "system-ui" }}>Loading preview…</p>;
  }
  return <SitePage preview data={data} today={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date())} />;
}
