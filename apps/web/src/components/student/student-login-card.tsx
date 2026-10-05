"use client";

import { useState } from "react";
import { Copy, KeyRound, Printer, UserRoundCheck, UserRoundX } from "lucide-react";
import { Alert, Button, Card, CardHeader, ConfirmDialog, DescriptionList, Dialog, StatusPill, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { useSession } from "@/lib/session";
import { printLoginSlips } from "./login-slips";

export interface StudentLogin {
  id: string;
  username: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface LoginResult {
  studentId: string;
  userId: string;
  username: string;
  schoolCode: string;
  created: boolean;
  tempPassword: string | null;
}

/**
 * "Student login" card on the student profile: shows the student's username and lets setup
 * roles create the login, reset its password (shown once) or switch it off.
 */
export function StudentLoginCard({
  student,
  login,
  canManage,
  onChanged,
}: {
  student: { id: string; name: string; admissionNo: string; rollNo: number | null; status: string };
  login: StudentLogin | null | undefined;
  canManage: boolean;
  onChanged: () => void;
}) {
  const user = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<"create" | "disable" | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [result, setResult] = useState<LoginResult | null>(null);
  const schoolCode = result?.schoolCode ?? user.school?.slug ?? "";
  const active = student.status === "ACTIVE";
  const hasLogin = !!login;
  const enabled = !!login?.isActive;

  async function createOrReset() {
    setBusy("create");
    try {
      const res = await api<LoginResult>(`/students/${student.id}/login`, { method: "POST", body: {} });
      setResult(res);
      onChanged();
    } catch (e) {
      toast.error("Could not set up the login", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy("disable");
    try {
      await api(`/students/${student.id}/login`, { method: "DELETE" });
      toast.success("Login switched off", `${student.name} can no longer sign in.`);
      setConfirmDisable(false);
      onChanged();
    } catch (e) {
      toast.error("Could not switch off the login", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copyDetails() {
    if (!result) return;
    const text = `School code: ${result.schoolCode}\nUsername: ${result.username}\nPassword: ${result.tempPassword ?? "(unchanged)"}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied", "Sign-in details copied to the clipboard.");
    } catch {
      toast.error("Could not copy", "Select the details and copy them by hand.");
    }
  }

  function print() {
    if (!result) return;
    const ok = printLoginSlips({
      schoolName: user.school?.name ?? "SchoolSyncer",
      schoolCode: result.schoolCode,
      title: `Student login: ${student.name}`,
      slips: [{ name: student.name, admissionNo: student.admissionNo, rollNo: student.rollNo, username: result.username, password: result.tempPassword }],
    });
    if (!ok) toast.error("Pop-up blocked", "Allow pop-ups for this site to print the slip.");
  }

  return (
    <Card>
      <CardHeader
        title="Student login"
        description="For the student workspace: lessons, live classes, assignments and results."
        icon={<KeyRound />}
        action={hasLogin ? <StatusPill status={enabled ? "ACTIVE" : "INACTIVE"} label={enabled ? "Active" : "Switched off"} /> : undefined}
      />
      {hasLogin ? (
        <DescriptionList
          columns={2}
          items={[
            { label: "Username", value: <span className="font-mono">{login.username ?? student.admissionNo.toLowerCase()}</span> },
            { label: "School code", value: <span className="font-mono">{schoolCode || "–"}</span> },
            { label: "Last sign-in", value: login.lastLoginAt ? day(login.lastLoginAt) : "Never", full: true },
          ]}
        />
      ) : (
        <p className="text-sm text-fg-muted">
          {active
            ? "No login yet. Create one to give this student a username and a temporary password."
            : "Only students who are currently enrolled can have a login."}
        </p>
      )}

      {canManage && active && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {!hasLogin && (
            <Button type="button" size="sm" icon={<UserRoundCheck />} loading={busy === "create"} onClick={createOrReset}>
              Create login
            </Button>
          )}
          {hasLogin && !enabled && (
            <Button type="button" size="sm" icon={<UserRoundCheck />} loading={busy === "create"} onClick={createOrReset}>
              Switch on with new password
            </Button>
          )}
          {enabled && (
            <>
              <Button type="button" size="sm" variant="secondary" icon={<KeyRound />} loading={busy === "create"} onClick={createOrReset}>
                Reset password
              </Button>
              <Button type="button" size="sm" variant="ghost" icon={<UserRoundX />} onClick={() => setConfirmDisable(true)}>
                Switch off
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title={`Switch off ${student.name}'s login?`}
        description="They will not be able to sign in until you switch it on again. Their work and grades are kept."
        confirmLabel="Switch off"
        destructive
        loading={busy === "disable"}
        onConfirm={disable}
      />

      <Dialog
        open={result !== null}
        onOpenChange={(o) => !o && setResult(null)}
        title={result?.created ? "Login created" : "New password set"}
        description="Give these details to the student. The password is shown only once."
        footer={
          <>
            <Button type="button" variant="secondary" icon={<Copy />} onClick={copyDetails}>
              Copy
            </Button>
            <Button type="button" variant="secondary" icon={<Printer />} onClick={print}>
              Print slip
            </Button>
            <Button type="button" onClick={() => setResult(null)}>
              Done
            </Button>
          </>
        }
      >
        {result && (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 rounded-lg border border-border bg-surface-2 p-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-fg-muted">School code</dt>
                <dd className="font-mono text-base font-semibold text-fg">{result.schoolCode}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Username</dt>
                <dd className="font-mono text-base font-semibold text-fg">{result.username}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Password</dt>
                <dd className="font-mono text-base font-semibold text-fg">{result.tempPassword ?? "Unchanged"}</dd>
              </div>
            </dl>
            <Alert tone="info">Students sign in on the normal sign-in page with the school code and their username.</Alert>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
