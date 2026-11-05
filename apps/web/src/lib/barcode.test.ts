import assert from "node:assert/strict";
import test from "node:test";
import { barRuns } from "./barcode.ts";

test("barRuns turns modules into bars with their start and width", () => {
  assert.deepEqual(barRuns("1101000111"), [
    { x: 0, w: 2 },
    { x: 3, w: 1 },
    { x: 7, w: 3 },
  ]);
});

test("barRuns of nothing is no bars", () => {
  assert.deepEqual(barRuns(""), []);
  assert.deepEqual(barRuns("000"), []);
});
