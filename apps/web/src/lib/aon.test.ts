import assert from "node:assert/strict";
import { test } from "node:test";
import { isAonShortcut, shortTokens } from "./aon.ts";

const key = (over: object) => ({ key: "/", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

test("Ctrl or Cmd with the slash key opens Aon, nothing else does", () => {
  assert.equal(isAonShortcut(key({ ctrlKey: true })), true);
  assert.equal(isAonShortcut(key({ metaKey: true })), true);
  assert.equal(isAonShortcut(key({})), false);
  assert.equal(isAonShortcut(key({ ctrlKey: true, key: "k" })), false);
  assert.equal(isAonShortcut(key({ ctrlKey: true, altKey: true })), false);
});

test("token counts are shortened for the panel", () => {
  assert.equal(shortTokens(400), "400");
  assert.equal(shortTokens(12_400), "12K");
  assert.equal(shortTokens(1_000_000), "1M");
  assert.equal(shortTokens(1_250_000), "1.3M");
});
