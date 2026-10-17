import assert from "node:assert/strict";
import { test } from "node:test";
import { describeBrowser, PROBLEM_STATUS_LABEL, PROBLEM_STATUSES } from "./problem-reports.ts";

test("names the browser and system from a user agent", () => {
  assert.equal(
    describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"),
    "Chrome 141 on Windows",
  );
  assert.equal(
    describeBrowser("Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36"),
    "Samsung Internet 27 on Android 14",
  );
  assert.equal(
    describeBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"),
    "Safari 18 on iOS",
  );
  assert.equal(describeBrowser("Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36 Edg/141.0"), "Edge 141 on Windows");
});

test("keeps an unknown agent short, and says when there is none", () => {
  assert.equal(describeBrowser("android 14"), "android 14");
  assert.equal(describeBrowser("x".repeat(80)), `${"x".repeat(60)}…`);
  assert.equal(describeBrowser(null), "Unknown");
});

test("labels every status", () => {
  assert.deepEqual(
    PROBLEM_STATUSES.map((s) => PROBLEM_STATUS_LABEL[s]),
    ["New", "In progress", "Fixed", "Won't fix"],
  );
});
