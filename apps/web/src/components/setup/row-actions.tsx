"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Alert, Button, Dialog, DropdownItem, DropdownMenu, IconButton, useToast } from "@/components/ui";
import { api } from "@/lib/api";

/** The "…" menu on a setup row: Edit and Delete, plus any extra items. */
export function RowActions({
  label,
  onEdit,
  onDelete,
  children,
}: {
  /** What the row is, for the button's accessible name ("Grade 1"). */
  label: string;
  onEdit?: () => void;
  onDelete?: () => void;
  children?: ReactNode;
}) {
  return (
    <DropdownMenu
      trigger={
        <IconButton size="sm" aria-label={`Actions for ${label}`}>
          <MoreHorizontal className="size-4" aria-hidden />
        </IconButton>
      }
    >
      {onEdit && (
        <DropdownItem icon={<Pencil />} onSelect={onEdit}>
          Edit
        </DropdownItem>
      )}
      {children}
      {onDelete && (
        <DropdownItem icon={<Trash2 />} danger onSelect={onDelete}>
          Delete
        </DropdownItem>
      )}
    </DropdownMenu>
  );
}

/**
 * Asks before deleting a setup record, then calls DELETE `path`. The API
 * refuses records still in use and says what uses them; that message is
 * shown here so the user knows what to clear first.
 */
export function DeleteDialog({
  target,
  onClose,
  onDeleted,
}: {
  /** `action` replaces "Delete" (e.g. "Remove"); `done` the success message. */
  target: { name: string; path: string; detail?: string; action?: string; done?: string } | null;
  onClose: () => void;
  onDeleted: () => void | Promise<unknown>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!target) return;
    setBusy(true);
    try {
      await api(target.path, { method: "DELETE" });
      toast.success(target.done ?? `${target.name} deleted`);
      setError("");
      onClose();
      await onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError("");
          onClose();
        }
      }}
      title={target ? `${target.action ?? "Delete"} ${target.name}?` : "Delete"}
      description={target?.detail ?? "Only records nothing uses yet can be deleted. This can't be undone."}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="danger" loading={busy} onClick={remove} disabled={Boolean(error)}>
            {target?.action ?? "Delete"}
          </Button>
        </>
      }
    >
      {error && <Alert tone="warning">{error}</Alert>}
    </Dialog>
  );
}

/**
 * A small edit form in a dialog. `save` gets the form's data and returns the
 * API call; errors stay in the dialog.
 */
export function EditDialog({
  open,
  title,
  description,
  onClose,
  save,
  saved,
  children,
  submitLabel = "Save changes",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  save: (form: FormData) => Promise<unknown>;
  /** Toast text and reload after a successful save. */
  saved: { message: string; reload: () => void | Promise<unknown> };
  children: ReactNode;
  submitLabel?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formId = `edit-${title.replace(/\W+/g, "-").toLowerCase()}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await save(new FormData(event.currentTarget));
      setError("");
      onClose();
      toast.success(saved.message);
      await saved.reload();
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
        if (!o) {
          setError("");
          onClose();
        }
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {children}
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
