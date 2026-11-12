import assert from "node:assert/strict";
import { test } from "node:test";
import { aonPose, isAonShortcut, shortTokens } from "./aon.ts";

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

test("Hudhud's pose follows what Aon is doing", () => {
  const base = { active: true, blocked: false, celebrating: false, pending: false, slow: false, listening: false, drowsy: false };
  assert.equal(aonPose(base), "idle");
  assert.equal(aonPose({ ...base, active: false }), "sleeping");
  assert.equal(aonPose({ ...base, blocked: true, pending: true }), "sleeping");
  assert.equal(aonPose({ ...base, listening: true }), "listening");
  assert.equal(aonPose({ ...base, pending: true }), "thinking");
  assert.equal(aonPose({ ...base, pending: true, slow: true }), "searching");
  assert.equal(aonPose({ ...base, pending: true, celebrating: true }), "success");
  assert.equal(aonPose({ ...base, drowsy: true }), "sleeping");
  assert.equal(aonPose({ ...base, drowsy: true, listening: true }), "listening");
});
