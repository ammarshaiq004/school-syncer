"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Dialog, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { GrantEditor, hasDuplicateRows, rowsFromGrants, rowsToGrants, type GrantRow } from "./grant-editor";
import { TempPassword } from "./temp-password";
import type { Campus, CustomRole, StaffUser } from "./types";

const EDIT_FORM = "edit-staff-form";

/** Name, email and phone. Mount with a key per user so the fields reset. */
export function EditStaffDialog({ user, onOpenChange, onSaved }: { user: StaffUser | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const f = new FormData(event.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const phone = String(f.get("phone") ?? "").trim();
    if (!email && !phone) return setError("Keep an email or a phone number so they can sign in.");
    setBusy(true);
    setError("");
    try {
      await api(`/users/${user.id}`, {
        method: "PATCH",
        body: { name: String(f.get("name") ?? "").trim(), email: email || null, phone: phone || null },
      });
      toast.success("Details saved", user.name);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!user}
      onOpenChange={onOpenChange}
      title="Edit details"
      description={user ? `Contact details and sign-in for ${user.name}.` : undefined}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={EDIT_FORM} loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      {user && (
        <form id={EDIT_FORM} onSubmit={submit} className="flex flex-col gap-4">
          <TextField label="Full name" name="name" required minLength={2} defaultValue={user.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Email" name="email" type="email" defaultValue={user.email ?? ""} />
            <TextField label="Phone" name="phone" inputMode="tel" defaultValue={user.phone ?? ""} />
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      )}
    </Dialog>
  );
}

interface RolesDialogProps {
  user: StaffUser | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  customRoles: CustomRole[];
  campuses: Campus[];
  canGrantOwner: boolean;
}

/** Replaces a person's role grants. Mount with a key per user. */
export function ChangeRolesDialog({ user, onOpenChange, onSaved, customRoles, campuses, canGrantOwner }: RolesDialogProps) {
  const toast = useToast();
  const [rows, setRows] = useState<GrantRow[]>(() => (user ? rowsFromGrants(user.roles) : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!user) return;
    if (rows.length === 0) return setError("Give them at least one role.");
    if (hasDuplicateRows(rows)) return setError("Remove the repeated role first.");
    setBusy(true);
    setError("");
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: { roles: rowsToGrants(rows) } });
      toast.success("Roles updated", `${user.name} gets the new access the next time they sign in.`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!user}
      onOpenChange={onOpenChange}
      size="lg"
      title="Change roles"
      description={user ? `What ${user.name} can do in SchoolSyncer. Changes apply at their next sign-in.` : undefined}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" loading={busy} onClick={save}>
            Save roles
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <GrantEditor rows={rows} onChange={setRows} customRoles={customRoles} campuses={campuses} canGrantOwner={canGrantOwner} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}

/** Shows the temporary password after a reset. */
export function PasswordResultDialog({ result, onClose }: { result: { user: StaffUser; password: string } | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!result}
      onOpenChange={(o) => !o && onClose()}
      title="New temporary password"
      footer={
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      }
    >
      {result && <TempPassword name={result.user.name} login={result.user.email ?? result.user.phone} password={result.password} />}
    </Dialog>
  );
}
