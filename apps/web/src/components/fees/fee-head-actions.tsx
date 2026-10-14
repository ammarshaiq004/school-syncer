"use client";

import { useState } from "react";
import { DeleteDialog, EditDialog, RowActions } from "@/components/setup/row-actions";
import { SelectField, TextField } from "@/components/ui";
import { api } from "@/lib/api";

/** Edit and delete for one fee head on the fee setup tab. */
export function FeeHeadActions({
  head,
  onChanged,
}: {
  head: { id: string; name: string; frequency: string };
  onChanged: () => void | Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <RowActions label={head.name} onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} />
      <EditDialog
        open={editing}
        title={`Edit ${head.name}`}
        description="A new billing frequency applies from the next vouchers; vouchers already made keep their lines."
        onClose={() => setEditing(false)}
        save={(f) => api(`/fees/heads/${head.id}`, { method: "PATCH", body: { name: f.get("name"), frequency: f.get("frequency") } })}
        saved={{ message: "Fee head saved", reload: onChanged }}
      >
        <TextField label="Name" name="name" defaultValue={head.name} required />
        <SelectField
          label="Billed"
          name="frequency"
          defaultValue={head.frequency}
          options={[
            { value: "MONTHLY", label: "Every month" },
            { value: "ANNUAL", label: "Once a year (first month)" },
            { value: "ONE_TIME", label: "One time" },
          ]}
        />
      </EditDialog>
      <DeleteDialog
        target={
          deleting
            ? {
                name: head.name,
                path: `/fees/heads/${head.id}`,
                detail: "Only a fee head with no class amounts, concessions or voucher lines can be deleted. Rename it instead if it has been billed.",
              }
            : null
        }
        onClose={() => setDeleting(false)}
        onDeleted={onChanged}
      />
    </>
  );
}
