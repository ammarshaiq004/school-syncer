import { FilePurpose } from '@prisma/client';

/**
 * What can be uploaded to the e-school and how big it may be. The type comes
 * from the file name's extension and must match the file's first bytes, so a
 * renamed executable or HTML page is refused. Browsers never get to choose
 * the stored content type.
 */
export type FileKind = 'video' | 'audio' | 'image' | 'document' | 'archive';

const MB = 1024 * 1024;

interface FileType {
  kind: FileKind;
  mime: string;
  /** Does the start of the file look like this type? */
  sniff: (head: Buffer) => boolean;
}

const startsWith = (head: Buffer, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((b, i) => head[offset + i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

const pdf = (h: Buffer) => startsWith(h, ascii('%PDF-'));
const zip = (h: Buffer) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]);
/** Old Office formats (.doc, .xls, .ppt) are OLE compound files. */
const ole = (h: Buffer) => startsWith(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** MP4, MOV and M4A all start with a size then "ftyp". */
const isoMedia = (h: Buffer) => startsWith(h, ascii('ftyp'), 4);
const riff = (h: Buffer, form: string) => startsWith(h, ascii('RIFF')) && startsWith(h, ascii(form), 8);
/** Text has no NUL bytes; an empty file is not useful either. */
const text = (h: Buffer) => h.length > 0 && !h.includes(0);

const TYPES: Record<string, FileType> = {
  mp4: { kind: 'video', mime: 'video/mp4', sniff: isoMedia },
  m4v: { kind: 'video', mime: 'video/mp4', sniff: isoMedia },
  mov: { kind: 'video', mime: 'video/quicktime', sniff: isoMedia },
  webm: { kind: 'video', mime: 'video/webm', sniff: (h) => startsWith(h, [0x1a, 0x45, 0xdf, 0xa3]) },
  mp3: {
    kind: 'audio',
    mime: 'audio/mpeg',
    sniff: (h) => startsWith(h, ascii('ID3')) || (h.length > 1 && h[0] === 0xff && (h[1] & 0xe0) === 0xe0),
  },
  m4a: { kind: 'audio', mime: 'audio/mp4', sniff: isoMedia },
  wav: { kind: 'audio', mime: 'audio/wav', sniff: (h) => riff(h, 'WAVE') },
  ogg: { kind: 'audio', mime: 'audio/ogg', sniff: (h) => startsWith(h, ascii('OggS')) },
  png: { kind: 'image', mime: 'image/png', sniff: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { kind: 'image', mime: 'image/jpeg', sniff: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  jpeg: { kind: 'image', mime: 'image/jpeg', sniff: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  gif: { kind: 'image', mime: 'image/gif', sniff: (h) => startsWith(h, ascii('GIF8')) },
  webp: { kind: 'image', mime: 'image/webp', sniff: (h) => riff(h, 'WEBP') },
  pdf: { kind: 'document', mime: 'application/pdf', sniff: pdf },
  doc: { kind: 'document', mime: 'application/msword', sniff: ole },
  xls: { kind: 'document', mime: 'application/vnd.ms-excel', sniff: ole },
  ppt: { kind: 'document', mime: 'application/vnd.ms-powerpoint', sniff: ole },
  docx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sniff: zip,
  },
  xlsx: { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sniff: zip },
  pptx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sniff: zip,
  },
  txt: { kind: 'document', mime: 'text/plain', sniff: text },
  csv: { kind: 'document', mime: 'text/csv', sniff: text },
  zip: { kind: 'archive', mime: 'application/zip', sniff: zip },
};

/** Largest file of each kind, per purpose, in bytes. A kind missing here is not allowed. */
export const LIMITS: Record<FilePurpose, Partial<Record<FileKind, number>>> = {
  LESSON: { video: 500 * MB, audio: 50 * MB, image: 10 * MB, document: 25 * MB },
  ASSIGNMENT: { audio: 50 * MB, image: 10 * MB, document: 25 * MB, archive: 50 * MB },
  SUBMISSION: { video: 100 * MB, audio: 50 * MB, image: 10 * MB, document: 25 * MB, archive: 50 * MB },
};

/** Bytes the type check needs from the start of a file. */
export const SNIFF_BYTES = 4096;

const KIND_LABEL: Record<FileKind, string> = {
  video: 'videos',
  audio: 'audio',
  image: 'images',
  document: 'documents',
  archive: 'zip files',
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** The extensions a purpose accepts, for the file picker and error messages. */
export function acceptedExtensions(purpose: FilePurpose): string[] {
  return Object.entries(TYPES)
    .filter(([, t]) => LIMITS[purpose][t.kind] !== undefined)
    .map(([ext]) => ext);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1).replace(/\.0$/, '')} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type FileCheck =
  | { ok: true; ext: string; kind: FileKind; mime: string }
  | { ok: false; problem: string };

/** Checks an upload's name, size and first bytes for a purpose. */
export function checkFile(purpose: FilePurpose, filename: string, size: number, head: Buffer): FileCheck {
  const ext = extensionOf(filename);
  const type = TYPES[ext];
  const limit = type ? LIMITS[purpose][type.kind] : undefined;
  if (!type || limit === undefined) {
    return {
      ok: false,
      problem: `This file type is not allowed here. Use ${acceptedExtensions(purpose).join(', ')}.`,
    };
  }
  if (size <= 0) return { ok: false, problem: 'The file is empty' };
  if (size > limit) {
    return {
      ok: false,
      problem: `This file is ${formatBytes(size)}. ${capitalise(KIND_LABEL[type.kind])} can be up to ${formatBytes(limit)}.`,
    };
  }
  if (!type.sniff(head)) {
    return { ok: false, problem: `This file does not look like a real .${ext} file` };
  }
  return { ok: true, ext, kind: type.kind, mime: type.mime };
}

export function kindOfMime(mime: string): FileKind | null {
  return Object.values(TYPES).find((t) => t.mime === mime)?.kind ?? null;
}

/**
 * The name kept for downloads: no folders, control characters or quotes, at
 * most 160 characters, and the extension kept when it has to be shortened.
 */
export function cleanFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').replace(/\s+/g, ' ').trim();
  const name = cleaned.replace(/^\.+/, '') || 'file';
  if (name.length <= 160) return name;
  const ext = extensionOf(name);
  return ext ? `${name.slice(0, 159 - ext.length)}.${ext}` : name.slice(0, 160);
}

/** Inline for things a browser shows safely (players, images, PDF); download for the rest. */
export function dispositionFor(mime: string): 'inline' | 'attachment' {
  const kind = kindOfMime(mime);
  return kind === 'video' || kind === 'audio' || kind === 'image' || mime === 'application/pdf'
    ? 'inline'
    : 'attachment';
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266). */
export function contentDisposition(mime: string, filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${dispositionFor(mime)}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Storage used against the plan's allowance. Null limit = unlimited. */
export function storageProblem(usedBytes: number, addingBytes: number, limitMb: number | null): string | null {
  if (limitMb === null) return null;
  const limit = limitMb * MB;
  if (usedBytes + addingBytes <= limit) return null;
  return `The school has used ${formatBytes(usedBytes)} of its ${formatBytes(limit)} file storage. Delete old files or upgrade the plan to upload this.`;
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
