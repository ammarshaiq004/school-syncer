"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, Button, DialogClose, Dialog, TextareaField } from "@/components/ui";

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Shown above the reason box, e.g. what the school will see. */
  children?: ReactNode;
  reasonLabel?: string;
  placeholder?: string;
  /** Throw to show the error in the dialog; resolve to close it. */
  onSubmit: (reason: string) => Promise<void>;
}

/** Asks for a written reason (5 to 500 characters) before a recorded console action. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  children,
  reasonLabel = "Reason",
  placeholder,
  onSubmit,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();
  const tooShort = trimmed.length < 5;

  function change(next: boolean) {
    if (busy) return;
    if (!next) {
      setReason("");
      setError("");
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (tooShort) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(trimmed);
      setReason("");
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change} title={title} description={description}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {children}
        <TextareaField
          label={reasonLabel}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          required
          placeholder={placeholder}
          hint={`Recorded in the audit log. ${trimmed.length}/500 characters, at least 5.`}
          autoFocus
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" variant={destructive ? "danger" : "primary"} loading={busy} disabled={tooShort}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
