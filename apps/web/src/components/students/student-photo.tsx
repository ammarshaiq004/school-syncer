"use client";

import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Avatar, Button, IconButton, useToast } from "@/components/ui";
import { uploadFile } from "@/components/elearning/file-upload";
import { api } from "@/lib/api";

/** Same types and size the API accepts (STUDENT_PHOTO in apps/api/src/elearning/files/file-rules.ts). */
const PHOTO_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The student's photo on their profile, with change and remove for staff
 * who manage students. The photo also appears on ID cards and avatars.
 */
export function StudentPhoto({
  studentId,
  name,
  photoUrl,
  canManage,
  onChanged,
}: {
  studentId: string;
  name: string;
  photoUrl: string | null;
  canManage: boolean;
  onChanged: () => void | Promise<unknown>;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error("Photo is too large", "Use a photo up to 5 MB.");
      return;
    }
    setBusy(true);
    try {
      await uploadFile(`/students/${studentId}/photo`, file);
      toast.success("Photo saved");
      await onChanged();
    } catch (e) {
      toast.error("Could not save the photo", (e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/students/${studentId}/photo`, { method: "DELETE" });
      toast.success("Photo removed");
      await onChanged();
    } catch (e) {
      toast.error("Could not remove the photo", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <Avatar name={name} src={photoUrl} size="xl" />
      {canManage && (
        <div className="flex gap-1 print:hidden">
          <input
            ref={input}
            type="file"
            accept={PHOTO_ACCEPT}
            className="sr-only"
            aria-label={`Photo of ${name}`}
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button type="button" size="sm" variant="ghost" icon={<Camera />} loading={busy} onClick={() => input.current?.click()}>
            {photoUrl ? "Change" : "Add photo"}
          </Button>
          {photoUrl && (
            <IconButton size="sm" disabled={busy} onClick={remove} aria-label="Remove photo">
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
