/** One line of the multi-student entry form. */
export interface BulkRow {
  sectionId: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  admissionNo: string;
  guardianName: string;
  guardianRelation: string;
  guardianPhone: string;
}

export const emptyRow = (from?: Partial<BulkRow>): BulkRow => ({
  sectionId: from?.sectionId ?? "",
  firstName: "",
  lastName: "",
  gender: "",
  dateOfBirth: "",
  admissionNo: "",
  guardianName: from?.guardianName ?? "",
  guardianRelation: from?.guardianRelation ?? "Father",
  guardianPhone: from?.guardianPhone ?? "",
});

/** A line with nothing typed in it (the pre-filled class and relation don't count). */
export const isBlank = (r: BulkRow) =>
  !r.firstName.trim() && !r.lastName.trim() && !r.gender && !r.dateOfBirth.trim() && !r.admissionNo.trim() && !r.guardianName.trim() && !r.guardianPhone.trim();

export interface SectionNames {
  campus: string;
  class: string;
  section: string;
}

/**
 * The rows the import endpoint checks (the same ones an Excel upload sends).
 * `rowOf[i]` is the form line that import row i + 2 came from, so errors can
 * be shown next to the right line.
 */
export function toImportRows(rows: BulkRow[], names: (sectionId: string) => SectionNames | undefined) {
  const sent: Record<string, string>[] = [];
  const rowOf: number[] = [];
  rows.forEach((r, i) => {
    if (isBlank(r)) return;
    const where = names(r.sectionId);
    sent.push({
      campus: where?.campus ?? "",
      class: where?.class ?? "",
      section: where?.section ?? "",
      firstName: r.firstName.trim(),
      lastName: r.lastName.trim(),
      gender: r.gender,
      dateOfBirth: r.dateOfBirth.trim(),
      admissionNo: r.admissionNo.trim(),
      guardianName: r.guardianName.trim(),
      guardianRelation: r.guardianRelation,
      guardianPhone: r.guardianPhone.trim(),
    });
    rowOf.push(i);
  });
  return { sent, rowOf };
}

/** Errors by form line from the import endpoint's per-row answer (row numbers count the header as 1). */
export function errorsByLine(result: { row: number; errors: string[]; warnings?: string[] }[], rowOf: number[]) {
  const lines = new Map<number, { errors: string[]; warnings: string[] }>();
  for (const r of result) {
    const line = rowOf[r.row - 2];
    if (line !== undefined && (r.errors.length || r.warnings?.length)) lines.set(line, { errors: r.errors, warnings: r.warnings ?? [] });
  }
  return lines;
}
