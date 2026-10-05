import type { LessonKind } from '@prisma/client';

/** Whole-number completion percentage; an empty course is 0%. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

/**
 * A reorder request must name every existing item exactly once. Returns the
 * problem as user-facing text, or null when the order can be applied.
 */
export function reorderProblem(existing: string[], requested: string[]): string | null {
  if (new Set(requested).size !== requested.length) return 'The new order lists an item twice';
  if (requested.length !== existing.length) return 'The new order must list every item exactly once';
  const known = new Set(existing);
  if (requested.some((id) => !known.has(id))) return 'The new order lists an item that is not here';
  return null;
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * What a lesson of each kind needs before it can be saved. Video and document
 * lessons take a link or an uploaded file (`fileId`); the file wins when both
 * are set.
 */
export function lessonContentProblem(lesson: {
  kind: LessonKind;
  body?: string | null;
  url?: string | null;
  fileId?: string | null;
}): string | null {
  const body = lesson.body?.trim();
  const url = lesson.url?.trim();
  if (url && !isHttpsUrl(url)) return 'Links must start with https://';
  const takesFile = lesson.kind === 'VIDEO' || lesson.kind === 'DOCUMENT';
  if (lesson.fileId && !takesFile) return 'Only video and document lessons can have an uploaded file';
  if (lesson.kind === 'TEXT') return body ? null : 'A text lesson needs some content';
  if (!url && !(takesFile && lesson.fileId)) {
    return lesson.kind === 'VIDEO'
      ? 'A video lesson needs a video link or an uploaded video'
      : lesson.kind === 'DOCUMENT'
        ? 'A document lesson needs a link or an uploaded file'
        : 'A link lesson needs a link';
  }
  return null;
}

/** The items either side of `id` in a flat ordered list (for lesson prev/next). */
export function neighbours<T extends { id: string }>(items: T[], id: string): { prev: T | null; next: T | null } {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { prev: null, next: null };
  return { prev: items[index - 1] ?? null, next: items[index + 1] ?? null };
}
