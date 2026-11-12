import { SyllabusStatus } from '@prisma/client';

/** Share of topics done, counting a topic in progress as half done for the progress bar only. */
export function syllabusProgress(topics: { status: SyllabusStatus }[]) {
  const total = topics.length;
  const done = topics.filter((t) => t.status === SyllabusStatus.DONE).length;
  const started = topics.filter((t) => t.status === SyllabusStatus.IN_PROGRESS).length;
  return { total, done, started, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Topic titles typed one per line (or pasted from a list); numbering and bullets are dropped, blanks and repeats ignored. */
export function parseTopicLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const title = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (title && !seen.has(title.toLowerCase())) {
      seen.add(title.toLowerCase());
      out.push(title.slice(0, 160));
    }
  }
  return out;
}
