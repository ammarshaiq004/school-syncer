"use client";

import { useRef, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { Select } from "@/components/select";
import { Alert, Button, Drawer, Field, useToast } from "@/components/ui";
import { WarningList } from "@/components/students/guardian-dialogs";
import { api } from "@/lib/api";
import { saveWarnings, type SaveWarning } from "@/lib/identity";
import { usePersistedState } from "@/lib/persisted";
import { useSectionOptions } from "@/lib/sections";

const FORM_ID = "new-student-form";

/**
 * "New student" side panel: enrols a student into a section with a primary
 * guardian. The class and section stay chosen for the next entry, and "Save
 * and add another" keeps the panel open, for entering a class at a time.
 */
export function AddStudentDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void | Promise<void>;
}) {
  const toast = useToast();
  const sections = useSectionOptions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Shown when the API asks to confirm a guardian name clash or likely duplicate.
  const [warnings, setWarnings] = useState<SaveWarning[] | null>(null);
  const [sectionId, setSectionId] = usePersistedState("schoolsyncer.new-student.section", "");
  const another = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setSaving(true);
    try {
      await api("/students", {
        method: "POST",
        body: {
          sectionId: f.get("sectionId"),
          firstName: f.get("firstName"),
          lastName: f.get("lastName") || undefined,
          gender: f.get("gender"),
          dateOfBirth: f.get("dateOfBirth") || undefined,
          bFormNo: f.get("bFormNo") || undefined,
          address: f.get("address") || undefined,
          guardians: [
            {
              name: f.get("guardianName"),
              phone: f.get("guardianPhone"),
              relation: f.get("relation"),
              cnic: f.get("cnic") || undefined,
              isPrimary: true,
            },
          ],
          confirmed: warnings !== null,
        },
      });
      setSectionId(String(f.get("sectionId") ?? ""));
      formEl.reset();
      setError("");
      setWarnings(null);
      toast.success("Student added", `${f.get("firstName")} is now enrolled.`);
      if (another.current) (formEl.elements.namedItem("firstName") as HTMLInputElement | null)?.focus();
      else onOpenChange(false);
      await onCreated();
    } catch (e) {
      const found = saveWarnings(e);
      if (found) {
        setWarnings(found);
        setError("");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  const known = sections.options.some((o) => o.value === sectionId);
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setError("");
          setWarnings(null);
        }
      }}
      title="New student"
      description="Enrol a student into a section. The admission number is assigned automatically."
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="secondary" loading={saving} onClick={() => (another.current = true)}>
            {warnings ? "Save anyway and add another" : "Save and add another"}
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving} icon={<Save />} onClick={() => (another.current = false)}>
            {warnings ? "Save anyway" : "Save student"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} onChange={() => warnings && setWarnings(null)} className="grid gap-4 sm:grid-cols-2">
        <p className="col-span-full text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Student</p>
        <div className="sm:col-span-full">
          {/* Remembered between entries, so a class can be entered one student after another. */}
          <Select
            key={known ? sectionId : "none"}
            label="Class and section"
            name="sectionId"
            required
            defaultValue={known ? sectionId : undefined}
            options={sections.options}
          />
        </div>
        <Field label="First name" name="firstName" required />
        <Field label="Last name" name="lastName" />
        <Select
          label="Gender"
          name="gender"
          options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]}
        />
        <Field label="Date of birth" name="dateOfBirth" type="date" />
        <Field label="B-Form number" name="bFormNo" placeholder="35202-1234567-1" inputMode="numeric" />
        <Field label="Address" name="address" />
        <p className="col-span-full mt-2 text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Primary guardian</p>
        <Field label="Guardian name" name="guardianName" required />
        <Field label="Guardian phone (WhatsApp)" name="guardianPhone" type="tel" placeholder="0300 1234567" required />
        <Select
          label="Relation"
          name="relation"
          options={["Father", "Mother", "Guardian", "Uncle", "Grandparent"].map((r) => ({ value: r, label: r }))}
        />
        <Field label="Guardian CNIC" name="cnic" placeholder="35202-1234567-1" inputMode="numeric" />
        {warnings && (
          <div className="col-span-full">
            <WarningList warnings={warnings} />
          </div>
        )}
        {error && (
          <Alert tone="danger" className="col-span-full">
            {error}
          </Alert>
        )}
      </form>
    </Drawer>
  );
}
