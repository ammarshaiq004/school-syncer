"use client";

import { useMemo, useState } from "react";
import { Copy, Crown, Pencil, Plus, RotateCcw, ShieldCheck, Trash2, Users } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  SegmentedControl,
  SkeletonCards,
  SkeletonRows,
  Tooltip,
  useToast,
} from "@/components/ui";
import type { BuiltinRole, CustomRole, Matrix, ModuleCatalog, PartialMatrix, RolesResponse } from "@/components/staff/types";
import { api, type AccessLevel, type PermissionModule } from "@/lib/api";
import { cn } from "@/lib/cn";
import { hasRole, useCan, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { LEVEL_RANK, LEVELS, LevelMark, LevelPicker } from "./level-picker";
import { RoleFormDialog, type RoleFormMode } from "./role-form-dialog";

type Selected = { kind: "builtin"; role: BuiltinRole } | { kind: "custom"; role: CustomRole };
const keyOf = (s: Selected) => (s.kind === "builtin" ? `builtin:${s.role.role}` : `custom:${s.role.id}`);
const nameOf = (s: Selected) => s.role.name;

/** Roles and permissions: role cards, a per-role matrix editor and a side-by-side comparison. */
export function RolesManager() {
  const me = useSession();
  const can = useCan();
  const toast = useToast();
  const roles = useApi<RolesResponse>("/roles");
  const catalog = useApi<ModuleCatalog>("/roles/modules");
  const canEdit = can("users", "manage");
  const meOwner = hasRole(me, ["OWNER"]);

  const [view, setView] = useState<"edit" | "compare">("edit");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<PartialMatrix>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [form, setForm] = useState<RoleFormMode | null>(null);
  const [formSeq, setFormSeq] = useState(0);
  const [deleting, setDeleting] = useState<CustomRole | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<"save" | "reset" | "delete" | "duplicate" | null>(null);

  const all: Selected[] = useMemo(
    () => [
      ...(roles.data?.builtin ?? []).map((role) => ({ kind: "builtin" as const, role })),
      ...(roles.data?.custom ?? []).map((role) => ({ kind: "custom" as const, role })),
    ],
    [roles.data],
  );
  // Default to the first editable role (Principal) rather than Owner, which never changes.
  const selected =
    all.find((s) => keyOf(s) === selectedKey) ?? all.find((s) => s.kind === "builtin" && s.role.editable) ?? all[0] ?? null;
  const changed = Object.keys(draft).length;

  function select(key: string) {
    if (selected && key === keyOf(selected)) return;
    if (changed > 0) return setPendingKey(key);
    setSelectedKey(key);
    setDraft({});
  }

  function openForm(mode: RoleFormMode) {
    setFormSeq((n) => n + 1);
    setForm(mode);
  }

  async function afterSaved(role?: CustomRole) {
    await roles.reload();
    if (role) {
      setSelectedKey(`custom:${role.id}`);
      setDraft({});
    }
  }

  function setLevel(module: PermissionModule, level: AccessLevel) {
    if (!selected) return;
    setDraft((d) => {
      const next = { ...d };
      if (selected.role.permissions[module] === level) delete next[module];
      else next[module] = level;
      return next;
    });
  }

  async function save() {
    if (!selected || changed === 0) return;
    setBusy("save");
    try {
      if (selected.kind === "builtin") await api(`/roles/builtin/${selected.role.role}`, { method: "PUT", body: { permissions: draft } });
      else await api(`/roles/${selected.role.id}`, { method: "PATCH", body: { permissions: draft } });
      toast.success("Permissions saved", `${nameOf(selected)}: changes apply on the next page load.`);
      setDraft({});
      await roles.reload();
    } catch (e) {
      toast.error("Could not save permissions", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function resetDefaults() {
    if (selected?.kind !== "builtin") return;
    setBusy("reset");
    try {
      await api(`/roles/builtin/${selected.role.role}`, { method: "PUT", body: { reset: true, permissions: {} } });
      toast.success("Defaults restored", selected.role.name);
      setDraft({});
      setConfirmReset(false);
      await roles.reload();
    } catch (e) {
      toast.error("Could not restore defaults", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(role: CustomRole) {
    setBusy("duplicate");
    try {
      const copy = await api<CustomRole>(`/roles/${role.id}/duplicate`, { method: "POST", body: {} });
      toast.success("Role duplicated", copy.name);
      await afterSaved(copy);
    } catch (e) {
      toast.error("Could not duplicate the role", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy("delete");
    try {
      await api(`/roles/${deleting.id}`, { method: "DELETE" });
      toast.success("Role deleted", deleting.name);
      setDeleting(null);
      setSelectedKey(null);
      setDraft({});
      await roles.reload();
    } catch (e) {
      toast.error("Could not delete the role", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Levels above the editor's own access cannot be granted (owners are never limited). */
  function blockedLevels(module: PermissionModule, saved: AccessLevel): Partial<Record<AccessLevel, string>> | undefined {
    if (meOwner || !me.permissions) return undefined;
    const mine = me.permissions[module] ?? "none";
    const out: Partial<Record<AccessLevel, string>> = {};
    for (const l of ["view", "manage"] as const) {
      if (LEVEL_RANK[l] > LEVEL_RANK[mine] && LEVEL_RANK[l] > LEVEL_RANK[saved]) out[l] = "Higher than your own access";
    }
    return out;
  }

  if (roles.error || catalog.error) {
    return <ErrorState message={roles.error || catalog.error} onRetry={() => (roles.reload(), catalog.reload())} />;
  }
  if (!roles.data || !catalog.data) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonCards count={4} />
        <SkeletonRows rows={8} columns={2} />
      </div>
    );
  }

  const { builtin, custom } = roles.data;
  const groups = catalog.data.groups;
  const readOnly = !canEdit || (selected?.kind === "builtin" && !selected.role.editable);
  const effective = (m: PermissionModule): AccessLevel => draft[m] ?? selected?.role.permissions[m] ?? "none";

  return (
    <div className="flex flex-col gap-6">
      {!canEdit && <Alert tone="info">Your role can see roles and permissions but not change them.</Alert>}

      <section aria-labelledby="builtin-roles" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="builtin-roles" className="text-lg font-semibold text-fg">
              Roles
            </h2>
            <p className="text-[13px] text-fg-muted">Pick a role to see and change what it can do. Owners always have full access.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              aria-label="Layout"
              value={view}
              onChange={setView}
              options={[
                { value: "edit", label: "Edit a role" },
                { value: "compare", label: "Compare all" },
              ]}
            />
            {canEdit && (
              <Button type="button" icon={<Plus />} onClick={() => openForm({ kind: "create" })}>
                New custom role
              </Button>
            )}
          </div>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Built-in roles">
          {builtin.map((r) => (
            <RoleCard
              key={r.role}
              name={r.name}
              members={r.memberCount}
              active={view === "edit" && selected?.kind === "builtin" && selected.role.role === r.role}
              onSelect={() => (setView("edit"), select(`builtin:${r.role}`))}
              badge={
                !r.editable ? (
                  <Badge tone="primary" icon={<Crown />}>
                    Full access
                  </Badge>
                ) : r.customized ? (
                  <Badge tone="warning">Edited</Badge>
                ) : (
                  <Badge tone="neutral">Default</Badge>
                )
              }
            />
          ))}
        </ul>

        <h3 className="mt-2 text-sm font-semibold text-fg">Custom roles</h3>
        {custom.length === 0 ? (
          <Card padding="none">
            <EmptyState
              compact
              icon={<ShieldCheck />}
              title="No custom roles yet"
              description="Create one for jobs the built-in roles do not fit, such as an exam coordinator or a front desk officer."
              action={
                canEdit && (
                  <Button type="button" variant="secondary" icon={<Plus />} onClick={() => openForm({ kind: "create" })}>
                    New custom role
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Custom roles">
            {custom.map((r) => (
              <RoleCard
                key={r.id}
                name={r.name}
                members={r.memberCount}
                description={r.description ?? `Based on ${r.baseRoleName}`}
                active={view === "edit" && selected?.kind === "custom" && selected.role.id === r.id}
                onSelect={() => (setView("edit"), select(`custom:${r.id}`))}
                badge={<Badge tone="info">Custom</Badge>}
              />
            ))}
          </ul>
        )}
      </section>

      {view === "compare" ? (
        <CompareTable groups={groups} builtin={builtin} custom={custom} />
      ) : (
        selected && (
          <Card padding="none">
            <div className="border-b border-border px-5 py-4">
              <CardHeader
                className="mb-0"
                title={`${selected.role.name} permissions`}
                description={
                  selected.kind === "custom"
                    ? `Custom role based on ${selected.role.baseRoleName}. ${selected.role.memberCount} ${selected.role.memberCount === 1 ? "person has" : "people have"} it.`
                    : !selected.role.editable
                      ? "Owners can do everything in the school. This cannot be changed."
                      : selected.role.customized
                        ? "Changed from the SchoolSyncer defaults for this school."
                        : "Using the SchoolSyncer defaults."
                }
                action={
                  canEdit && (
                    <div className="flex flex-wrap gap-2">
                      {selected.kind === "builtin" && selected.role.editable && (
                        <>
                          {selected.role.customized && (
                            <Button type="button" size="sm" variant="secondary" icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>
                              Restore defaults
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            icon={<Copy />}
                            onClick={() =>
                              selected.kind === "builtin" &&
                              openForm({ kind: "copy-builtin", role: selected.role.role, name: selected.role.name, permissions: selected.role.permissions })
                            }
                          >
                            Copy as custom role
                          </Button>
                        </>
                      )}
                      {selected.kind === "custom" && (
                        <>
                          <Button type="button" size="sm" variant="secondary" icon={<Pencil />} onClick={() => openForm({ kind: "edit", role: selected.role })}>
                            Edit details
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            icon={<Copy />}
                            loading={busy === "duplicate"}
                            onClick={() => duplicate(selected.role)}
                          >
                            Duplicate
                          </Button>
                          {selected.role.memberCount > 0 ? (
                            <Tooltip content="Move the people who have this role to another role first.">
                              <span tabIndex={0} className="inline-flex rounded-lg">
                                <Button type="button" size="sm" variant="danger" icon={<Trash2 />} disabled aria-label={`Delete ${selected.role.name} (in use)`}>
                                  Delete
                                </Button>
                              </span>
                            </Tooltip>
                          ) : (
                            <Button type="button" size="sm" variant="danger" icon={<Trash2 />} onClick={() => setDeleting(selected.role)}>
                              Delete
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )
                }
              />
            </div>

            <div className="divide-y divide-border">
              {groups.map((g) => (
                <fieldset key={g.key} className="px-5 py-4">
                  <legend className="sr-only">{g.label}</legend>
                  <p aria-hidden className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    {g.label}
                  </p>
                  <ul className="flex flex-col">
                    {g.modules.map((m) => {
                      const saved = selected.role.permissions[m.key];
                      const value = effective(m.key);
                      const dirty = m.key in draft;
                      const base = selected.kind === "builtin" ? selected.role.defaults[m.key] : undefined;
                      const differs = selected.kind === "builtin" ? saved !== base : m.key in selected.role.overrides;
                      return (
                        <li key={m.key} className={cn("-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5", dirty && "bg-primary-tint")}>
                          <span className="flex min-w-0 items-center gap-2 text-sm text-fg">
                            <span className="truncate">{m.label}</span>
                            {dirty ? (
                              <Badge tone="primary">Unsaved</Badge>
                            ) : (
                              differs && (
                                <span className="text-xs text-fg-muted">{selected.kind === "builtin" ? `Default: ${LEVELS.find((l) => l.value === base)?.label ?? base}` : "Changed from base role"}</span>
                              )
                            )}
                          </span>
                          <LevelPicker
                            label={`${m.label} access for ${selected.role.name}`}
                            value={value}
                            readOnly={readOnly}
                            disabledLevels={readOnly ? undefined : blockedLevels(m.key, saved)}
                            onChange={(l) => setLevel(m.key, l)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ))}
            </div>

            {!readOnly && (
              <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border bg-surface px-5 py-3">
                <span className="me-auto text-[13px] text-fg-muted" aria-live="polite">
                  {changed === 0 ? "No unsaved changes" : `${changed} unsaved ${changed === 1 ? "change" : "changes"}`}
                </span>
                <Button type="button" variant="secondary" disabled={changed === 0 || busy === "save"} onClick={() => setDraft({})}>
                  Discard
                </Button>
                <Button type="button" disabled={changed === 0} loading={busy === "save"} onClick={save}>
                  Save permissions
                </Button>
              </div>
            )}
          </Card>
        )
      )}

      <RoleFormDialog key={formSeq} mode={form} onOpenChange={(o) => !o && setForm(null)} onSaved={(r) => (toast.success("Role saved", r.name), afterSaved(r))} />
      <ConfirmDialog
        open={!!pendingKey}
        onOpenChange={(o) => !o && setPendingKey(null)}
        title="Discard unsaved changes?"
        description={selected ? `Your changes to ${selected.role.name} have not been saved.` : undefined}
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => {
          setSelectedKey(pendingKey);
          setDraft({});
          setPendingKey(null);
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Restore the default permissions?"
        description={selected ? `${selected.role.name} goes back to the SchoolSyncer defaults for every module.` : undefined}
        confirmLabel="Restore defaults"
        loading={busy === "reset"}
        onConfirm={resetDefaults}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this role?"
        description={deleting ? `${deleting.name} is removed for good. Nobody has it right now.` : undefined}
        confirmLabel="Delete role"
        destructive
        loading={busy === "delete"}
        onConfirm={remove}
      />
    </div>
  );
}

function RoleCard({
  name,
  members,
  description,
  badge,
  active,
  onSelect,
}: {
  name: string;
  members: number;
  description?: string;
  badge: React.ReactNode;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className={cn(
          "flex h-full w-full flex-col gap-2 rounded-xl border bg-surface p-4 text-left shadow-card transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
          active ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong",
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="font-display text-base font-semibold text-fg">{name}</span>
          {badge}
        </span>
        {description && <span className="line-clamp-2 text-[13px] text-fg-muted">{description}</span>}
        <span className="mt-auto flex items-center gap-1.5 text-[13px] text-fg-secondary">
          <Users className="size-3.5 text-fg-muted" aria-hidden />
          <span className="tabular-nums">{members}</span> {members === 1 ? "person" : "people"}
        </span>
      </button>
    </li>
  );
}

function CompareTable({ groups, builtin, custom }: { groups: ModuleCatalog["groups"]; builtin: BuiltinRole[]; custom: CustomRole[] }) {
  const cols: { key: string; name: string; permissions: Matrix; custom: boolean }[] = [
    ...builtin.map((r) => ({ key: r.role, name: r.name, permissions: r.permissions, custom: false })),
    ...custom.map((r) => ({ key: r.id, name: r.name, permissions: r.permissions, custom: true })),
  ];
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">Access per module for every role</caption>
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              <th scope="col" className="sticky start-0 bg-surface-2 px-4 py-2.5 text-left text-xs font-semibold text-fg-muted">
                Module
              </th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2.5 text-left text-xs font-semibold text-fg-muted">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {c.name}
                    {c.custom && <span className="size-1.5 rounded-full bg-info" aria-label="Custom role" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key} className="border-t border-border">
              <tr>
                <th colSpan={cols.length + 1} scope="colgroup" className="bg-surface px-4 pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {g.label}
                </th>
              </tr>
              {g.modules.map((m) => (
                <tr key={m.key} className="hover:bg-surface-2">
                  <th scope="row" className="sticky start-0 bg-surface px-4 py-1.5 text-left font-normal text-fg">
                    {m.label}
                  </th>
                  {cols.map((c) => (
                    <td key={c.key} className="px-3 py-1.5">
                      <LevelMark level={c.permissions[m.key] ?? "none"} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Card>
  );
}
