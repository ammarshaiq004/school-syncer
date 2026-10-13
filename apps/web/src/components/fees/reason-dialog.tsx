"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, Button, Dialog, TextField } from "@/components/ui";

/**
 * Asks why before a money correction (voiding a voucher, reversing a payment).
 * The reason is required and goes to the audit log with the change.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  placeholder,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  placeholder?: string;
  /** Throws to show its message in the dialog. */
  onConfirm: (reason: string) => Promise<void>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    setBusy(true);
    try {
      await onConfirm(reason);
      setError("");
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setError("");
      }}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep it
          </Button>
          <Button type="submit" form="fee-reason-form" variant="danger" loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="fee-reason-form" onSubmit={submit} className="flex flex-col gap-3">
        {children}
        <TextField label="Reason" name="reason" required minLength={3} maxLength={300} placeholder={placeholder} autoFocus />
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
