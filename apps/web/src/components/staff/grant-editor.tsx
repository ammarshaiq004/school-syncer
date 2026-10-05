"use client";

import { Plus, X } from "lucide-react";
import { Button, FieldLabel, IconButton, NativeSelect } from "@/components/ui";
import type { Role } from "@/lib/api";
import { ROLE_NAMES, STAFF_ROLES, type Campus, type CustomRole, type GrantInput, type StaffGrant } from "./types";

/** One editable row: a built-in role ("role:TEACHER") or custom role ("custom:<id>") on a campus. */
export interface GrantRow {
  key: string;
  value: string;
  campusId: string;
}

let rowSeq = 0;
export const newRow = (value = "role:TEACHER", campusId = ""): GrantRow => ({ key: `g${++rowSeq}`, value, campusId });

export const rowsFromGrants = (grants: Pick<StaffGrant, "role" | "campusId" | "customRoleId">[]): GrantRow[] =>
  grants.map((g) => newRow(g.customRoleId ? `custom:${g.customRoleId}` : `role:${g.role}`, g.campusId ?? ""));

export function rowsToGrants(rows: GrantRow[]): GrantInput[] {
  return rows.map((r) => {
    const campusId = r.campusId || null;
    return r.value.startsWith("custom:")
      ? { customRoleId: r.value.slice("custom:".length), campusId }
      : { role: r.value.slice("role:".length) as Role, campusId };
  });
}

/** Same role on the same campus twice. */
export const hasDuplicateRows = (rows: GrantRow[]) =>
  new Set(rows.map((r) => `${r.value}|${r.campusId}`)).size !== rows.length;

interface Props {
  rows: GrantRow[];
  onChange: (rows: GrantRow[]) => void;
  customRoles: Pick<CustomRole, "id" | "name" | "baseRoleName">[];
  campuses: Campus[];
  /** Only owners can hand out the Owner role. */
  canGrantOwner: boolean;
}

/** Edits a person's role grants (built-in or custom role, optionally limited to one campus). */
export function GrantEditor({ rows, onChange, customRoles, campuses, canGrantOwner }: Props) {
  const builtins = STAFF_ROLES.filter((r) => r !== "OWNER" || canGrantOwner);
  const update = (key: string, patch: Partial<GrantRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** A new row with the first role and campus pair not already listed, so it never starts as a duplicate. */
  function addRow() {
    const taken = new Set(rows.map((r) => `${r.value}|${r.campusId}`));
    // Teacher first (the common case), then the other built-in roles, then custom roles. Never Owner by default.
    const order: Role[] = ["TEACHER", ...builtins.filter((r) => r !== "TEACHER" && r !== "OWNER")];
    const values = [...order.map((r) => `role:${r}`), ...customRoles.map((c) => `custom:${c.id}`)];
    const campusIds = ["", ...campuses.map((c) => c.id)];
    for (const campusId of campusIds) {
      for (const value of values) {
        if (!taken.has(`${value}|${campusId}`)) return onChange([...rows, newRow(value, campusId)]);
      }
    }
    onChange([...rows, newRow()]);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="contents">
        <FieldLabel required>Roles</FieldLabel>
      </legend>
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => {
          // Keep an Owner grant visible (but not offered) when a non-owner edits someone else's roles.
          const lockedOwner = row.value === "role:OWNER" && !canGrantOwner;
          return (
            <li key={row.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <NativeSelect
                aria-label={`Role ${i + 1}`}
                value={row.value}
                disabled={lockedOwner}
                onChange={(e) => update(row.key, { value: e.target.value })}
                wrapperClassName="w-full sm:flex-1"
              >
                <optgroup label="Built-in roles">
                  {(lockedOwner ? (["OWNER"] as Role[]) : builtins).map((r) => (
                    <option key={r} value={`role:${r}`}>
                      {ROLE_NAMES[r]}
                    </option>
                  ))}
                </optgroup>
                {customRoles.length > 0 && (
                  <optgroup label="Custom roles">
                    {customRoles.map((c) => (
                      <option key={c.id} value={`custom:${c.id}`}>
                        {c.name} (based on {c.baseRoleName})
                      </option>
                    ))}
                  </optgroup>
                )}
              </NativeSelect>
              <NativeSelect
                aria-label={`Campus for role ${i + 1}`}
                value={row.campusId}
                disabled={lockedOwner}
                onChange={(e) => update(row.key, { campusId: e.target.value })}
                options={[{ value: "", label: "All campuses" }, ...campuses.map((c) => ({ value: c.id, label: c.name }))]}
                wrapperClassName="min-w-0 flex-1 sm:w-44 sm:flex-none"
              />
              <IconButton
                aria-label={`Remove role ${i + 1}`}
                size="sm"
                disabled={rows.length === 1 || lockedOwner}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              >
                <X />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <div>
        <Button type="button" variant="ghost" size="sm" icon={<Plus />} onClick={addRow}>
          Add another role
        </Button>
      </div>
      {hasDuplicateRows(rows) && <p className="text-[13px] text-danger-text">The same role and campus is listed twice.</p>}
    </fieldset>
  );
}
