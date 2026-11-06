"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Save } from "lucide-react";
import { Alert, Button, Drawer, Field, NativeSelect, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import { useApi } from "@/lib/use-api";

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Reads a form into a request body: blank fields are left out. */
export const formBody = (form: HTMLFormElement) =>
  Object.fromEntries([...new FormData(form).entries()].filter(([, v]) => typeof v === "string" && v.trim() !== ""));

/** A side panel with a form that POSTs to `path`, then reloads the list. */
export function RecordDrawer({
  open,
  onOpenChange,
  title,
  path,
  method = "POST",
  toBody = formBody,
  onSaved,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  path: string;
  method?: "POST" | "PATCH";
  toBody?: (form: HTMLFormElement) => Record<string, unknown>;
  onSaved: () => void | Promise<void>;
  children: ReactNode;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formId = `drawer-${title.replace(/\W+/g, "-").toLowerCase()}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(path, { method, body: toBody(event.currentTarget) });
      await onSaved();
      toast.success("Saved");
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving} icon={<Save />}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="grid gap-4">
        {children}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Drawer>
  );
}

interface StudentHit {
  id: string;
  firstName: string;
  lastName: string | null;
  admissionNo: string;
  enrollments: { section: { name: string; class: { name: string } } }[];
}

/** Search by name or admission number, then pick the student; submits as `studentId`. */
export function StudentPicker({ required }: { required?: boolean }) {
  const [search, setSearch] = useState("");
  const q = search.trim();
  const hits = useApi<StudentHit[]>(q.length >= 2 ? `/students?search=${encodeURIComponent(q)}` : null);
  const options = (q.length >= 2 ? (hits.data ?? []) : []).map((s) => {
    const e = s.enrollments[0];
    return { value: s.id, label: `${fullName(s)} (${s.admissionNo}${e ? `, ${e.section.class.name} ${e.section.name}` : ""})` };
  });
  return (
    <div className="grid gap-2">
      <Field label="Find student (name or admission number)" value={search} onChange={(e) => setSearch(e.target.value)} />
      <NativeSelect name="studentId" required={required} aria-label="Student" wrapperClassName="w-full" className="w-full">
        <option value="">{q.length < 2 ? "Search first" : options.length ? "Choose a student" : "No match"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
