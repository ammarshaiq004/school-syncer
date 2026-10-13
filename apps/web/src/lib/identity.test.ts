import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCnic, formatPhone, saveWarnings, whatsAppNumber } from "./identity.ts";

test("shows stored CNICs and B-Forms with dashes", () => {
  assert.equal(formatCnic("3520212345671"), "35202-1234567-1");
  assert.equal(formatCnic("35202-1234567-1"), "35202-1234567-1");
  assert.equal(formatCnic(null), "");
});

test("shows mobiles readably and builds WhatsApp numbers", () => {
  assert.equal(formatPhone("03001234567"), "0300 1234567");
  assert.equal(formatPhone("042 35761234"), "042 35761234");
  assert.equal(whatsAppNumber("03001234567"), "923001234567");
});

test("reads the warnings from a NEEDS_CONFIRMATION answer only", () => {
  const warnings = [{ kind: "duplicate", studentId: "s1", name: "Ali", admissionNo: "1", message: "m" }];
  assert.deepEqual(saveWarnings({ status: 409, data: { code: "NEEDS_CONFIRMATION", warnings } }), warnings);
  assert.equal(saveWarnings({ status: 409, data: { message: "taken" } }), null);
  assert.equal(saveWarnings({ status: 400, data: { code: "NEEDS_CONFIRMATION", warnings } }), null);
  assert.equal(saveWarnings(new Error("x")), null);
});
