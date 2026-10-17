/**
 * Optional error tracking for the portal: Sentry or a self-hosted GlitchTip,
 * over the envelope API without an SDK. Off unless NEXT_PUBLIC_SENTRY_DSN is
 * set at build time. Events are scrubbed of passwords, tokens, CNICs, phone
 * numbers, emails and card numbers before they leave the browser, and carry
 * the API's request id when the error came from an API answer.
 */

/** Where events go, parsed from a DSN: https://<key>@<host>[/<path>]/<project>. */
export interface Dsn {
  envelopeUrl: string;
  publicKey: string;
  origin: string;
}

export function parseDsn(value: string | undefined): Dsn | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const project = segments.pop();
  if (!url.username || !project || !/^https?:$/.test(url.protocol)) return null;
  const base = `${url.protocol}//${url.host}${segments.length ? `/${segments.join("/")}` : ""}`;
  return { envelopeUrl: `${base}/api/${project}/envelope/`, publicKey: decodeURIComponent(url.username), origin: url.origin };
}

const REDACTED = "[redacted]";

/** Keys whose values are always dropped (compared without case, -, _ or spaces). Same list as the API's scrub.ts. */
const SECRET_KEY =
  /pass(word|wd|code)?$|^pwd$|secret|token|authorization|cookie|apikey|accesskey|privatekey|signature|^sig$|salt|hashkey|^otp$|^pin$|^code$|resetcode|cnic|bform|nationalid|phone|mobile|whatsapp|msisdn|^to$|cardnumber|^pan$|^cvv|iban|accountnum|dsn/;

export const isSecretKey = (key: string) => SECRET_KEY.test(key.toLowerCase().replace(/[-_\s]/g, ""));

const TEXT_PATTERNS: [RegExp, string][] = [
  [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[jwt]"],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b(pass(?:word)?|secret|token|api[_-]?key|access[_-]?key|sig|signature|code|otp|salt|hash[_-]?key)(["']?\s*[=:]\s*["']?)[^\s&"',;}]+/gi, "$1$2[redacted]"],
  [/\b\d{5}-\d{7}-\d\b/g, "[cnic]"],
  [/\b(?:\d[ -]?){12,18}\d\b/g, "[number]"],
  [/(?:\+?\b92|\b0)[ -]?3\d{2}[ -]?\d{7}\b/g, "[phone]"],
  [/\+\d[\d ()-]{7,}\d\b/g, "[phone]"],
  [/\b\d{10,12}\b/g, "[phone]"],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]"],
];

/** Masks CNICs, phones, emails, tokens and inline secrets in a piece of text. */
export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TEXT_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** A copy with secret keys redacted and every string scrubbed (depth-limited). */
export function scrub<T>(value: T, depth = 0): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (value === null || typeof value !== "object") return value;
  if (depth > 8) return "[truncated]" as T;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => scrub(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) && v !== null && v !== undefined && v !== "" ? REDACTED : scrub(v, depth + 1);
  }
  return out as T;
}

export interface ReportContext {
  level?: "fatal" | "error" | "warning";
  /** The API's X-Request-Id, when the error came from an API answer. */
  requestId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/** Stack lines (V8 "at f (url:1:2)" or Firefox/Safari "f@url:1:2") as Sentry frames, oldest call first. */
export function parseStack(stack: string | undefined) {
  const frames: { function: string; filename: string; lineno: number; colno: number }[] = [];
  for (const line of (stack ?? "").split("\n").slice(0, 50)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line) ?? /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
    if (m) frames.push({ function: m[1] || "<anonymous>", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

/** The event sent for an error: scrubbed, with the page path but never its query string. */
export function buildEvent(error: unknown, ctx: ReportContext = {}, page?: { path: string; userAgent?: string }) {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-error thrown");
  const event: Record<string, unknown> = scrub({
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: ctx.level ?? "error",
    logger: "web",
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames: parseStack(err.stack) } }] },
    request: page ? { url: page.path, headers: page.userAgent ? { "User-Agent": page.userAgent } : undefined } : undefined,
    tags: ctx.tags,
    extra: ctx.extra,
  });
  if (ctx.requestId) event.tags = { ...(event.tags as object), request_id: ctx.requestId };
  return event;
}

/** The envelope body: header, item header, event (one JSON per line). */
export function envelope(event: Record<string, unknown>) {
  return [JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

const DSN = parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
/** At most this many reports per page load, so a render loop cannot flood the tracker. */
const MAX_REPORTS = 20;
let sent = 0;
const seen = new Set<string>();

export const errorReportingEnabled = () => DSN !== null;

/**
 * Reports an error from the browser; does nothing when the DSN is not set,
 * on the server, or after MAX_REPORTS. The same message is sent once per
 * page load. Never throws.
 */
export function reportError(error: unknown, ctx: ReportContext = {}) {
  if (!DSN || typeof window === "undefined" || sent >= MAX_REPORTS) return;
  try {
    const event = buildEvent(error, ctx, { path: window.location.pathname, userAgent: navigator.userAgent });
    const fingerprint = JSON.stringify((event.exception as { values: { value: string }[] }).values[0].value);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    sent++;
    // Auth in the query string and a text body keep this a simple request (no CORS preflight).
    const url = `${DSN.envelopeUrl}?sentry_version=7&sentry_client=schoolsyncer-web%2F1.0&sentry_key=${encodeURIComponent(DSN.publicKey)}`;
    void fetch(url, { method: "POST", body: envelope(event), headers: { "Content-Type": "text/plain;charset=UTF-8" }, keepalive: true }).catch(() => undefined);
  } catch {
    // Reporting must never break the page.
  }
}
