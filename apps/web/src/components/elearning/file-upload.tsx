"use client";

import { useRef, useState, type DragEvent } from "react";
import { Download, FileArchive, FileAudio, FileImage, FileText, FileVideo, Paperclip, Upload, X, type LucideIcon } from "lucide-react";
import { Button, IconButton, ProgressBar } from "@/components/ui";
import { API_URL, ApiError, getToken } from "@/lib/api";
import { cn } from "@/lib/cn";

/** An uploaded file as the API returns it, with a short-lived link to open it. */
export interface FileLink {
  id: string;
  filename: string;
  mimeType: string;
  kind: FileKind | null;
  size: number;
  createdAt: string;
  url: string;
  urlExpiresAt: string;
}

/** Same as FileLink without the link (lists). */
export type FileInfo = Omit<FileLink, "url" | "urlExpiresAt">;

export type FileKind = "video" | "audio" | "image" | "document" | "archive";

const VIDEO = ".mp4,.webm,.mov,.m4v";
const AUDIO = ".mp3,.m4a,.wav,.ogg";
const IMAGE = ".png,.jpg,.jpeg,.webp,.gif";
const DOCUMENT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv";

/** File picker filters; the API checks the same lists (apps/api/src/elearning/files/file-rules.ts). */
export const ACCEPT = {
  lessonVideo: VIDEO,
  lessonDocument: [DOCUMENT, IMAGE, AUDIO].join(","),
  assignment: [DOCUMENT, IMAGE, AUDIO, ".zip"].join(","),
  submission: [DOCUMENT, IMAGE, AUDIO, ".zip", VIDEO].join(","),
};

const KIND_ICON: Record<FileKind, LucideIcon> = {
  video: FileVideo,
  audio: FileAudio,
  image: FileImage,
  document: FileText,
  archive: FileArchive,
};

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(/\.0$/, "")} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Uploads one file as multipart form data with the school token, reporting
 * progress (fetch cannot report upload progress, so this uses XHR).
 */
export function uploadFile(path: string, file: File, onProgress?: (percent: number) => void): Promise<FileLink> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: { message?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON (a proxy error page); the status explains it.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as FileLink);
      else if (xhr.status === 413) reject(new ApiError(413, "This file is too large to upload."));
      else reject(new ApiError(xhr.status, data?.message ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload did not reach the server. Check the connection and try again."));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

/**
 * Pick or drop one file; it uploads straight away and `onChange` gets the
 * stored file (or null when removed). The file is attached when the form
 * around it is saved.
 */
export function FileUploadField({
  label,
  hint,
  endpoint,
  accept,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  /** e.g. "/elearning/files?purpose=LESSON" or "/student/files" */
  endpoint: string;
  accept: string;
  value: FileInfo | null;
  onChange: (file: FileLink | null) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  async function start(file: File | undefined) {
    if (!file) return;
    setError("");
    setName(file.name);
    setProgress(0);
    try {
      onChange(await uploadFile(endpoint, file, setProgress));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!disabled && progress === null) void start(e.dataTransfer.files[0]);
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      {value ? (
        <FileChip file={value} onRemove={disabled ? undefined : () => onChange(null)} />
      ) : progress !== null ? (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <ProgressBar value={progress} label={`Uploading ${name}`} showValue size="sm" />
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2 px-4 py-5 text-center transition-colors",
            dragging && "border-brand bg-primary-tint",
          )}
        >
          <Upload className="size-5 text-fg-muted" aria-hidden />
          <p className="text-sm text-fg-secondary">Drop a file here, or</p>
          <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={input}
            type="file"
            accept={accept}
            className="sr-only"
            aria-label={label}
            tabIndex={-1}
            onChange={(e) => void start(e.target.files?.[0])}
          />
        </div>
      )}
      {error ? <p className="text-[13px] text-danger">{error}</p> : hint ? <p className="text-[13px] text-fg-muted">{hint}</p> : null}
    </div>
  );
}

/** A file's name, type and size, with an Open link when it has one and an optional remove button. */
export function FileChip({ file, onRemove, className }: { file: FileInfo | FileLink; onRemove?: () => void; className?: string }) {
  const Icon = file.kind ? KIND_ICON[file.kind] : Paperclip;
  const url = "url" in file ? file.url : null;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{file.filename}</p>
        <p className="text-[13px] text-fg-muted">{formatBytes(file.size)}</p>
      </div>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
          <Download className="size-3.5" aria-hidden />
          Open
        </a>
      )}
      {onRemove && (
        <IconButton aria-label={`Remove ${file.filename}`} onClick={onRemove}>
          <X />
        </IconButton>
      )}
    </div>
  );
}

/** Plays or shows an uploaded lesson file: video and audio players, images inline, anything else as a file to open. */
export function FileViewer({ file, title }: { file: FileLink; title: string }) {
  if (file.kind === "video") {
    return (
      <video controls preload="metadata" playsInline src={file.url} className="aspect-video w-full bg-black" aria-label={`Video: ${title}`}>
        <a href={file.url}>Download the video</a>
      </video>
    );
  }
  if (file.kind === "audio") {
    return (
      <div className="p-5">
        <audio controls preload="metadata" src={file.url} className="w-full" aria-label={`Audio: ${title}`} />
      </div>
    );
  }
  if (file.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not a static asset
    return <img src={file.url} alt={title} className="max-h-[70vh] w-full bg-surface-3 object-contain" />;
  }
  return (
    <div className="p-5">
      <FileChip file={file} />
    </div>
  );
}
