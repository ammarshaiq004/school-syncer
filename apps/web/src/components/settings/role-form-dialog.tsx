"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Dialog, SelectField, TextareaField, TextField } from "@/components/ui";
import { api, type Role } from "@/lib/api";
import { CUSTOM_ROLE_BASES, ROLE_NAMES, type CustomRole, type Matrix } from "@/components/staff/types";

export type RoleFormMode =
  | { kind: "create" }
  /** Start a custom role from a built-in role's current access. */
  | { kind: "copy-builtin"; role: Role; name: string; permissions: Matrix }
  | { kind: "edit"; role: CustomRole };

const FORM_ID = "role-form";

/** Create, copy or rename a custom role. Mount with a key per mode so the fields reset. */
export function RoleFormDialog({ mode, onOpenChange, onSaved }: { mode: RoleFormMode | null; onOpenChange: (open: boolean) => void; onSaved: (role: CustomRole) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = mode?.kind === "edit" ? mode.role : null;

  const defaults =
    mode?.kind === "edit"
      ? { name: mode.role.name, description: mode.role.description ?? "", base: mode.role.baseRole }
      : mode?.kind === "copy-builtin"
        ? { name: `${mode.name} (custom)`, description: "", base: mode.role }
        : { name: "", description: "", base: "TEACHER" as Role };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    const f = new FormData(event.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const description = String(f.get("description") ?? "").trim();
    const baseRole = String(f.get("baseRole")) as Role;
    setBusy(true);
    setError("");
    try {
      const saved =
        mode.kind === "edit"
          ? await api<CustomRole>(`/roles/${mode.role.id}`, { method: "PATCH", body: { name, description: description || null, baseRole } })
          : await api<CustomRole>("/roles", {
              method: "POST",
              body: {
                name,
                description: description || undefined,
                baseRole,
                ...(mode.kind === "copy-builtin" ? { permissions: mode.permissions } : {}),
              },
            });
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = mode?.kind === "edit" ? "Edit role details" : mode?.kind === "copy-builtin" ? `Copy ${mode.name} as a custom role` : "New custom role";

  return (
    <Dialog
      open={!!mode}
      onOpenChange={onOpenChange}
      title={title}
      description={
        mode?.kind === "create"
          ? "A custom role starts with the access of its base role. Adjust each module after creating it."
          : mode?.kind === "copy-builtin"
            ? "The new role starts with exactly the same access. Change it without touching the original."
            : undefined
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={busy}>
            {editing ? "Save changes" : "Create role"}
          </Button>
        </>
      }
    >
      {mode && (
        <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
          <TextField label="Role name" name="name" required minLength={2} maxLength={80} defaultValue={defaults.name} placeholder="Exam coordinator" />
          <TextareaField
            label="Description"
            name="description"
            rows={2}
            maxLength={300}
            defaultValue={defaults.description}
            placeholder="Prepares date sheets and enters marks for every class."
          />
          <SelectField
            label="Base role"
            name="baseRole"
            defaultValue={defaults.base}
            disabled={mode.kind === "copy-builtin"}
            hint={
              editing
                ? "People with this role keep it. The base role decides which pages they can open; the access below narrows it."
                : "Decides which pages they can open. Access can then be lowered or raised per module."
            }
            options={CUSTOM_ROLE_BASES.map((r) => ({ value: r, label: ROLE_NAMES[r] }))}
          />
          {mode.kind === "copy-builtin" && <input type="hidden" name="baseRole" value={mode.role} />}
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      )}
    </Dialog>
  );
}
