"use client";

import { useState, type FormEvent } from "react";
import { BellRing, Ellipsis, KeyRound, Lock, Power, PowerOff, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogClose,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  IconButton,
  PageHeader,
  SelectField,
  StatusPill,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { TempPassword } from "@/components/platform/temp-password";
import { isOwner, PLATFORM_ROLE_LABEL, useConsoleAdmin, type PlatformRole } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { day } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

interface Staff {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  isActive: boolean;
  /** Where system alerts reach them by WhatsApp or SMS; null for none. */
  phone: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLE_OPTIONS = [
  { value: "SUPPORT", label: "Support: schools, bills, support sessions" },
  { value: "OWNER", label: "Owner: also plans, staff and closing schools" },
];

type Pending = { kind: "toggle" | "reset" | "role"; staff: Staff } | null;

/** SchoolSyncer's own team: who can sign in to the console and with which role. Owners only. */
export default function PlatformStaffPage() {
  const me = useConsoleAdmin();
  const toast = useToast();
  const staff = usePlatformApi<Staff[]>(isOwner(me) ? "/staff" : null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<{ staff: Pick<Staff, "name" | "email">; value: string } | null>(null);
  const [phoneFor, setPhoneFor] = useState<Staff | null>(null);

  if (!isOwner(me)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Platform staff" />
        <Card padding="none">
          <EmptyState icon={<Lock />} title="Owners only" description="Ask a SchoolSyncer owner to add or change console accounts." />
        </Card>
      </div>
    );
  }

  async function confirm() {
    if (!pending) return;
    const { kind, staff: s } = pending;
    setBusy(true);
    try {
      if (kind === "reset") {
        const res = await platformApi<{ temporaryPassword: string }>(`/staff/${s.id}/reset-password`, { method: "POST" });
        setPassword({ staff: s, value: res.temporaryPassword });
      } else if (kind === "toggle") {
        await platformApi(`/staff/${s.id}`, { method: "PATCH", body: { isActive: !s.isActive } });
        toast.success(s.isActive ? `${s.name} can no longer sign in` : `${s.name} can sign in again`);
      } else {
        const role = s.role === "OWNER" ? "SUPPORT" : "OWNER";
        await platformApi(`/staff/${s.id}`, { method: "PATCH", body: { role } });
        toast.success(`${s.name} is now ${role === "OWNER" ? "an owner" : "support staff"}`);
      }
      setPending(null);
      await staff.reload();
    } catch (e) {
      toast.error("Could not save the change", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Staff>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (s) => s.name,
      cell: (s) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={s.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">
              {s.name}
              {s.id === me.sub && <span className="font-normal text-fg-muted"> (you)</span>}
            </span>
            <span className="block truncate text-xs text-fg-muted">{s.email}</span>
          </span>
        </span>
      ),
    },
    {
      id: "role",
      header: "Role",
      sortValue: (s) => s.role,
      cell: (s) => (
        <Badge tone={s.role === "OWNER" ? "primary" : "neutral"} icon={s.role === "OWNER" ? <ShieldCheck /> : undefined}>
          {PLATFORM_ROLE_LABEL[s.role]}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (s) => (s.isActive ? 0 : 1),
      cell: (s) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatusPill status={s.isActive ? "ACTIVE" : "INACTIVE"} />
          {s.isActive && s.mustChangePassword && <span className="text-xs text-fg-muted">Temporary password</span>}
        </span>
      ),
    },
    {
      id: "login",
      header: "Last sign-in",
      sortValue: (s) => s.lastLoginAt,
      cell: (s) => (s.lastLoginAt ? day(s.lastLoginAt) : <span className="text-fg-muted">Never</span>),
      hideBelow: "md",
    },
    { id: "added", header: "Added", sortValue: (s) => s.createdAt, cell: (s) => day(s.createdAt), hideBelow: "lg" },
    {
      id: "alerts",
      header: "System alerts",
      cell: (s) => (s.phone ? <span className="tabular-nums">{s.phone}</span> : <span className="text-fg-muted">Not sent</span>),
      hideBelow: "lg",
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "48px",
      cell: (s) => {
        const self = s.id === me.sub;
        return (
          <DropdownMenu
            trigger={
              <IconButton size="sm" aria-label={`Actions for ${s.name}`}>
                <Ellipsis />
              </IconButton>
            }
          >
            <DropdownItem
              icon={<ShieldCheck />}
              onSelect={() => setPending({ kind: "role", staff: s })}
              disabled={self}
              disabledReason="You cannot change your own role"
            >
              {s.role === "OWNER" ? "Make support staff" : "Make owner"}
            </DropdownItem>
            <DropdownItem
              icon={<KeyRound />}
              onSelect={() => setPending({ kind: "reset", staff: s })}
              disabled={!s.isActive}
              disabledReason="Activate the account first"
            >
              Reset password
            </DropdownItem>
            <DropdownItem icon={<BellRing />} onSelect={() => setPhoneFor(s)}>
              {s.phone ? "Change alert phone" : "Send system alerts"}
            </DropdownItem>
            <DropdownSeparator />
            {s.isActive ? (
              <DropdownItem
                icon={<PowerOff />}
                danger
                onSelect={() => setPending({ kind: "toggle", staff: s })}
                disabled={self}
                disabledReason="You cannot deactivate your own account"
              >
                Deactivate
              </DropdownItem>
            ) : (
              <DropdownItem icon={<Power />} onSelect={() => setPending({ kind: "toggle", staff: s })}>
                Activate
              </DropdownItem>
            )}
          </DropdownMenu>
        );
      },
    },
  ];

  const p = pending;
  const confirmCopy = !p
    ? { title: "", description: "", label: "" }
    : p.kind === "reset"
      ? {
          title: `Reset ${p.staff.name}'s password?`,
          description: "Their current password stops working. They choose a new one after signing in with the temporary password.",
          label: "Reset password",
        }
      : p.kind === "toggle"
        ? p.staff.isActive
          ? { title: `Deactivate ${p.staff.name}?`, description: "They are signed out of the console straight away.", label: "Deactivate" }
          : { title: `Activate ${p.staff.name}?`, description: "They can sign in to the console again.", label: "Activate" }
        : p.staff.role === "OWNER"
          ? {
              title: `Make ${p.staff.name} support staff?`,
              description: "They lose access to plans, platform staff, module overrides and closing schools.",
              label: "Make support staff",
            }
          : {
              title: `Make ${p.staff.name} an owner?`,
              description: "Owners can edit plans, manage console staff, override modules and close schools.",
              label: "Make owner",
            };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform staff"
        description="SchoolSyncer team members who can sign in to this console."
        actions={
          <Button icon={<UserPlus />} onClick={() => setAdding(true)}>
            Add staff member
          </Button>
        }
      />
      <DataTable
        label="Platform staff"
        columns={columns}
        data={staff.data}
        getRowId={(s) => s.id}
        error={staff.error}
        onRetry={staff.reload}
        getSearchText={(s) => `${s.name} ${s.email}`}
        searchPlaceholder="Search name or email"
        empty={{ icon: <UsersRound />, title: "No staff yet", description: "Add the first member of the SchoolSyncer team." }}
      />

      <AddStaffDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(s, value) => {
          setPassword({ staff: s, value });
          void staff.reload();
        }}
      />

      <AlertPhoneDialog
        staff={phoneFor}
        onOpenChange={(o) => !o && setPhoneFor(null)}
        onSaved={(s) => {
          toast.success(s.phone ? `System alerts go to ${s.name} at ${s.phone}` : `${s.name} no longer gets system alerts`);
          setPhoneFor(null);
          void staff.reload();
        }}
      />

      <ConfirmDialog
        open={!!p}
        onOpenChange={(o) => !o && !busy && setPending(null)}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.label}
        destructive={p?.kind === "toggle" && p.staff.isActive}
        loading={busy}
        onConfirm={confirm}
      />

      <Dialog
        open={!!password}
        onOpenChange={(o) => !o && setPassword(null)}
        title={`Temporary password for ${password?.staff.name ?? ""}`}
        footer={
          <DialogClose asChild>
            <Button type="button">Done</Button>
          </DialogClose>
        }
      >
        {password && (
          <TempPassword
            password={password.value}
            login={password.staff.email}
            note="It is shown only once. They must choose their own password when they first sign in."
          />
        )}
      </Dialog>
    </div>
  );
}

function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (staff: Staff, temporaryPassword: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await platformApi<{ staff: Staff; temporaryPassword: string }>("/staff", {
        method: "POST",
        body: { name: String(f.get("name") ?? "").trim(), email: String(f.get("email") ?? "").trim(), role: f.get("role") },
      });
      onOpenChange(false);
      onCreated(res.staff, res.temporaryPassword);
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
      title="Add a staff member"
      description="They get a temporary password and choose their own when they first sign in."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Full name" name="name" required minLength={2} maxLength={120} placeholder="Hamza Siddiqui" />
        <TextField label="Work email" name="email" type="email" required placeholder="hamza@schoolsyncer.pk" />
        <SelectField label="Role" name="role" options={ROLE_OPTIONS} defaultValue="SUPPORT" />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" loading={busy}>
            Add staff member
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The phone where a staff member gets system alerts (WhatsApp or SMS through the platform sender). */
function AlertPhoneDialog({ staff, onOpenChange, onSaved }: { staff: Staff | null; onOpenChange: (open: boolean) => void; onSaved: (staff: Staff) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!staff) return;
    const phone = String(new FormData(event.currentTarget).get("phone") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      onSaved(await platformApi<Staff>(`/staff/${staff.id}`, { method: "PATCH", body: { phone } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!staff}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) setError("");
        onOpenChange(o);
      }}
      title={`System alerts for ${staff?.name ?? ""}`}
      description="Alerts about failing jobs, messages and reconciliation are sent here by WhatsApp or SMS, when the server has a sender set up. Leave it empty to stop them."
    >
      <form key={staff?.id} onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Mobile number" name="phone" type="tel" inputMode="tel" defaultValue={staff?.phone ?? ""} placeholder="0300 1234567" />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
