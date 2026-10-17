import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, isVersion, raisesMinimum } from "./app-version.ts";

test("reads store versions only", () => {
  assert.equal(isVersion("1.4.0"), true);
  assert.equal(isVersion("2"), true);
  assert.equal(isVersion("v1.4"), false);
  assert.equal(isVersion("1.4.0-beta"), false);
});

test("compares part by part as numbers", () => {
  assert.ok((compareVersions("1.10.0", "1.9.9") ?? 0) > 0);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("x", "1.0.0"), null);
});

test("spots a change that would lock builds out", () => {
  assert.equal(raisesMinimum("1.2.0", "1.3.0"), true);
  assert.equal(raisesMinimum("1.2.0", "1.2"), false);
  assert.equal(raisesMinimum("1.2.0", "1.1.0"), false);
});
