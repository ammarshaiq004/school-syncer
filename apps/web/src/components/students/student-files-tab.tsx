"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FileChip, FileUploadField, type FileLink } from "@/components/elearning/file-upload";
import { SelectField, TextareaField, TextField } from "@/components/kit/inputs";
import { Alert, Button, EmptyState, ErrorState, IconButton, SkeletonRows, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const FILE_TYPES = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp";

interface StudentDoc {
  id: string;
  type: string;
  title: string;
  createdAt: string;
  file: FileLink;
}
interface StudentNoteRow {
  id: string;
  body: string;
  createdAt: string;
  by: string | null;
}

const stamp = (iso: string) => `${day(iso)}, ${new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}`;

/** Documents (B-Form, previous result card, ...) and internal notes. Office staff only. */
export function StudentFilesTab({ studentId }: { studentId: string }) {
  const toast = useToast();
  const docs = useApi<StudentDoc[]>(`/students/${studentId}/documents`);
  const notes = useApi<StudentNoteRow[]>(`/students/${studentId}/notes`);
  const types = useApi<string[]>("/students/config/document-types");
  const [upload, setUpload] = useState<FileLink | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState("");

  async function addDoc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    if (!upload) return setError("Choose a file first.");
    setBusy(true);
    try {
      await api(`/students/${studentId}/documents`, {
        method: "POST",
        body: { fileId: upload.id, type: String(f.get("type")), title: String(f.get("title")) },
      });
      setUpload(null);
      setError("");
      form.reset();
      docs.reload();
      toast.success("Document saved", "It is on the student's file.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc(id: string) {
    try {
      await api(`/students/${studentId}/documents/${id}`, { method: "DELETE" });
      docs.reload();
    } catch (e) {
      toast.error("Could not remove", (e as Error).message);
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    try {
      await api(`/students/${studentId}/notes`, { method: "POST", body: { body } });
      form.reset();
      setNoteError("");
      notes.reload();
    } catch (e) {
      setNoteError((e as Error).message);
    }
  }

  async function removeNote(id: string) {
    try {
      await api(`/students/${studentId}/notes/${id}`, { method: "DELETE" });
      notes.reload();
    } catch (e) {
      toast.error("Could not remove", (e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="docs-title" className="space-y-3">
        <h3 id="docs-title" className="text-sm font-semibold text-fg">
          Documents
        </h3>
        {docs.error && !docs.data ? (
          <ErrorState message={docs.error} onRetry={docs.reload} compact />
        ) : !docs.data ? (
          <SkeletonRows rows={2} columns={1} />
        ) : docs.data.length === 0 ? (
          <EmptyState title="No documents yet" description="Add the B-Form, previous result card or any other paper below." />
        ) : (
          <ul className="space-y-2">
            {docs.data.map((d) => (
              <li key={d.id} className="space-y-1">
                <p className="text-[13px] text-fg-muted">
                  {d.type} · {d.title} · {day(d.createdAt)}
                </p>
                <div className="flex items-center gap-2">
                  <FileChip file={d.file} className="flex-1" />
                  <IconButton aria-label={`Remove ${d.title}`} onClick={() => removeDoc(d.id)}>
                    <Trash2 />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addDoc} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <SelectField label="Type" name="type" options={(types.data ?? []).map((t) => ({ value: t, label: t }))} />
          <TextField label="Title" name="title" required maxLength={120} placeholder="e.g. B-Form of Sara" />
          <div className="sm:col-span-2">
            <FileUploadField label="File" hint="A PDF, Word file or photo, up to 10 MB." endpoint="/students/files/upload" accept={FILE_TYPES} value={null} onChange={setUpload} disabled={busy} />
            {upload && <FileChip file={upload} onRemove={() => setUpload(null)} className="mt-2" />}
          </div>
          {error && (
            <Alert tone="danger" className="sm:col-span-2">
              {error}
            </Alert>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" icon={<Plus />} loading={busy}>
              Add document
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="notes-title" className="space-y-3">
        <h3 id="notes-title" className="text-sm font-semibold text-fg">
          Internal notes
        </h3>
        <p className="text-[13px] text-fg-muted">Only office staff see these. Parents and students do not.</p>
        <form onSubmit={addNote} className="space-y-2">
          <TextareaField label="New note" name="body" rows={2} maxLength={2000} required />
          {noteError && <Alert tone="danger">{noteError}</Alert>}
          <Button type="submit" variant="secondary" icon={<Plus />}>
            Add note
          </Button>
        </form>
        {notes.error && !notes.data ? (
          <ErrorState message={notes.error} onRetry={notes.reload} compact />
        ) : !notes.data ? (
          <SkeletonRows rows={2} columns={1} />
        ) : (
          <ul className="space-y-2">
            {notes.data.map((n) => (
              <li key={n.id} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-sm text-fg">{n.body}</p>
                  <p className="mt-1 text-[13px] text-fg-muted">
                    {n.by ?? "Staff"} · {stamp(n.createdAt)}
                  </p>
                </div>
                <IconButton aria-label="Remove note" onClick={() => removeNote(n.id)}>
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
