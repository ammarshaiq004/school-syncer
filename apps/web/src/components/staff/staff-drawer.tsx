"use client";

import { CalendarClock, KeyRound, Pencil, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { Avatar, Badge, Button, DescriptionList, Drawer, ErrorState, SkeletonRows, StatusPill } from "@/components/ui";
import { day } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { grantName, type StaffDetail, type StaffUser } from "./types";

export interface StaffActions {
  /** Why the signed-in user cannot change this account, or null when they can. */
  lockedReason: string | null;
  isSelf: boolean;
  onEdit: () => void;
  onRoles: () => void;
  onReset: () => void;
  onToggleActive: () => void;
}

/** Staff profile side panel: contact, roles, employment and teaching load. */
export function StaffDrawer({ user, onOpenChange, actions }: { user: StaffUser | null; onOpenChange: (open: boolean) => void; actions: StaffActions | null }) {
  const detail = useApi<StaffDetail>(user ? `/users/${user.id}` : null);
  const d = detail.data?.id === user?.id ? detail.data : null;
  const profile = d?.staffProfile ?? user?.staffProfile ?? null;
  const locked = !!actions?.lockedReason;

  return (
    <Drawer
      open={!!user}
      onOpenChange={onOpenChange}
      size="lg"
      title={
        user ? (
          <span className="flex items-center gap-3">
            <Avatar name={user.name} size="md" />
            <span className="min-w-0">
              <span className="block truncate">{user.name}</span>
              <span className="block text-[13px] font-normal text-fg-muted">{profile?.designation ?? "No designation on file"}</span>
            </span>
          </span>
        ) : (
          "Staff profile"
        )
      }
      headerExtra={user && <StatusPill status={user.isActive ? "Active" : "Inactive"} />}
      footer={
        user &&
        actions && (
          <>
            {actions.lockedReason && <p className="me-auto self-center text-[13px] text-fg-muted">{actions.lockedReason}</p>}
            <Button type="button" variant="secondary" size="sm" icon={<Pencil />} disabled={locked} onClick={actions.onEdit}>
              Edit
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<ShieldCheck />} disabled={locked} onClick={actions.onRoles}>
              Change roles
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<KeyRound />} disabled={locked || !user.isActive} onClick={actions.onReset}>
              Reset password
            </Button>
            <Button
              type="button"
              variant={user.isActive ? "danger" : "primary"}
              size="sm"
              icon={user.isActive ? <UserX /> : <UserCheck />}
              disabled={locked || (user.isActive && actions.isSelf)}
              onClick={actions.onToggleActive}
            >
              {user.isActive ? "Deactivate" : "Activate"}
            </Button>
          </>
        )
      }
    >
      {user && (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="staff-contact" className="flex flex-col gap-3">
            <h3 id="staff-contact" className="text-sm font-semibold text-fg">
              Contact and sign-in
            </h3>
            <DescriptionList
              items={[
                { label: "Email", value: user.email ?? <span className="text-fg-muted">Not set</span> },
                { label: "Phone", value: user.phone ?? <span className="text-fg-muted">Not set</span> },
                { label: "Last sign-in", value: user.lastLoginAt ? day(user.lastLoginAt) : <span className="text-fg-muted">Never</span> },
                { label: "Account created", value: day(user.createdAt) },
              ]}
            />
          </section>

          <section aria-labelledby="staff-roles" className="flex flex-col gap-3">
            <h3 id="staff-roles" className="text-sm font-semibold text-fg">
              Roles
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {user.roles.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-fg">{grantName(g)}</span>
                    {g.customRole && <Badge tone="primary">Custom</Badge>}
                  </span>
                  <span className="text-fg-muted">{g.campus?.name ?? "All campuses"}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="staff-employment" className="flex flex-col gap-3">
            <h3 id="staff-employment" className="text-sm font-semibold text-fg">
              Employment
            </h3>
            {profile ? (
              <DescriptionList
                items={[
                  { label: "Employee no.", value: profile.employeeNo },
                  { label: "Designation", value: profile.designation },
                  { label: "Department", value: profile.department ?? <span className="text-fg-muted">Not set</span> },
                  { label: "Status", value: <StatusPill status={profile.status} /> },
                  ...(d?.staffProfile?.joinedOn ? [{ label: "Joined", value: day(d.staffProfile.joinedOn) }] : []),
                ]}
              />
            ) : (
              <p className="text-sm text-fg-muted">No HR record yet. Add one from HR and payroll to track salary and leave.</p>
            )}
          </section>

          <section aria-labelledby="staff-load" className="flex flex-col gap-3">
            <h3 id="staff-load" className="flex items-center gap-2 text-sm font-semibold text-fg">
              <CalendarClock className="size-4 text-fg-muted" aria-hidden />
              Teaching load
            </h3>
            {detail.error && !d ? (
              <ErrorState compact message={detail.error} onRetry={detail.reload} />
            ) : !d ? (
              <SkeletonRows rows={1} columns={3} />
            ) : (
              <dl className="grid grid-cols-3 gap-3">
                {[
                  { label: "Periods a week", value: d.load?.timetablePeriods ?? 0 },
                  { label: "Class teacher of", value: d.load?.classTeacherOf ?? 0 },
                  { label: "Subjects taught", value: d.load?.subjectsTaught ?? 0 },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                    <dt className="text-xs text-fg-muted">{s.label}</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums text-fg">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
