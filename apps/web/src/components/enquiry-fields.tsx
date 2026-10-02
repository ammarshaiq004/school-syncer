import { Select } from "./select";
import { Field, TextArea } from "./ui";

export interface CampusOption {
  id: string;
  name: string;
  classes: { id: string; name: string }[];
}

/** Applicant fields shared by the staff form and the public admission page. */
export function EnquiryFields({
  campuses,
  campusId,
  onCampusChange,
}: {
  campuses: CampusOption[];
  campusId: string;
  onCampusChange: (id: string) => void;
}) {
  const classes = campuses.find((c) => c.id === campusId)?.classes ?? [];
  return (
    <>
      <Select
        label="Campus"
        name="campusId"
        value={campusId}
        onChange={(e) => onCampusChange(e.target.value)}
        options={campuses.map((c) => ({ value: c.id, label: c.name }))}
      />
      <Select label="Class applying for" name="classId" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
      <Field label="Child's full name" name="childName" required />
      <Select label="Gender" name="gender" options={[{ value: "MALE", label: "Boy" }, { value: "FEMALE", label: "Girl" }]} />
      <Field label="Date of birth" name="dateOfBirth" type="date" />
      <Field label="Previous school" name="previousSchool" />
      <Field label="Parent / guardian name" name="guardianName" required />
      <Field label="Phone (WhatsApp)" name="guardianPhone" placeholder="03001234567" required />
      <Field label="Email" name="guardianEmail" type="email" />
      <TextArea label="Anything we should know?" name="notes" rows={2} />
    </>
  );
}

export function enquiryBody(f: FormData) {
  return {
    campusId: f.get("campusId"),
    classId: f.get("classId"),
    childName: f.get("childName"),
    gender: f.get("gender"),
    dateOfBirth: f.get("dateOfBirth") || undefined,
    previousSchool: f.get("previousSchool") || undefined,
    guardianName: f.get("guardianName"),
    guardianPhone: f.get("guardianPhone"),
    guardianEmail: f.get("guardianEmail") || undefined,
    notes: f.get("notes") || undefined,
  };
}
