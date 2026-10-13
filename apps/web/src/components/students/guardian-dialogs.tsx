"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Dialog, TextField, useToast } from "@/components/ui";
import { Select } from "@/components/select";
import { api } from "@/lib/api";
import { formatCnic, saveWarnings, type SaveWarning } from "@/lib/identity";

export const RELATIONS = ["Father", "Mother", "Guardian", "Uncle", "Aunt", "Grandparent", "Brother", "Sister"];

export interface GuardianLink {
  guardianId: string;
  relation: string;
  isPrimary: boolean;
  guardian: {
    name: string;
    phone: string;
    cnic: string | null;
    email?: string | null;
    occupation?: string | null;
    userId: string | null;
  };
}

const relationOptions = (current?: string) =>
  [...new Set([...(current ? [current] : []), ...RELATIONS])].map((r) => ({ value: r, label: r }));

/** The warnings a save came back with, listed so the user can confirm or correct. */
export function WarningList({ warnings }: { warnings: SaveWarning[] }) {
  return (
    <Alert tone="warning" title="Check before saving" className="sm:col-span-2">
      <ul className="flex list-disc flex-col gap-1 ps-4">
        {warnings.map((w, i) => (
          <li key={i}>{w.message}</li>
        ))}
      </ul>
    </Alert>
  );
}

/**
 * Adds a guardian to a student, or edits one (`link` given). The phone is
 * stored as 03XXXXXXXXX and the CNIC as 13 digits whatever way they are
 * typed. A phone already saved under another name comes back as a warning:
 * the user links the sibling's guardian or corrects the details.
 */
export function GuardianDialog({
  studentId,
  link,
  open,
  onClose,
  onSaved,
}: {
  studentId: string;
  link?: GuardianLink | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<SaveWarning[] | null>(null);
  const [primary, setPrimary] = useState(false);
  const editing = Boolean(link);
  const formId = editing ? "edit-guardian-form" : "add-guardian-form";

  function close() {
    setError("");
    setWarnings(null);
    setPrimary(false);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    setBusy(true);
    try {
      if (link) {
        await api(`/students/${studentId}/guardians/${link.guardianId}`, {
          method: "PATCH",
          body: {
            name: text("name"),
            phone: text("phone"),
            relation: text("relation"),
            cnic: text("cnic") || null,
            email: text("email") || null,
            occupation: text("occupation") || null,
          },
        });
      } else {
        await api(`/students/${studentId}/guardians`, {
          method: "POST",
          body: {
            name: text("name"),
            phone: text("phone"),
            relation: text("relation"),
            cnic: text("cnic") || undefined,
            email: text("email") || undefined,
            occupation: text("occupation") || undefined,
            isPrimary: primary,
            confirmed: warnings !== null,
          },
        });
      }
      toast.success(editing ? "Guardian saved" : "Guardian added");
      close();
      await onSaved();
    } catch (e) {
      const found = saveWarnings(e);
      if (found) {
        setWarnings(found);
        setError("");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  const g = link?.guardian;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={editing ? `Edit ${g?.name}` : "Add a guardian"}
      description={
        editing
          ? "Name, phone and CNIC are shared with this guardian's other children. A new phone also becomes their app login."
          : "A second parent or another guardian. A phone already saved for a sibling's guardian links to them."
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {warnings ? "Link anyway" : editing ? "Save guardian" : "Add guardian"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2" onChange={() => warnings && setWarnings(null)}>
        <TextField label="Name" name="name" defaultValue={g?.name ?? ""} required />
        <TextField label="Phone (WhatsApp)" name="phone" type="tel" defaultValue={g?.phone ?? ""} placeholder="0300 1234567" required />
        <Select label="Relation" name="relation" defaultValue={link?.relation ?? "Mother"} options={relationOptions(link?.relation)} />
        <TextField label="CNIC" name="cnic" defaultValue={formatCnic(g?.cnic)} placeholder="35202-1234567-1" />
        <TextField label="Email" name="email" type="email" defaultValue={g?.email ?? ""} />
        <TextField label="Occupation" name="occupation" defaultValue={g?.occupation ?? ""} />
        {!editing && (
          <Checkbox
            className="sm:col-span-2"
            checked={primary}
            onCheckedChange={setPrimary}
            label="Make this the primary guardian (messages go to them first)"
          />
        )}
        {warnings && <WarningList warnings={warnings} />}
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
