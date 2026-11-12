import assert from "node:assert/strict";
import { test } from "node:test";
import { gridToRows } from "./student-sheet.ts";

test("reads the admission date and opening balance columns by title or alias", () => {
  const { rows, ignored, missing } = gridToRows([
    ["First Name", "Class", "Guardian Name", "Guardian Phone", "Admission Date", "Balance"],
    ["Ahmed", "Grade 1 A", "Imran", "0300 1234567", "01/04/2023", "-700"],
  ]);
  assert.deepEqual(rows, [
    { firstName: "Ahmed", class: "Grade 1 A", guardianName: "Imran", guardianPhone: "0300 1234567", admissionDate: "01/04/2023", openingBalance: "-700" },
  ]);
  assert.deepEqual(ignored, []);
  assert.deepEqual(missing, []);
});
