"use client";

import { useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { Alert, Button, Dialog, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { GrantEditor, hasDuplicateRows, newRow, rowsToGrants, type GrantRow } from "./grant-editor";
import { TempPassword } from "./temp-password";
import type { Campus, CustomRole, StaffUser } from "./types";

const FORM_ID = "invite-staff-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customRoles: CustomRole[];
  campuses: Campus[];
  canGrantOwner: boolean;
  onCreated: () => void;
}

/** Adds a staff login. The API generates a temporary password, shown here once. */
export function InviteStaffDialog({ open, onOpenChange, customRoles, campuses, canGrantOwner, onCreated }: Props) {
  const toast = useToast();
  const [rows, setRows] = useState<GrantRow[]>(() => [newRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ user: StaffUser; password: string } | null>(null);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // Reset after the closing animation so the password does not flash away.
      setTimeout(() => {
        setCreated(null);
        setRows([newRow()]);
        setError("");
      }, 200);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const phone = String(f.get("phone") ?? "").trim();
    if (!email && !phone) return setError("Give an email or a phone number so they can sign in.");
    if (hasDuplicateRows(rows)) return setError("Remove the repeated role first.");
    setBusy(true);
    setError("");
    try {
      const res = await api<StaffUser & { temporaryPassword?: string }>("/users", {
        method: "POST",
        body: { name: String(f.get("name") ?? "").trim(), email: email || undefined, phone: phone || undefined, roles: rowsToGrants(rows) },
      });
      onCreated();
      if (res.temporaryPassword) setCreated({ user: res, password: res.temporaryPassword });
      else {
        toast.success("Staff member added", res.name);
        close(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={created ? `${created.user.name} can now sign in` : "Invite staff"}
      description={created ? undefined : "They sign in with their email or phone and a temporary password."}
      footer={
        created ? (
          <Button type="button" onClick={() => close(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={busy} icon={<UserPlus />}>
              Create login
            </Button>
          </>
        )
      }
    >
      {created ? (
        <TempPassword name={created.user.name} login={created.user.email ?? created.user.phone} password={created.password} />
      ) : (
        <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
          <TextField label="Full name" name="name" required minLength={2} placeholder="Sana Iqbal" autoComplete="off" />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Email" name="email" type="email" placeholder="sana.iqbal@school.pk" autoComplete="off" />
            <TextField label="Phone" name="phone" inputMode="tel" placeholder="03001234567" hint="Email or phone is required" autoComplete="off" />
          </div>
          <GrantEditor rows={rows} onChange={setRows} customRoles={customRoles} campuses={campuses} canGrantOwner={canGrantOwner} />
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      )}
    </Dialog>
  );
}
