"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { Select } from "@/components/select";
import { Alert, Button, Drawer, Field, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useSectionOptions } from "@/lib/sections";

const FORM_ID = "new-student-form";

/** "New student" side panel: enrols a student into a section with a primary guardian. */
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
        },
      });
      formEl.reset();
      setError("");
      onOpenChange(false);
      toast.success("Student added", `${f.get("firstName")} is now enrolled.`);
      await onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setError("");
      }}
      title="New student"
      description="Enrol a student into a section. The admission number is assigned automatically."
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving} icon={<Save />}>
            Save student
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <p className="col-span-full text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Student</p>
        <div className="sm:col-span-full">
          <Select label="Class and section" name="sectionId" required options={sections.options} />
        </div>
        <Field label="First name" name="firstName" required />
        <Field label="Last name" name="lastName" />
        <Select
          label="Gender"
          name="gender"
          options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]}
        />
        <Field label="Date of birth" name="dateOfBirth" type="date" />
        <Field label="B-Form number" name="bFormNo" />
        <Field label="Address" name="address" />
        <p className="col-span-full mt-2 text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Primary guardian</p>
        <Field label="Guardian name" name="guardianName" required />
        <Field label="Guardian phone (WhatsApp)" name="guardianPhone" type="tel" placeholder="03001234567" required />
        <Select
          label="Relation"
          name="relation"
          options={["Father", "Mother", "Guardian", "Uncle", "Grandparent"].map((r) => ({ value: r, label: r }))}
        />
        <Field label="Guardian CNIC" name="cnic" placeholder="35202-1234567-1" />
        {error && (
          <Alert tone="danger" className="col-span-full">
            {error}
          </Alert>
        )}
      </form>
    </Drawer>
  );
}
