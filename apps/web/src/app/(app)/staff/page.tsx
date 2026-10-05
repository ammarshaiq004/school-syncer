"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Ellipsis, KeyRound, Pencil, ShieldCheck, UserCheck, UserPlus, UserRound, Users, UserX, GraduationCap, Clock } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  buttonClass,
  ConfirmDialog,
  DataTable,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  IconButton,
  KpiCard,
  NativeSelect,
  PageHeader,
  SegmentedControl,
  StatGrid,
  StatusPill,
  useToast,
  type Column,
} from "@/components/ui";
import { InviteStaffDialog } from "@/components/staff/invite-staff-dialog";
import { ChangeRolesDialog, EditStaffDialog, PasswordResultDialog } from "@/components/staff/staff-dialogs";
import { StaffDrawer } from "@/components/staff/staff-drawer";
import { grantName, ROLE_NAMES, STAFF_ROLES, type Campus, type RolesResponse, type StaffUser } from "@/components/staff/types";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { hasRole, useCan, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type StatusFilter = "active" | "inactive" | "all";

const isOwner = (u: StaffUser) => u.roles.some((r) => r.role === "OWNER");
const isTeaching = (u: StaffUser) => u.roles.some((r) => r.role === "TEACHER" || r.role === "CLASS_TEACHER");

export default function StaffPage() {
  const me = useSession();
  const can = useCan();
  const toast = useToast();
  const users = useApi<StaffUser[]>("/users?type=staff");
  const roles = useApi<RolesResponse>("/roles");
  const campuses = useApi<Campus[]>("/campuses");
  const customRoles = useMemo(() => roles.data?.custom ?? [], [roles.data]);
  const campusList = campuses.data ?? [];

  const canManage = can("users", "manage");
  const meOwner = hasRole(me, ["OWNER"]);

  const [status, setStatus] = useState<StatusFilter>("active");
  const [roleFilter, setRoleFilter] = useState("");
  const [campusFilter, setCampusFilter] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [viewing, setViewing] = useState<StaffUser | null>(null);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [rolesFor, setRolesFor] = useState<StaffUser | null>(null);
  const [resetting, setResetting] = useState<StaffUser | null>(null);
  const [toggling, setToggling] = useState<StaffUser | null>(null);
  const [password, setPassword] = useState<{ user: StaffUser; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const all = users.data;
  const rows = useMemo(
    () =>
      all?.filter((u) => {
        if (status === "active" && !u.isActive) return false;
        if (status === "inactive" && u.isActive) return false;
        if (roleFilter.startsWith("custom:") && !u.roles.some((r) => r.customRoleId === roleFilter.slice(7))) return false;
        if (roleFilter.startsWith("role:") && !u.roles.some((r) => r.role === roleFilter.slice(5))) return false;
        if (campusFilter && !u.roles.some((r) => r.campusId === campusFilter || r.campusId === null)) return false;
        return true;
      }),
    [all, status, roleFilter, campusFilter],
  );

  /** Keeps the open drawer in sync after a change. */
  async function refresh() {
    await users.reload();
    roles.reload();
  }
  const current = (u: StaffUser | null) => (u ? (all?.find((x) => x.id === u.id) ?? u) : null);

  function lockedReason(u: StaffUser): string | null {
    if (!canManage) return "Your role can view staff but not change them.";
    if (isOwner(u) && !meOwner) return "Only an owner can change an owner account.";
    return null;
  }

  async function resetPassword() {
    if (!resetting) return;
    setBusy(true);
    try {
      const res = await api<{ temporaryPassword: string }>(`/users/${resetting.id}/reset-password`, { method: "POST" });
      setPassword({ user: resetting, password: res.temporaryPassword });
      setResetting(null);
    } catch (e) {
      toast.error("Could not reset the password", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!toggling) return;
    const action = toggling.isActive ? "deactivate" : "activate";
    setBusy(true);
    try {
      await api(`/users/${toggling.id}/${action}`, { method: "POST" });
      toast.success(toggling.isActive ? "Account deactivated" : "Account activated", toggling.name);
      setToggling(null);
      await refresh();
    } catch (e) {
      toast.error(`Could not ${action} this account`, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const actionsMenu = (u: StaffUser) => {
    const locked = lockedReason(u);
    const self = u.id === me.sub;
    return (
      <DropdownMenu trigger={<IconButton size="sm" aria-label={`Actions for ${u.name}`}><Ellipsis /></IconButton>}>
        <DropdownItem icon={<UserRound />} onSelect={() => setViewing(u)}>
          View profile
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<Pencil />} disabledReason={locked ?? undefined} onSelect={() => setEditing(u)}>
          Edit details
        </DropdownItem>
        <DropdownItem icon={<ShieldCheck />} disabledReason={locked ?? undefined} onSelect={() => setRolesFor(u)}>
          Change roles
        </DropdownItem>
        <DropdownItem
          icon={<KeyRound />}
          disabledReason={locked ?? (u.isActive ? undefined : "Activate the account first.")}
          onSelect={() => setResetting(u)}
        >
          Reset password
        </DropdownItem>
        <DropdownSeparator />
        {u.isActive ? (
          <DropdownItem
            icon={<UserX />}
            danger
            disabledReason={locked ?? (self ? "You cannot deactivate your own account." : undefined)}
            onSelect={() => setToggling(u)}
          >
            Deactivate
          </DropdownItem>
        ) : (
          <DropdownItem icon={<UserCheck />} disabledReason={locked ?? undefined} onSelect={() => setToggling(u)}>
            Activate
          </DropdownItem>
        )}
      </DropdownMenu>
    );
  };

  const columns: Column<StaffUser>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (u) => u.name,
      cell: (u) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={u.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">
              {u.name}
              {u.id === me.sub && <span className="ms-1.5 text-xs font-normal text-fg-muted">(you)</span>}
            </span>
            <span className="block truncate text-xs text-fg-muted">{u.staffProfile?.designation ?? "No designation"}</span>
          </span>
        </span>
      ),
    },
    {
      id: "roles",
      header: "Roles",
      cell: (u) => (
        <span className="flex flex-wrap gap-1.5">
          {u.roles.map((g) => (
            <Badge key={g.id} tone={g.role === "OWNER" || g.role === "PRINCIPAL" ? "primary" : g.customRole ? "info" : "neutral"}>
              {grantName(g)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: "campus",
      header: "Campus",
      hideBelow: "lg",
      sortValue: (u) => campusText(u),
      cell: (u) => <span className="text-fg-secondary">{campusText(u)}</span>,
    },
    {
      id: "contact",
      header: "Contact",
      hideBelow: "md",
      cell: (u) => (
        <span className="flex min-w-0 flex-col text-[13px]">
          {u.phone && <span className="truncate text-fg-secondary tabular-nums">{u.phone}</span>}
          {u.email && <span className="truncate text-fg-muted">{u.email}</span>}
        </span>
      ),
    },
    { id: "status", header: "Status", sortValue: (u) => (u.isActive ? 0 : 1), cell: (u) => <StatusPill status={u.isActive ? "Active" : "Inactive"} /> },
    {
      id: "last",
      header: "Last sign-in",
      align: "right",
      hideBelow: "sm",
      sortValue: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt) : null),
      cell: (u) => (u.lastLoginAt ? day(u.lastLoginAt) : <span className="text-fg-muted">Never</span>),
    },
    { id: "actions", header: <span className="sr-only">Actions</span>, width: "48px", cell: (u) => actionsMenu(u) },
  ];

  const loading = !all && !users.error;
  const failed = !all && !!users.error;
  const active = all?.filter((u) => u.isActive) ?? [];
  const inviteButton = canManage && (
    <Button type="button" icon={<UserPlus />} onClick={() => setInviteOpen(true)}>
      Invite staff
    </Button>
  );
  const viewed = current(viewing);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Staff directory"
        description="Everyone who signs in to run the school, their roles and their access."
        breadcrumbs={[{ label: "Setup" }, { label: "Staff directory" }]}
        actions={
          <>
            <Link href="/settings/roles" className={buttonClass("secondary", "md")}>
              <ShieldCheck className="size-4" aria-hidden />
              Roles and permissions
            </Link>
            {inviteButton}
          </>
        }
      />

      <StatGrid>
        <KpiCard label="Active staff" value={active.length} icon={<Users />} loading={loading} error={failed} />
        <KpiCard label="Teaching staff" value={active.filter(isTeaching).length} icon={<GraduationCap />} tone="info" loading={loading} error={failed} />
        <KpiCard
          label="Never signed in"
          value={active.filter((u) => !u.lastLoginAt).length}
          icon={<Clock />}
          tone="warning"
          hint="Active accounts"
          loading={loading}
          error={failed}
        />
        <KpiCard label="Deactivated" value={(all?.length ?? 0) - active.length} icon={<UserX />} tone="neutral" loading={loading} error={failed} />
      </StatGrid>

      <DataTable
        label="Staff"
        columns={columns}
        data={rows}
        getRowId={(u) => u.id}
        error={users.error}
        errorStatus={users.errorStatus}
        onRetry={users.reload}
        getSearchText={(u) =>
          `${u.name} ${u.email ?? ""} ${u.phone ?? ""} ${u.staffProfile?.designation ?? ""} ${u.staffProfile?.employeeNo ?? ""} ${u.roles.map(grantName).join(" ")}`
        }
        searchPlaceholder="Search name, phone, email or designation"
        filters={
          <>
            <SegmentedControl<StatusFilter>
              aria-label="Account status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Deactivated" },
                { value: "all", label: "All" },
              ]}
            />
            <NativeSelect aria-label="Filter by role" placeholder="All roles" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} wrapperClassName="w-44">
              <optgroup label="Built-in roles">
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={`role:${r}`}>
                    {ROLE_NAMES[r]}
                  </option>
                ))}
              </optgroup>
              {customRoles.length > 0 && (
                <optgroup label="Custom roles">
                  {customRoles.map((c) => (
                    <option key={c.id} value={`custom:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
            {campusList.length > 1 && (
              <NativeSelect
                aria-label="Filter by campus"
                placeholder="All campuses"
                options={campusList.map((c) => ({ value: c.id, label: c.name }))}
                value={campusFilter}
                onChange={(e) => setCampusFilter(e.target.value)}
                wrapperClassName="w-44"
              />
            )}
          </>
        }
        filtered={status !== "all" || !!roleFilter || !!campusFilter}
        empty={{
          icon: <Users />,
          title: status === "inactive" ? "No deactivated accounts" : "No staff yet",
          description: status === "inactive" ? "Deactivated staff show up here so you can bring them back." : "Invite your principal, teachers and office staff so they can sign in.",
          action: status === "inactive" ? undefined : inviteButton || undefined,
        }}
        onRowClick={setViewing}
        getRowLabel={(u) => `Open profile of ${u.name}`}
        rowClassName={(u) => (u.isActive ? undefined : "text-fg-muted")}
      />

      <StaffDrawer
        user={viewed}
        onOpenChange={(o) => !o && setViewing(null)}
        actions={
          viewed && {
            lockedReason: lockedReason(viewed),
            isSelf: viewed.id === me.sub,
            onEdit: () => setEditing(viewed),
            onRoles: () => setRolesFor(viewed),
            onReset: () => setResetting(viewed),
            onToggleActive: () => setToggling(viewed),
          }
        }
      />

      <InviteStaffDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        customRoles={customRoles}
        campuses={campusList}
        canGrantOwner={meOwner}
        onCreated={refresh}
      />
      <EditStaffDialog key={`edit-${editing?.id ?? ""}`} user={editing} onOpenChange={(o) => !o && setEditing(null)} onSaved={refresh} />
      <ChangeRolesDialog
        key={`roles-${rolesFor?.id ?? ""}`}
        user={rolesFor}
        onOpenChange={(o) => !o && setRolesFor(null)}
        onSaved={refresh}
        customRoles={customRoles}
        campuses={campusList}
        canGrantOwner={meOwner}
      />
      <ConfirmDialog
        open={!!resetting}
        onOpenChange={(o) => !o && setResetting(null)}
        title="Reset password?"
        description={resetting ? `${resetting.name} gets a new temporary password. Their old password stops working.` : undefined}
        confirmLabel="Reset password"
        loading={busy}
        onConfirm={resetPassword}
      />
      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.isActive ? "Deactivate this account?" : "Activate this account?"}
        description={
          toggling
            ? toggling.isActive
              ? `${toggling.name} is signed out straight away and cannot sign in until you activate the account again. Their records stay.`
              : `${toggling.name} can sign in again with their existing password.`
            : undefined
        }
        confirmLabel={toggling?.isActive ? "Deactivate" : "Activate"}
        destructive={!!toggling?.isActive}
        loading={busy}
        onConfirm={toggleActive}
      />
      <PasswordResultDialog result={password} onClose={() => setPassword(null)} />
    </div>
  );
}

function campusText(u: StaffUser) {
  const names = [...new Set(u.roles.map((r) => r.campus?.name ?? "All campuses"))];
  return names.includes("All campuses") ? "All campuses" : names.join(", ");
}
