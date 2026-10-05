"use client";

import { useState, type FormEvent } from "react";
import { Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Select } from "@/components/select";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  DataTable,
  Drawer,
  KpiCard,
  NativeSelect,
  PageHeader,
  StatGrid,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { api, type Role } from "@/lib/api";
import { day } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  lastLoginAt: string | null;
  roles: { role: Role; campusId: string | null }[];
}
interface Campus { id: string; name: string }

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "PRINCIPAL", label: "Principal" },
  { value: "ADMIN", label: "Admin / front office" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "TEACHER", label: "Teacher" },
  { value: "CLASS_TEACHER", label: "Class teacher" },
  { value: "STAFF", label: "Staff" },
  { value: "OWNER", label: "Owner" },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])) as Record<string, string>;
const FORM_ID = "add-user-form";

export default function UsersPage() {
  const users = useApi<User[]>("/users");
  const campuses = useApi<Campus[]>("/campuses");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const campusName = (id: string | null) =>
    id ? (campuses.data?.find((c) => c.id === id)?.name ?? "campus") : "all campuses";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setBusy(true);
    try {
      await api("/users", {
        method: "POST",
        body: {
          name: f.get("name"),
          email: f.get("email") || undefined,
          phone: f.get("phone") || undefined,
          password: f.get("password"),
          roles: [{ role: f.get("role"), campusId: f.get("campusId") || null }],
        },
      });
      formEl.reset();
      setError("");
      setOpen(false);
      toast.success("User added", String(f.get("name") ?? ""));
      await users.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = users.data?.filter((u) => !roleFilter || u.roles.some((r) => r.role === roleFilter)) ?? users.data;
  const loading = !users.data && !users.error;
  const neverSignedIn = users.data?.filter((u) => !u.lastLoginAt).length ?? 0;
  const teachers = users.data?.filter((u) => u.roles.some((r) => r.role === "TEACHER" || r.role === "CLASS_TEACHER")).length ?? 0;

  const columns: Column<User>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (u) => u.name,
      cell: (u) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={u.name} size="xs" />
          <span className="font-medium text-fg">{u.name}</span>
        </span>
      ),
    },
    { id: "login", header: "Login", sortValue: (u) => u.email ?? u.phone ?? "", cell: (u) => <span className="text-fg-secondary">{u.email ?? u.phone}</span>, hideBelow: "md" },
    {
      id: "roles",
      header: "Roles",
      cell: (u) => (
        <span className="flex flex-wrap gap-1.5">
          {u.roles.map((r, i) => (
            <Badge key={`${r.role}-${r.campusId ?? "all"}-${i}`} tone={r.role === "OWNER" || r.role === "PRINCIPAL" ? "primary" : "neutral"}>
              {ROLE_LABEL[r.role] ?? r.role.toLowerCase()}
              <span className="font-normal text-fg-muted">, {campusName(r.campusId)}</span>
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: "last",
      header: "Last sign-in",
      align: "right",
      sortValue: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt) : null),
      cell: (u) => (u.lastLoginAt ? day(u.lastLoginAt) : <span className="text-fg-muted">Never</span>),
      hideBelow: "sm",
    },
  ];

  const addButton = (
    <Button type="button" icon={<Plus />} onClick={() => setOpen(true)}>
      Add user
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users and roles"
        description="Who can sign in to SchoolSyncer, and what each person can do."
        breadcrumbs={[{ label: "Setup" }, { label: "Users" }]}
        actions={addButton}
      />
      <StatGrid cols={3}>
        <KpiCard label="Staff accounts" value={users.data?.length ?? 0} icon={<Users />} error={!users.data && !!users.error} loading={loading} />
        <KpiCard label="Teaching staff" value={teachers} icon={<ShieldCheck />} tone="info" error={!users.data && !!users.error} loading={loading} />
        <KpiCard label="Never signed in" value={neverSignedIn} icon={<UserPlus />} tone="warning" error={!users.data && !!users.error} loading={loading} />
      </StatGrid>
      <DataTable
        label="Users"
        columns={columns}
        data={rows}
        getRowId={(u) => u.id}
        error={users.error}
        onRetry={users.reload}
        getSearchText={(u) => `${u.name} ${u.email ?? ""} ${u.phone ?? ""}`}
        searchPlaceholder="Search name, email or phone"
        filters={
          <NativeSelect
            aria-label="Filter by role"
            placeholder="All roles"
            options={ROLE_OPTIONS}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            wrapperClassName="w-48"
          />
        }
        filtered={!!roleFilter}
        empty={{ icon: <Users />, title: "No users yet", description: "Add staff so they can sign in.", action: addButton }}
      />

      <Drawer
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError("");
        }}
        title="Add a user"
        description="They sign in with the email or phone and the temporary password."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={busy}>
              Add user
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField label="Name" name="name" required placeholder="Sana Iqbal" />
          <TextField label="Email" name="email" type="email" placeholder="sana@school.pk" />
          <TextField label="Phone" name="phone" placeholder="03001234567" />
          <TextField label="Temporary password" name="password" type="password" minLength={8} required hint="At least 8 characters" />
          <Select label="Role" name="role" options={ROLE_OPTIONS} />
          <Select
            label="Campus"
            name="campusId"
            options={[{ value: "", label: "All campuses" }, ...(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
          />
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Drawer>
    </div>
  );
}
