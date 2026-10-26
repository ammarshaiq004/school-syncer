import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { parseDsn } from "./src/lib/error-reporting";

/** Where lesson videos linked from YouTube and Vimeo play (see the API's video-embed.ts). */
const VIDEO_PLAYERS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"];

/**
 * The Content-Security-Policy for every page. Pragmatic rather than strict:
 * Next and the theme script use inline scripts, and uploaded files, school
 * logos and photos come from the API or an S3 bucket on any https host.
 */
function contentSecurityPolicy(apiOrigin: string, dev: boolean, trackerOrigin: string | null, framedBySelf = false) {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // React's dev overlay and fast refresh need eval.
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // next/font serves Google fonts from this origin.
    "font-src": ["'self'", "data:"],
    "img-src": ["'self'", "data:", "blob:", "https:", apiOrigin],
    "media-src": ["'self'", "blob:", "https:", apiOrigin],
    // The error tracker (Sentry or GlitchTip) when NEXT_PUBLIC_SENTRY_DSN is set.
    "connect-src": ["'self'", apiOrigin, ...(trackerOrigin ? [trackerOrigin] : []), ...(dev ? ["ws:"] : [])],
    // The website editor frames its own live preview at /site-preview.
    "frame-src": ["'self'", ...VIDEO_PLAYERS],
    "frame-ancestors": [framedBySelf ? "'self'" : "'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // Online payments post a signed form to the gateway's hosted checkout.
    "form-action": ["'self'", "https:"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`);
  if (apiOrigin.startsWith("https:")) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  // The API address is baked into the browser bundle, so a production build
  // without it would quietly call http://localhost:4000 from users' browsers.
  if (!apiUrl && phase === PHASE_PRODUCTION_BUILD) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Set it to the API's public address (e.g. https://api.example.pk/api) before `next build`.",
    );
  }
  const apiOrigin = new URL(apiUrl ?? "http://localhost:4000/api").origin;
  const trackerOrigin = parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN)?.origin ?? null;
  if (process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() && !trackerOrigin && phase === PHASE_PRODUCTION_BUILD) {
    throw new Error("NEXT_PUBLIC_SENTRY_DSN is not a valid DSN (https://<key>@<host>/<project id>).");
  }
  const headersFor = (framedBySelf: boolean) => [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(apiOrigin, dev, trackerOrigin, framedBySelf) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: framedBySelf ? "SAMEORIGIN" : "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // Browsers ignore it over plain http, so it is harmless locally.
    ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  ];
  return {
    poweredByHeader: false,
    async headers() {
      return [
        // Nothing may frame the portal, except its own website editor framing the live preview.
        { source: "/((?!site-preview/).*)", headers: headersFor(false) },
        { source: "/site-preview/:path*", headers: headersFor(true) },
      ];
    },
  };
}
