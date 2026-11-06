"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Dialog, SelectField, TextareaField, TextField } from "@/components/ui";
import { api } from "@/lib/api";
import { CONDUCT } from "@/lib/certificates";
import { todayIso } from "@/lib/format";

/** Issues an experience certificate for a staff member, then opens it for printing. */
export function ExperienceCertificateDialog({
  member,
  onClose,
}: {
  member: { id: string; name: string; left: boolean; joinedOn: string | null };
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const issued = await api<{ id: string }>("/hr/experience-certificates", {
        method: "POST",
        body: {
          userId: member.id,
          leftOn: String(f.get("leftOn") || "") || undefined,
          conduct: f.get("conduct"),
          remarks: String(f.get("remarks") || "") || undefined,
        },
      });
      router.push(`/hr/certificates/${issued.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Experience certificate for ${member.name}`}
      description={member.joinedOn ? "Uses the joining date, designation and department on their staff record." : "Add their joining date on the Staff tab first."}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="experience-certificate" loading={busy} disabled={!member.joinedOn}>Issue certificate</Button>
        </>
      }
    >
      <form id="experience-certificate" onSubmit={submit} className="flex flex-col gap-4">
        <TextField label={member.left ? "Last working day" : "Last working day (leave empty if still working)"} name="leftOn" type="date" required={member.left} max={todayIso()} />
        <SelectField label="Conduct" name="conduct" options={CONDUCT.map((c) => ({ value: c, label: c }))} defaultValue="Good" />
        <TextareaField label="Remarks (optional)" name="remarks" rows={2} maxLength={300} />
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
