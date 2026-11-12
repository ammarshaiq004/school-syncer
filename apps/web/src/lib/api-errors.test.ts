import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldLabel, issueMessage } from "./api-errors.ts";

test("field paths become words a user knows", () => {
  assert.equal(fieldLabel("dueDate"), "Due date");
  assert.equal(fieldLabel("lines.0.amount"), "Amount");
  assert.equal(fieldLabel(""), "");
});

test("an issue reads as a sentence, not a path", () => {
  assert.equal(issueMessage({ path: "dueDate", message: "Enter a real date" }), "Due date: Enter a real date");
  assert.equal(issueMessage({ path: "", message: "Bad request" }), "Bad request");
});
