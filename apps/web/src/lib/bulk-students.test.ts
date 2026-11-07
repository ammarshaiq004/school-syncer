import assert from "node:assert/strict";
import test from "node:test";
import { emptyRow, errorsByLine, isBlank, toImportRows } from "./bulk-students.ts";

const names = (id: string) => (id === "s1" ? { campus: "Main", class: "Grade 1", section: "A" } : undefined);

test("a line with only the pre-filled class and relation is blank", () => {
  assert.equal(isBlank(emptyRow({ sectionId: "s1", guardianName: "" })), true);
  assert.equal(isBlank({ ...emptyRow(), firstName: "Ali" }), false);
});

test("siblings start from the previous line's class and guardian", () => {
  const next = emptyRow({ sectionId: "s1", guardianName: "Imran", guardianPhone: "0300 1234567", guardianRelation: "Mother" });
  assert.deepEqual([next.sectionId, next.guardianName, next.guardianPhone, next.guardianRelation, next.firstName], ["s1", "Imran", "0300 1234567", "Mother", ""]);
});

test("sends only filled lines, with the class, section and campus names", () => {
  const rows = [
    { ...emptyRow({ sectionId: "s1" }), firstName: " Ali ", gender: "Male", guardianName: "Imran", guardianPhone: "0300 1234567" },
    emptyRow({ sectionId: "s1" }),
    { ...emptyRow(), firstName: "Sana", gender: "Female" },
  ];
  const { sent, rowOf } = toImportRows(rows, names);
  assert.equal(sent.length, 2);
  assert.deepEqual(rowOf, [0, 2]);
  assert.deepEqual([sent[0].firstName, sent[0].class, sent[0].section, sent[0].campus], ["Ali", "Grade 1", "A", "Main"]);
  assert.equal(sent[1].class, "");
});

test("maps import errors back to the form line", () => {
  const lines = errorsByLine(
    [
      { row: 2, errors: [], warnings: [] },
      { row: 3, errors: ["Class is missing"], warnings: [] },
      { row: 4, errors: [], warnings: ["Same name as row 2"] },
    ],
    [0, 2, 5],
  );
  assert.deepEqual([...lines.keys()], [2, 5]);
  assert.deepEqual(lines.get(2)?.errors, ["Class is missing"]);
  assert.deepEqual(lines.get(5)?.warnings, ["Same name as row 2"]);
});
