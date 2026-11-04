"use client";

import { useState } from "react";
import { CalendarPlus, Download, RotateCcw, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardHeader, Field, useToast } from "@/components/ui";
import { platformApi } from "@/lib/api";
import { downloadPlatformFile } from "@/lib/download";
import { day } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { ReasonDialog } from "./reason-dialog";

interface DeletionInfo {
  name: string;
  status: string;
  trialEndsAt: string | null;
  eligible: boolean;
  blockers: { code: string; text: string }[];
  data: { students: number; users: number };
  graceDays: number;
  pending: { dueAt: string; requestedBy: string; reason: string } | null;
}

/** Owner-only: download a school's data, extend its trial, or delete it while it is an unpaid trial. */
export function SchoolLifecycle({ schoolId, schoolName, onChanged }: { schoolId: string; schoolName: string; onChanged: () => void }) {
  const info = usePlatformApi<DeletionInfo>(`/schools/${schoolId}/deletion`);
  const toast = useToast();
  const [dialog, setDialog] = useState<"delete" | "extend" | null>(null);
  const [typed, setTyped] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [busy, setBusy] = useState(false);
  const d = info.data;

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(done, schoolName);
      info.reload();
      onChanged();
    } catch (e) {
      toast.error("That did not work", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="School data and lifecycle" />
      <div className="flex flex-col gap-4 p-4">
        {info.error && <Alert tone="danger">{info.error}</Alert>}
        {d?.pending && (
          <Alert
            tone="warning"
            title={`Waiting to be deleted on ${day(d.pending.dueAt)}`}
            action={
              <Button type="button" variant="secondary" icon={<RotateCcw />} loading={busy} onClick={() => run(() => platformApi(`/schools/${schoolId}/deletion/restore`, { method: "POST" }), "Deletion cancelled")}>
                Restore school
              </Button>
            }
          >
            Requested by {d.pending.requestedBy}: {d.pending.reason}. The school is blocked until then. A copy of its data is kept for 90 days after it is deleted.
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" icon={<Download />} loading={busy} onClick={() => run(() => downloadPlatformFile(`/schools/${schoolId}/export`, `${schoolName}-data.zip`), "Download started")}>
            Download all school data
          </Button>
          {d?.status === "TRIAL" && !d.pending && (
            <Button type="button" variant="secondary" icon={<CalendarPlus />} onClick={() => setDialog("extend")}>
              Extend trial
            </Button>
          )}
          <Button type="button" variant="danger" icon={<Trash2 />} disabled={!d?.eligible} onClick={() => setDialog("delete")}>
            Delete school
          </Button>
        </div>
        {d && !d.eligible && !d.pending && d.blockers.length > 0 && <p className="text-[13px] text-fg-secondary">Cannot be deleted: {d.blockers.map((b) => b.text).join(" ")}</p>}
      </div>

      <ReasonDialog
        open={dialog === "delete"}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
          setTyped("");
        }}
        title={`Delete ${schoolName}?`}
        description={`The school is blocked now and removed after ${d?.graceDays ?? 14} days unless you restore it. ${d?.data.students ?? 0} students and ${d?.data.users ?? 0} logins go with it; a copy is kept for 90 days.`}
        confirmLabel="Delete school"
        destructive
        placeholder="Trial abandoned, no reply to three follow-ups"
        onSubmit={async (reason) => {
          await platformApi(`/schools/${schoolId}/deletion`, { method: "POST", body: { confirmName: typed, reason } });
          toast.success("School scheduled for deletion", schoolName);
          info.reload();
          onChanged();
        }}
      >
        <Field label={`Type "${schoolName}" to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </ReasonDialog>

      <ReasonDialog
        open={dialog === "extend"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Extend the trial of ${schoolName}`}
        description={d?.trialEndsAt ? `The trial now ends on ${day(d.trialEndsAt)}. It can run at most 90 days from today.` : undefined}
        confirmLabel="Extend trial"
        placeholder="Asked for two more weeks to finish setting up"
        onSubmit={async (reason) => {
          if (!endsOn) throw new Error("Choose the new end date");
          await platformApi(`/schools/${schoolId}/trial`, { method: "POST", body: { endsAt: new Date(`${endsOn}T23:59:59`).toISOString(), reason } });
          toast.success("Trial extended", schoolName);
          info.reload();
          onChanged();
        }}
      >
        <Field label="New trial end date" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
      </ReasonDialog>
    </Card>
  );
}
