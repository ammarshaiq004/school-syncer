"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Ellipsis, KeyRound, Plus, Power, PowerOff, ShieldCheck, UserPlus, Users } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogClose,
  DropdownItem,
  DropdownMenu,
  IconButton,
  StatusPill,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { GrantEditor, hasDuplicateRows, newRow, rowsFromGrants, rowsToGrants, type GrantRow } from "@/components/staff/grant-editor";
import { platformApi, type Role } from "@/lib/api";
import { day } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { ReasonDialog } from "./reason-dialog";
import { isOwner, useConsoleAdmin } from "./session";
import { TempPassword } from "./temp-password";

interface Person {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: { role: string; campusId: string | null; customRoleId: string | null; campus: { name: string } | null; customRole: { name: string } | null }[];
}

export const STAFF_ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  PRINCIPAL: "Principal",
  ADMIN: "Administrator",
  ACCOUNTANT: "Accountant",
  TEACHER: "Teacher",
  CLASS_TEACHER: "Class teacher",
  STAFF: "Staff",
};

const isStaffGrant = (g: { role: string }) => g.role in STAFF_ROLE_LABELS;
const holdsOwner = (p: Person) => p.roles.some((g) => g.role === "OWNER");
const OWNER_ONLY = "Only a SchoolSyncer owner can change a school owner account";

type ConsoleCustomRole = { id: string; name: string; baseRoleName: string };

function RolePills({ roles }: { roles: Person["roles"] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r, i) => (
        <Badge key={i} tone={r.role === "OWNER" ? "primary" : "neutral"}>
          {r.customRole?.name ?? STAFF_ROLE_LABELS[r.role] ?? r.role}
          {r.campus && <span className="text-fg-muted">, {r.campus.name}</span>}
        </Badge>
      ))}
    </span>
  );
}

/** The console's view of a school's staff accounts: add people, switch them off and on, reset passwords. */
export function SchoolPeople({ schoolId, schoolName, campuses }: { schoolId: string; schoolName: string; campuses: { id: string; name: string }[] }) {
  const toast = useToast();
  // SUPPORT staff may not touch owner accounts or grant Owner; the API refuses, so do not offer it.
  const consoleOwner = isOwner(useConsoleAdmin());
  const people = usePlatformApi<Person[]>(`/schools/${schoolId}/users`);
  const [adding, setAdding] = useState(false);
  const [toggle, setToggle] = useState<Person | null>(null);
  const [toggling, setToggling] = useState(false);
  const [resetFor, setResetFor] = useState<Person | null>(null);
  const [password, setPassword] = useState<{ person: Person; value: string } | null>(null);
  const [rolesFor, setRolesFor] = useState<Person | null>(null);

  // The console has no custom-role list of its own, so offer the ones people at this school already hold.
  const customRoles = useMemo<ConsoleCustomRole[]>(() => {
    const seen = new Map<string, ConsoleCustomRole>();
    for (const p of people.data ?? [])
      for (const g of p.roles)
        if (g.customRoleId && g.customRole && !seen.has(g.customRoleId))
          seen.set(g.customRoleId, { id: g.customRoleId, name: g.customRole.name, baseRoleName: STAFF_ROLE_LABELS[g.role] ?? g.role });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data]);

  async function setActive() {
    if (!toggle) return;
    setToggling(true);
    try {
      await platformApi(`/schools/${schoolId}/users/${toggle.id}`, { method: "PATCH", body: { isActive: !toggle.isActive } });
      toast.success(toggle.isActive ? `${toggle.name} deactivated` : `${toggle.name} can sign in again`);
      setToggle(null);
      await people.reload();
    } catch (e) {
      toast.error("Could not change the account", (e as Error).message);
    } finally {
      setToggling(false);
    }
  }

  async function resetPassword(reason: string) {
    if (!resetFor) return;
    const res = await platformApi<{ temporaryPassword: string }>(`/schools/${schoolId}/users/${resetFor.id}/reset-password`, {
      method: "POST",
      body: { reason },
    });
    setPassword({ person: resetFor, value: res.temporaryPassword });
    setResetFor(null);
  }

  const columns: Column<Person>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (p) => p.name,
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={p.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{p.name}</span>
            <span className="block truncate text-xs text-fg-muted">{[p.email, p.phone].filter(Boolean).join(", ")}</span>
          </span>
        </span>
      ),
    },
    { id: "roles", header: "Roles", cell: (p) => <RolePills roles={p.roles} /> },
    {
      id: "status",
      header: "Status",
      sortValue: (p) => (p.isActive ? 0 : 1),
      cell: (p) => <StatusPill status={p.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      id: "login",
      header: "Last sign-in",
      sortValue: (p) => p.lastLoginAt,
      cell: (p) => (p.lastLoginAt ? day(p.lastLoginAt) : <span className="text-fg-muted">Never</span>),
      hideBelow: "md",
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "48px",
      cell: (p) => {
        const locked = !consoleOwner && holdsOwner(p);
        return (
        <DropdownMenu
          trigger={
            <IconButton size="sm" aria-label={`Actions for ${p.name}`}>
              <Ellipsis />
            </IconButton>
          }
        >
          <DropdownItem icon={<ShieldCheck />} onSelect={() => setRolesFor(p)} disabled={locked} disabledReason={locked ? OWNER_ONLY : undefined}>
            Change roles
          </DropdownItem>
          <DropdownItem
            icon={<KeyRound />}
            onSelect={() => setResetFor(p)}
            disabled={locked || !p.isActive}
            disabledReason={locked ? OWNER_ONLY : !p.isActive ? "Activate the account first" : undefined}
          >
            Reset password
          </DropdownItem>
          {p.isActive ? (
            <DropdownItem icon={<PowerOff />} danger onSelect={() => setToggle(p)} disabled={locked} disabledReason={locked ? OWNER_ONLY : undefined}>
              Deactivate
            </DropdownItem>
          ) : (
            <DropdownItem icon={<Power />} onSelect={() => setToggle(p)} disabled={locked} disabledReason={locked ? OWNER_ONLY : undefined}>
              Activate
            </DropdownItem>
          )}
        </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        label={`People at ${schoolName}`}
        columns={columns}
        data={people.data}
        getRowId={(p) => p.id}
        error={people.error}
        onRetry={people.reload}
        getSearchText={(p) => `${p.name} ${p.email ?? ""} ${p.phone ?? ""}`}
        searchPlaceholder="Search name, email or phone"
        toolbarActions={
          <Button size="sm" icon={<UserPlus />} onClick={() => setAdding(true)}>
            Add person
          </Button>
        }
        pageSize={10}
        empty={{
          icon: <Users />,
          title: "No staff accounts",
          description: "Add the first staff account for this school.",
          action: (
            <Button icon={<Plus />} onClick={() => setAdding(true)}>
              Add person
            </Button>
          ),
        }}
      />

      <AddPersonDialog
        open={adding}
        onOpenChange={setAdding}
        schoolId={schoolId}
        campuses={campuses}
        customRoles={customRoles}
        canGrantOwner={consoleOwner}
        onCreated={(person, value) => {
          setPassword({ person, value });
          void people.reload();
        }}
      />

      <ChangeRolesDialog
        key={rolesFor?.id ?? "none"}
        person={rolesFor}
        onOpenChange={(o) => !o && setRolesFor(null)}
        schoolId={schoolId}
        campuses={campuses}
        customRoles={customRoles}
        canGrantOwner={consoleOwner}
        onSaved={(person) => {
          toast.success(`Roles updated for ${person.name}`, "They apply the next time this person signs in.");
          setRolesFor(null);
          void people.reload();
        }}
      />

      <ConfirmDialog
        open={!!toggle}
        onOpenChange={(o) => !o && setToggle(null)}
        title={toggle?.isActive ? `Deactivate ${toggle?.name}?` : `Activate ${toggle?.name}?`}
        description={
          toggle?.isActive
            ? "They are signed out and cannot sign in until the account is activated again. Recorded in both audit logs."
            : "They can sign in again with their existing password."
        }
        confirmLabel={toggle?.isActive ? "Deactivate" : "Activate"}
        destructive={toggle?.isActive}
        loading={toggling}
        onConfirm={setActive}
      />

      <ReasonDialog
        open={!!resetFor}
        onOpenChange={(o) => !o && setResetFor(null)}
        title={`Reset ${resetFor?.name}'s password?`}
        description="Their current password stops working. You get a temporary password to pass on to them."
        confirmLabel="Reset password"
        reasonLabel="Why are you resetting it?"
        placeholder="Owner called support, locked out after changing phones"
        onSubmit={resetPassword}
      />

      <Dialog
        open={!!password}
        onOpenChange={(o) => !o && setPassword(null)}
        title={`Temporary password for ${password?.person.name ?? ""}`}
        footer={
          <DialogClose asChild>
            <Button type="button">Done</Button>
          </DialogClose>
        }
      >
        {password && (
          <TempPassword
            password={password.value}
            login={password.person.email ?? password.person.phone}
            note="It is shown only once. Pass it on to them over the phone or in person."
          />
        )}
      </Dialog>
    </>
  );
}

function AddPersonDialog({
  open,
  onOpenChange,
  schoolId,
  campuses,
  customRoles,
  canGrantOwner,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  campuses: { id: string; name: string }[];
  customRoles: ConsoleCustomRole[];
  canGrantOwner: boolean;
  onCreated: (person: Person, temporaryPassword: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<GrantRow[]>(() => [newRow("role:PRINCIPAL")]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    if (hasDuplicateRows(rows)) return setError("Remove the repeated role first.");
    setBusy(true);
    setError("");
    try {
      const res = await platformApi<{ user: Person; temporaryPassword: string }>(`/schools/${schoolId}/users`, {
        method: "POST",
        body: {
          name: text("name"),
          email: text("email"),
          phone: text("phone"),
          roles: rowsToGrants(rows),
        },
      });
      onOpenChange(false);
      setRows([newRow("role:PRINCIPAL")]);
      onCreated(res.user, res.temporaryPassword);
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
        if (busy) return;
        if (!o) setError("");
        onOpenChange(o);
      }}
      title="Add a person"
      description="Creates a staff account at this school with a temporary password."
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <TextField label="Full name" name="name" required minLength={2} maxLength={120} placeholder="Bilal Ahmed" wrapperClassName="sm:col-span-2" />
        <TextField label="Email" name="email" type="email" placeholder="bilal@school.pk" />
        <TextField label="Mobile number" name="phone" minLength={10} maxLength={20} placeholder="03001234567" hint="Email or mobile, at least one." />
        <div className="sm:col-span-2">
          <GrantEditor rows={rows} onChange={setRows} customRoles={customRoles} campuses={campuses} canGrantOwner={canGrantOwner} />
        </div>
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" loading={busy}>
            Add person
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Replaces a person's staff roles from the console. Parent or student access is not shown here and is left alone. */
function ChangeRolesDialog({
  person,
  onOpenChange,
  schoolId,
  campuses,
  customRoles,
  canGrantOwner,
  onSaved,
}: {
  person: Person | null;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  campuses: { id: string; name: string }[];
  customRoles: ConsoleCustomRole[];
  canGrantOwner: boolean;
  onSaved: (person: Person) => void;
}) {
  const [rows, setRows] = useState<GrantRow[]>(() => {
    const staff = (person?.roles ?? []).filter(isStaffGrant);
    return staff.length ? rowsFromGrants(staff.map((g) => ({ ...g, role: g.role as Role }))) : [newRow()];
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person) return;
    if (hasDuplicateRows(rows)) return setError("Remove the repeated role first.");
    setBusy(true);
    setError("");
    try {
      await platformApi(`/schools/${schoolId}/users/${person.id}`, { method: "PATCH", body: { roles: rowsToGrants(rows) } });
      onSaved(person);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!person}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
      }}
      title={`Change roles for ${person?.name ?? ""}`}
      description="Replaces their staff roles. Recorded in both audit logs."
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <GrantEditor rows={rows} onChange={setRows} customRoles={customRoles} campuses={campuses} canGrantOwner={canGrantOwner} />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" loading={busy}>
            Save roles
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
