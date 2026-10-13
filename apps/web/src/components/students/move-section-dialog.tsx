"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Dialog, TextField, useToast } from "@/components/ui";
import { Select } from "@/components/select";
import { api } from "@/lib/api";
import { useSectionOptions } from "@/lib/sections";

/**
 * Moves a student to another section of this year. Attendance, marks and
 * fees already recorded stay with them; the move shows in their class history.
 */
export function MoveSectionDialog({
  student,
  open,
  onClose,
  onMoved,
}: {
  student: { id: string; name: string; sectionId: string | null };
  open: boolean;
  onClose: () => void;
  onMoved: () => void | Promise<unknown>;
}) {
  const toast = useToast();
  // Only sections on campuses this login may manage.
  const sections = useSectionOptions({ campusScoped: true, enabled: open });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = sections.options.filter((o) => o.value !== student.sectionId);

  function close() {
    setError("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const res = await api<{ rollNo: number | null; section: { name: string; class: { name: string } } }>(
        `/students/${student.id}/move`,
        { method: "POST", body: { sectionId: f.get("sectionId"), reason: String(f.get("reason") ?? "").trim() || undefined } },
      );
      toast.success(
        `${student.name} moved to ${res.section.class.name} ${res.section.name}`,
        res.rollNo != null ? `New roll number ${res.rollNo}.` : undefined,
      );
      close();
      await onMoved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={`Move ${student.name} to another section`}
      description="For this academic year. Attendance, marks and fees already recorded stay with the student."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="move-section-form" loading={busy} disabled={!options.length}>
            Move student
          </Button>
        </>
      }
    >
      <form id="move-section-form" onSubmit={submit} className="flex flex-col gap-4">
        <Select label="New class and section" name="sectionId" required options={options} />
        <TextField label="Reason (optional)" name="reason" maxLength={200} placeholder="Placed in the wrong section at admission" />
        {sections.error && <Alert tone="danger">{sections.error}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
