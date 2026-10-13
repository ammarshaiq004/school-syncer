import assert from "node:assert/strict";
import { test } from "node:test";
import { STATUS_LABEL, statusDetail } from "./message-status.ts";

test("never shows a logged-only message as sent", () => {
  assert.equal(STATUS_LABEL.LOGGED, "Not delivered");
  assert.equal(statusDetail({ status: "LOGGED", error: null, attempts: 1 }), "Not delivered: no provider configured");
});

test("shows the provider error for failed and retrying messages", () => {
  assert.equal(statusDetail({ status: "FAILED", error: "WhatsApp API 400: bad number", attempts: 1 }), "Failed after 1 attempt: WhatsApp API 400: bad number");
  assert.equal(statusDetail({ status: "QUEUED", error: "SMS gateway 503", attempts: 2 }), "Retrying (attempt 2 failed): SMS gateway 503");
  assert.equal(statusDetail({ status: "QUEUED", error: null, attempts: 0 }), null);
  assert.equal(statusDetail({ status: "SENT", error: null, attempts: 1 }), null);
});
