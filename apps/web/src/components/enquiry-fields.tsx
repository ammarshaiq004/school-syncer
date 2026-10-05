import { SelectField, TextareaField, TextField } from "./kit/inputs";

export interface CampusOption {
  id: string;
  name: string;
  classes: { id: string; name: string }[];
}

function GroupHeading({ children }: { children: string }) {
  return (
    <p className="col-span-full -mb-1 text-xs font-medium uppercase tracking-[0.04em] text-fg-muted first:mt-0 [&:not(:first-child)]:mt-2">
      {children}
    </p>
  );
}

/**
 * Applicant fields shared by the staff form and the public admission page.
 * Render inside a grid (e.g. `grid gap-4 sm:grid-cols-2`); headings and notes span the full row.
 */
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
      <GroupHeading>Child</GroupHeading>
      <SelectField
        label="Campus"
        name="campusId"
        required
        value={campusId}
        onChange={(e) => onCampusChange(e.target.value)}
        options={campuses.map((c) => ({ value: c.id, label: c.name }))}
      />
      <SelectField
        label="Class applying for"
        name="classId"
        required
        options={classes.map((c) => ({ value: c.id, label: c.name }))}
        hint={classes.length === 0 ? "No classes are open at this campus yet." : undefined}
      />
      <TextField label="Child's full name" name="childName" required autoComplete="off" placeholder="Ayesha Khan" />
      <SelectField label="Gender" name="gender" options={[{ value: "MALE", label: "Boy" }, { value: "FEMALE", label: "Girl" }]} />
      <TextField label="Date of birth" name="dateOfBirth" type="date" />
      <TextField label="Previous school" name="previousSchool" placeholder="Optional" />

      <GroupHeading>Parent or guardian</GroupHeading>
      <TextField label="Parent or guardian name" name="guardianName" required autoComplete="name" placeholder="Imran Khan" />
      <TextField
        label="Phone (WhatsApp)"
        name="guardianPhone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="03001234567"
        required
      />
      <TextField label="Email" name="guardianEmail" type="email" autoComplete="email" placeholder="Optional" wrapperClassName="sm:col-span-full" />
      <TextareaField label="Anything we should know?" name="notes" rows={3} wrapperClassName="sm:col-span-full" />
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
