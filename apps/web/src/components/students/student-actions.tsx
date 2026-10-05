"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Ellipsis, FileBadge, KeyRound, Pencil, Save, UserRound, Wallet } from "lucide-react";
import { Select } from "@/components/select";
import { StudentLoginCard } from "@/components/student/student-login-card";
import {
  Alert,
  Button,
  Dialog,
  Drawer,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  ErrorState,
  Field,
  IconButton,
  SkeletonRows,
  TextArea,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { STATUS_OPTIONS, type StudentProfile } from "./directory-types";

/** Who can do what from the directory. */
export interface DirectoryPermissions {
  /** OWNER/PRINCIPAL/ADMIN: edit, certificates, logins, add student. */
  setup: boolean;
  /** Fee roles with the fees feature: record payment. */
  fees: boolean;
  /** Certificates feature on the plan. */
  certificates: boolean;
}

export type StudentAction = { kind: "edit" | "login"; id: string; name: string } | null;

interface InvoiceLite {
  id: string;
  period: string;
  status: string;
}

/**
 * Takes the user to the oldest open invoice, where the payment is recorded.
 * Returns false when nothing is due.
 */
export function useRecordPayment() {
  const router = useRouter();
  const toast = useToast();
  return async (id: string, name: string) => {
    try {
      const invoices = await api<InvoiceLite[]>(`/fees/invoices?studentId=${encodeURIComponent(id)}`);
      const open = invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL").sort((a, b) => a.period.localeCompare(b.period));
      if (open.length === 0) {
        toast.info("Nothing due", `${name} has no unpaid invoices.`);
        return;
      }
      router.push(`/fees/invoices/${open[0].id}`);
    } catch (e) {
      toast.error("Could not open the invoice", (e as Error).message);
    }
  };
}

/** The "..." row menu of the directory. */
export function StudentActionsMenu({
  student,
  perms,
  onAction,
  onRecordPayment,
}: {
  student: { id: string; name: string; status: string };
  perms: DirectoryPermissions;
  onAction: (action: StudentAction) => void;
  onRecordPayment: (id: string, name: string) => void;
}) {
  const router = useRouter();
  const active = student.status === "ACTIVE";
  return (
    <DropdownMenu
      trigger={
        <IconButton size="sm" aria-label={`Actions for ${student.name}`}>
          <Ellipsis />
        </IconButton>
      }
    >
      <DropdownItem icon={<UserRound />} onSelect={() => router.push(`/students/${student.id}`)}>
        View profile
      </DropdownItem>
      {perms.setup && (
        <DropdownItem icon={<Pencil />} onSelect={() => onAction({ kind: "edit", id: student.id, name: student.name })}>
          Edit details
        </DropdownItem>
      )}
      {perms.fees && (
        <DropdownItem icon={<Wallet />} description="Opens the oldest unpaid invoice" onSelect={() => onRecordPayment(student.id, student.name)}>
          Record payment
        </DropdownItem>
      )}
      {perms.setup && <DropdownSeparator />}
      {perms.setup && perms.certificates && (
        <DropdownItem icon={<FileBadge />} onSelect={() => router.push(`/certificates/new?studentId=${student.id}`)}>
          Generate certificate
        </DropdownItem>
      )}
      {perms.setup && (
        <DropdownItem
          icon={<KeyRound />}
          onSelect={() => onAction({ kind: "login", id: student.id, name: student.name })}
          disabledReason={active ? undefined : "Only current students can have a login"}
        >
          Create student login
        </DropdownItem>
      )}
    </DropdownMenu>
  );
}

/** Edit and login dialogs driven by StudentActionsMenu. */
export function StudentActionDialogs({ action, onClose, onChanged }: { action: StudentAction; onClose: () => void; onChanged: () => void }) {
  return (
    <>
      <EditStudentDrawer id={action?.kind === "edit" ? action.id : null} name={action?.name ?? ""} onClose={onClose} onSaved={onChanged} />
      <StudentLoginDialog id={action?.kind === "login" ? action.id : null} name={action?.name ?? ""} onClose={onClose} onChanged={onChanged} />
    </>
  );
}

const EDIT_FORM_ID = "edit-student-form";

function EditStudentDrawer({ id, name, onClose, onSaved }: { id: string | null; name: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const profile = useApi<StudentProfile>(id ? `/students/${id}` : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // useApi keeps the last student while the next one loads; only show the form for this one.
  const s = profile.data?.id === id ? profile.data : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    setSaving(true);
    try {
      await api(`/students/${id}`, {
        method: "PATCH",
        body: {
          firstName: text("firstName"),
          lastName: text("lastName") || undefined,
          gender: text("gender"),
          dateOfBirth: text("dateOfBirth") || undefined,
          bFormNo: text("bFormNo") || undefined,
          address: text("address") || undefined,
          medicalNotes: text("medicalNotes") || undefined,
          status: text("status"),
        },
      });
      setError("");
      toast.success("Student updated", `${text("firstName")}'s details are saved.`);
      onClose();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={id !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError("");
          onClose();
        }
      }}
      title={`Edit ${name}`}
      description="Personal details and enrolment status. Guardians are managed on the full profile."
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={EDIT_FORM_ID} loading={saving} disabled={!s} icon={<Save />}>
            Save changes
          </Button>
        </>
      }
    >
      {profile.error && !s ? (
        <ErrorState message={profile.error} onRetry={profile.reload} compact />
      ) : !s ? (
        <SkeletonRows rows={5} columns={2} />
      ) : (
        <form key={s.id} id={EDIT_FORM_ID} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" required defaultValue={s.firstName} />
          <Field label="Last name" name="lastName" defaultValue={s.lastName ?? ""} />
          <Select
            label="Gender"
            name="gender"
            defaultValue={s.gender}
            options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]}
          />
          <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={s.dateOfBirth?.slice(0, 10) ?? ""} />
          <Field label="B-Form number" name="bFormNo" defaultValue={s.bFormNo ?? ""} />
          <Select label="Status" name="status" defaultValue={s.status} options={STATUS_OPTIONS} />
          <div className="sm:col-span-full">
            <Field label="Address" name="address" defaultValue={s.address ?? ""} />
          </div>
          <div className="sm:col-span-full">
            <TextArea label="Medical notes" name="medicalNotes" rows={3} defaultValue={s.medicalNotes ?? ""} />
          </div>
          <Alert tone="info" className="col-span-full">
            Marking a student as left, graduated or suspended ends their current enrolment and switches off their login.
          </Alert>
          {error && (
            <Alert tone="danger" className="col-span-full">
              {error}
            </Alert>
          )}
        </form>
      )}
    </Drawer>
  );
}

function StudentLoginDialog({ id, name, onClose, onChanged }: { id: string | null; name: string; onClose: () => void; onChanged: () => void }) {
  const profile = useApi<StudentProfile>(id ? `/students/${id}` : null);
  const s = profile.data?.id === id ? profile.data : null;
  const current = s?.enrollments.find((e) => e.status === "ACTIVE");
  return (
    <Dialog
      open={id !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Student login for ${name}`}
      description="A username and temporary password for the student workspace."
      size="md"
    >
      {profile.error && !s ? (
        <ErrorState message={profile.error} onRetry={profile.reload} compact />
      ) : !s ? (
        <SkeletonRows rows={3} columns={2} />
      ) : (
        <StudentLoginCard
          student={{ id: s.id, name: fullName(s), admissionNo: s.admissionNo, rollNo: current?.rollNo ?? null, status: s.status }}
          login={s.user}
          canManage
          onChanged={() => {
            void profile.reload();
            onChanged();
          }}
        />
      )}
    </Dialog>
  );
}
