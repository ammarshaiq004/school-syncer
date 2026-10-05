/**
 * Turns a YouTube or Vimeo page link into a privacy-friendly embed URL
 * (youtube-nocookie.com, Vimeo with do-not-track). Anything else returns
 * null and the web opens it in a new tab instead.
 */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

/** "90", "90s", "1m30s", "1h2m3s" -> seconds; anything else -> null. */
export function parseStartTime(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) || null;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds || null;
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') id = parts[0];
  else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1];
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

function vimeoEmbed(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (!VIMEO_HOSTS.has(host)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  let hash: string | null = url.searchParams.get('h');
  if (host === 'player.vimeo.com') {
    if (parts[0] === 'video' && /^\d+$/.test(parts[1] ?? '')) id = parts[1];
  } else {
    const index = parts.findIndex((p) => /^\d+$/.test(p));
    if (index >= 0) {
      id = parts[index];
      // Unlisted videos carry a privacy hash right after the id: vimeo.com/123/abc123.
      const next = parts[index + 1];
      if (!hash && next && /^[0-9a-f]{6,}$/i.test(next)) hash = next;
    }
  }
  if (!id) return null;
  const params = new URLSearchParams();
  if (hash && /^[0-9a-f]+$/i.test(hash)) params.set('h', hash);
  params.set('dnt', '1');
  return `https://player.vimeo.com/video/${id}?${params.toString()}`;
}

export function videoEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const yt = youtubeId(url);
  if (yt) {
    const start = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'));
    return `https://www.youtube-nocookie.com/embed/${yt}${start ? `?start=${start}` : ''}`;
  }
  return vimeoEmbed(url);
}
