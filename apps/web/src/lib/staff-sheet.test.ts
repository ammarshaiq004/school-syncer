import assert from "node:assert/strict";
import { test } from "node:test";
import { staffGridToRows } from "./staff-sheet.ts";

test("matches headers by title, key or alias and skips the rest", () => {
  const { rows, ignored, missing } = staffGridToRows([
    ["Staff Name", "Designation", "Mobile", "Salary", "Favourite colour"],
    ["Ayesha Khan", "Maths teacher", "0300 1234567", "45,000", "blue"],
    ["", "", "", "", ""],
  ]);
  assert.deepEqual(rows, [{ name: "Ayesha Khan", designation: "Maths teacher", phone: "0300 1234567", basicSalary: "45,000" }]);
  assert.deepEqual(ignored, ["Favourite colour"]);
  assert.deepEqual(missing, []);
});

test("reports the required columns that are missing", () => {
  const { missing } = staffGridToRows([["Name"], ["Ayesha"]]);
  assert.deepEqual(missing, ["Designation", "Email or Phone"]);
});

test("reads a repeated header only once", () => {
  const { rows, ignored } = staffGridToRows([["Name", "Name"], ["A", "B"]]);
  assert.deepEqual(rows, [{ name: "A" }]);
  assert.deepEqual(ignored, ["Name"]);
});
