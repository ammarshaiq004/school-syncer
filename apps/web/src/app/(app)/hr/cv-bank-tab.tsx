"use client";

import { useState, type FormEvent } from "react";
import { FileText, Pencil, Plus, Trash2, UserSearch } from "lucide-react";
import { FileChip, FileUploadField, type FileLink } from "@/components/elearning/file-upload";
import {
  Alert,
  Avatar,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  NativeSelect,
  SelectField,
  StatusPill,
  TextareaField,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

export type CandidateStatus = "NEW" | "SHORTLISTED" | "INTERVIEWED" | "OFFERED" | "HIRED" | "REJECTED";
interface Candidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string;
  qualification: string | null;
  experienceYears: number;
  expectedSalary: number | null;
  source: string | null;
  status: CandidateStatus;
  notes: string | null;
  cv: FileLink | null;
}

const STATUSES: { value: CandidateStatus; label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }[] = [
  { value: "NEW", label: "New", tone: "neutral" },
  { value: "SHORTLISTED", label: "Shortlisted", tone: "info" },
  { value: "INTERVIEWED", label: "Interviewed", tone: "info" },
  { value: "OFFERED", label: "Offered", tone: "warning" },
  { value: "HIRED", label: "Hired", tone: "success" },
  { value: "REJECTED", label: "Rejected", tone: "danger" },
];
const CV_TYPES = ".pdf,.doc,.docx,.png,.jpg,.jpeg";

/** The CV bank: applicants kept for the next vacancy, searchable by position and skills. */
export function CvBankTab() {
  const [status, setStatus] = useState("");
  const list = useApi<Candidate[]>(`/hr/candidates${status ? `?status=${status}` : ""}`);
  const [editing, setEditing] = useState<Candidate | "new" | null>(null);
  const [removing, setRemoving] = useState<Candidate | null>(null);
  const toast = useToast();

  const columns: Column<Candidate>[] = [
    {
      id: "name",
      header: "Candidate",
      sortValue: (c) => c.name,
      cell: (c) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={c.name} size="xs" />
          <span className="min-w-0">
            <span className="block font-medium">{c.name}</span>
            <span className="block text-xs text-fg-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact"}</span>
          </span>
        </span>
      ),
    },
    {
      id: "position",
      header: "Applied for",
      sortValue: (c) => c.position,
      cell: (c) => (
        <span className="block">
          {c.position}
          {c.qualification && <span className="block text-xs text-fg-muted">{c.qualification}</span>}
        </span>
      ),
    },
    { id: "exp", header: "Experience", align: "right", sortValue: (c) => c.experienceYears, cell: (c) => `${c.experienceYears} yr`, hideBelow: "md" },
    { id: "salary", header: "Expects", align: "right", sortValue: (c) => c.expectedSalary, cell: (c) => (c.expectedSalary ? rupees(c.expectedSalary) : "–"), hideBelow: "lg" },
    {
      id: "status",
      header: "Stage",
      sortValue: (c) => c.status,
      cell: (c) => {
        const s = STATUSES.find((x) => x.value === c.status)!;
        return <StatusPill status={c.status} tone={s.tone} label={s.label} />;
      },
    },
    {
      id: "cv",
      header: "CV",
      cell: (c) =>
        c.cv ? (
          <a href={c.cv.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            <FileText className="size-4" aria-hidden /> Open
          </a>
        ) : (
          <span className="text-fg-muted">–</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (c) => (
        <span className="inline-flex gap-1">
          <Button type="button" size="sm" variant="ghost" icon={<Pencil />} aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
            Edit
          </Button>
          <Button type="button" size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Delete ${c.name}`} onClick={() => setRemoving(c)} />
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        label="CV bank"
        columns={columns}
        data={list.data}
        error={list.error}
        onRetry={list.reload}
        getRowId={(c) => c.id}
        getSearchText={(c) => `${c.name} ${c.position} ${c.qualification ?? ""} ${c.source ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.notes ?? ""}`}
        searchPlaceholder="Search name, position, qualification or notes"
        defaultSort={{ id: "name", dir: "asc" }}
        filters={
          <NativeSelect
            aria-label="Stage"
            placeholder="All stages"
            wrapperClassName="w-40"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={STATUSES.map(({ value, label }) => ({ value, label }))}
          />
        }
        filtered={!!status}
        toolbarActions={
          <Button type="button" icon={<Plus />} onClick={() => setEditing("new")}>
            Add candidate
          </Button>
        }
        empty={{ title: "No candidates yet", description: "Keep the CVs of people who apply, so the next vacancy starts with a shortlist.", icon: <UserSearch /> }}
      />
      {editing && (
        <CandidateDialog
          key={editing === "new" ? "new" : editing.id}
          candidate={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (name) => {
            setEditing(null);
            toast.success("Candidate saved", name);
            await list.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${removing?.name ?? "candidate"}?`}
        description="Their details and CV file are removed from the bank."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api(`/hr/candidates/${removing.id}`, { method: "DELETE" });
            toast.success("Candidate deleted", removing.name);
            setRemoving(null);
            await list.reload();
          } catch (e) {
            toast.error("Could not delete", (e as Error).message);
          }
        }}
      />
    </div>
  );
}

function CandidateDialog({ candidate, onClose, onSaved }: { candidate: Candidate | null; onClose: () => void; onSaved: (name: string) => Promise<void> }) {
  // undefined keeps the saved CV, null removes it, a file replaces it.
  const [cv, setCv] = useState<FileLink | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shown = cv === undefined ? candidate?.cv ?? null : cv;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const number = (k: string) => (text(k) ? Number(text(k)) : undefined);
    setBusy(true);
    try {
      const body = {
        name: text("name"),
        phone: text("phone"),
        email: text("email"),
        position: text("position"),
        qualification: text("qualification"),
        experienceYears: number("experienceYears") ?? 0,
        expectedSalary: number("expectedSalary"),
        source: text("source"),
        status: text("status"),
        notes: text("notes"),
        ...(cv === undefined ? {} : { cvId: cv?.id ?? null }),
      };
      await api(candidate ? `/hr/candidates/${candidate.id}` : "/hr/candidates", { method: candidate ? "PUT" : "POST", body });
      await onSaved(body.name ?? "");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={candidate ? `Edit ${candidate.name}` : "Add a candidate"}
      description="Name and the position applied for are enough; add the rest as you learn it."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="candidate-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="candidate-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" name="name" required minLength={2} maxLength={120} defaultValue={candidate?.name} />
        <TextField label="Applied for" name="position" required minLength={2} maxLength={80} placeholder="Maths teacher" defaultValue={candidate?.position} />
        <TextField label="Phone" name="phone" inputMode="tel" placeholder="0300 1234567" defaultValue={candidate?.phone ?? ""} />
        <TextField label="Email" name="email" type="email" defaultValue={candidate?.email ?? ""} />
        <TextField label="Qualification" name="qualification" maxLength={120} placeholder="MSc Physics" defaultValue={candidate?.qualification ?? ""} />
        <TextField label="Experience (years)" name="experienceYears" type="number" min={0} max={60} defaultValue={candidate?.experienceYears ?? 0} />
        <TextField label="Expected salary (Rs)" name="expectedSalary" type="number" min={0} defaultValue={candidate?.expectedSalary ?? ""} />
        <TextField label="Source" name="source" maxLength={60} placeholder="Referral, walk-in, Rozee" defaultValue={candidate?.source ?? ""} />
        <SelectField label="Stage" name="status" options={STATUSES.map(({ value, label }) => ({ value, label }))} defaultValue={candidate?.status ?? "NEW"} />
        <div className="sm:col-span-2">
          {shown ? (
            <FileChip file={shown} onRemove={() => setCv(null)} />
          ) : (
            <FileUploadField label="CV" hint="A PDF, Word file or photo, up to 10 MB." endpoint="/hr/candidates/cv" accept={CV_TYPES} value={null} onChange={setCv} disabled={busy} />
          )}
        </div>
        <TextareaField label="Notes" name="notes" rows={3} maxLength={2000} wrapperClassName="sm:col-span-2" defaultValue={candidate?.notes ?? ""} />
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
