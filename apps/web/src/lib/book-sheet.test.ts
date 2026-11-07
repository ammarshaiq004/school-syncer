import assert from "node:assert/strict";
import test from "node:test";
import { gridToBookRows } from "./book-sheet.ts";

test("matches headers by title or alias and skips blank rows", () => {
  const { rows, ignored, missing } = gridToBookRows([
    ["Book Name", "Writer", "ISBN No", "Qty", "Colour"],
    ["Gulistan", "Saadi", 9789698123456, 3, "red"],
    [null, null, null, null, null],
    ["Atlas", "", "", "", ""],
  ]);
  assert.deepEqual(rows, [
    { title: "Gulistan", author: "Saadi", isbn: "9789698123456", copies: "3" },
    { title: "Atlas" },
  ]);
  assert.deepEqual(ignored, ["Colour"]);
  assert.deepEqual(missing, []);
});

test("says when there is no title column", () => {
  assert.deepEqual(gridToBookRows([["Author"], ["Saadi"]]).missing, ["Title"]);
});
