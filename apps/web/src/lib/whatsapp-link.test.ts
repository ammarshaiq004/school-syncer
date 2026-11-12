import assert from "node:assert/strict";
import { test } from "node:test";
import { formatWhatsAppNumber, LINK_STATE_LABEL, pollsLink } from "./whatsapp-link.ts";

test("shows Pakistani mobiles the way people write them and other countries with a plus", () => {
  assert.equal(formatWhatsAppNumber("923001234567"), "0300 1234567");
  assert.equal(formatWhatsAppNumber("447911123456"), "+447911123456");
  assert.equal(formatWhatsAppNumber(null), "");
});

test("only asks again while waiting for the scan", () => {
  assert.equal(pollsLink({ state: "WAITING_FOR_SCAN" }), true);
  assert.equal(pollsLink({ state: "CONNECTED" }), false);
  assert.equal(pollsLink({ state: "NOT_LINKED" }), false);
  assert.equal(pollsLink(null), false);
  assert.equal(LINK_STATE_LABEL.CONNECTED, "Connected");
});
