"use client";

import { useState } from "react";
import { Download, KeyRound, Printer, UsersRound } from "lucide-react";
import { Alert, Button, Checkbox, DataTable, Dialog, StatusPill, useToast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { printLoginSlips } from "./login-slips";

interface BulkLogin {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  username: string;
  password: string | null;
  status: "created" | "reset" | "existing" | "conflict";
  /** Why the login could not be made (only for "conflict"). */
  error?: string;
}

interface BulkResult {
  school: { name: string; code: string };
  section: { id: string; name: string };
  created: number;
  reset: number;
  existing: number;
  conflicts?: number;
  logins: BulkLogin[];
}

const STATUS_LABEL: Record<BulkLogin["status"], { label: string; tone: "success" | "info" | "neutral" | "danger" }> = {
  created: { label: "New login", tone: "success" },
  reset: { label: "Password reset", tone: "info" },
  existing: { label: "Already had one", tone: "neutral" },
  conflict: { label: "Not created", tone: "danger" },
};

const columns: Column<BulkLogin>[] = [
  { id: "roll", header: "Roll", align: "right", width: "64px", sortValue: (r) => r.rollNo ?? 9999, cell: (r) => r.rollNo ?? "–" },
  { id: "name", header: "Student", sortValue: (r) => r.name, cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
  { id: "username", header: "Username", cell: (r) => <span className="font-mono">{r.username}</span> },
  {
    id: "password",
    header: "Password",
    cell: (r) =>
      r.status === "conflict" ? (
        <span className="text-danger-text">{r.error || "Username already in use"}</span>
      ) : r.password ? (
        <span className="font-mono font-semibold text-fg">{r.password}</span>
      ) : (
        <span className="text-fg-muted">Unchanged</span>
      ),
  },
  { id: "status", header: "Status", hideBelow: "sm", cell: (r) => <StatusPill status={r.status} label={STATUS_LABEL[r.status].label} tone={STATUS_LABEL[r.status].tone} /> },
];

/** Bulk "Create student logins" for one section, with a printable username and password list shown once. */
export function SectionLogins({ section }: { section: { id: string; label: string } }) {
  const toast = useToast();
  const [resetExisting, setResetExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await api<BulkResult>("/students/logins/bulk", { method: "POST", body: { sectionId: section.id, resetExisting } });
      setResult(res);
      const summary = `${res.created} created${res.reset ? `, ${res.reset} reset` : ""}${res.existing ? `, ${res.existing} already had one` : ""}`;
      if (res.conflicts) {
        toast.error("Some logins were not created", `${summary}, ${res.conflicts} not created because the username is taken.`);
      } else {
        toast.success("Student logins ready", `${summary}.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function print() {
    if (!result) return;
    const ok = printLoginSlips({
      schoolName: result.school.name,
      schoolCode: result.school.code,
      title: `Student logins: ${result.section.name}`,
      slips: result.logins.filter((l) => l.status !== "conflict"),
    });
    if (!ok) toast.error("Pop-up blocked", "Allow pop-ups for this site to print the list.");
  }

  function csv() {
    if (!result) return;
    downloadCsv(
      `student-logins-${result.section.name.toLowerCase().replace(/\s+/g, "-")}.csv`,
      ["Roll", "Student", "Admission no.", "School code", "Username", "Password"],
      result.logins.map((l) => [l.rollNo, l.name, l.admissionNo, result.school.code, l.username, l.status === "conflict" ? `(not created: ${l.error || "username taken"})` : (l.password ?? "(unchanged)")]),
    );
  }

  const withPassword = result?.logins.filter((l) => l.password).length ?? 0;

  return (
    <section aria-labelledby={`logins-${section.id}`} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
          <KeyRound className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id={`logins-${section.id}`} className="text-sm font-semibold text-fg">
            Student logins
          </h3>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            Give every student in {section.label} a username (their admission number) and a temporary password for the student workspace.
          </p>
        </div>
      </div>
      <Checkbox checked={resetExisting} onCheckedChange={setResetExisting} label="Also reset passwords for students who already have a login" />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end">
        <Button type="button" variant="secondary" icon={<UsersRound />} loading={busy} onClick={run}>
          Create student logins
        </Button>
      </div>

      <Dialog
        open={result !== null}
        onOpenChange={(o) => !o && setResult(null)}
        size="xl"
        title={result ? `Student logins for ${result.section.name}` : "Student logins"}
        description="Passwords are shown only once. Print the slips or download the list before you close this."
        footer={
          <>
            <Button type="button" variant="secondary" icon={<Download />} onClick={csv}>
              Download CSV
            </Button>
            <Button type="button" variant="secondary" icon={<Printer />} onClick={print}>
              Print slips
            </Button>
            <Button type="button" onClick={() => setResult(null)}>
              Done
            </Button>
          </>
        }
      >
        {result && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-fg-secondary">
              School code <span className="font-mono font-semibold text-fg">{result.school.code}</span>. {result.created} new,{" "}
              {result.reset} reset, {result.existing} unchanged. {withPassword} students have a new password.
            </p>
            {!!result.conflicts && (
              <Alert tone="warning" title={`${result.conflicts} login${result.conflicts === 1 ? "" : "s"} not created`}>
                Another account already uses {result.conflicts === 1 ? "this username" : "these usernames"}. Check the rows marked Not created, then try again from the student&apos;s profile.
              </Alert>
            )}
            <DataTable
              label={`Student logins for ${result.section.name}`}
              columns={columns}
              data={result.logins}
              getRowId={(r) => r.studentId}
              pageSize={0}
              maxHeight="50vh"
              dense
              empty={{ title: "No students in this section", description: "Enrol students first, then create their logins." }}
            />
          </div>
        )}
      </Dialog>
    </section>
  );
}
