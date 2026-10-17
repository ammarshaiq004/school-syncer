import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvent, envelope, isSecretKey, parseDsn, parseStack, scrub, scrubText } from "./error-reporting.ts";

test("reads Sentry and GlitchTip DSNs, and refuses malformed ones", () => {
  assert.deepEqual(parseDsn("https://abc@o1.ingest.sentry.io/42"), {
    envelopeUrl: "https://o1.ingest.sentry.io/api/42/envelope/",
    publicKey: "abc",
    origin: "https://o1.ingest.sentry.io",
  });
  assert.equal(parseDsn("https://k@glitchtip.example.pk/errors/3")?.envelopeUrl, "https://glitchtip.example.pk/errors/api/3/envelope/");
  for (const bad of [undefined, "", "nope", "https://host/1", "https://k@host/"]) assert.equal(parseDsn(bad), null);
});

test("masks CNICs, phones, emails, tokens and card numbers in text", () => {
  assert.equal(scrubText("CNIC 35202-1234567-1, phone 0300-1234567"), "CNIC [cnic], phone [phone]");
  assert.equal(scrubText("mail sana@school.pk"), "mail [email]");
  assert.equal(scrubText("?token=abc123&x=1"), "?token=[redacted]&x=1");
  assert.equal(scrubText("card 4111 1111 1111 1111"), "card [number]");
  assert.equal(scrubText("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.abcdefghijk"), "Bearer [jwt]");
});

test("drops values under secret keys at any depth", () => {
  assert.equal(isSecretKey("newPassword"), true);
  assert.equal(isSecretKey("guardian_cnic"), true);
  assert.equal(isSecretKey("name"), false);
  assert.deepEqual(scrub({ body: { password: "p", phone: "0300", name: "Ali", list: [{ token: "t" }] } }), {
    body: { password: "[redacted]", phone: "[redacted]", name: "Ali", list: [{ token: "[redacted]" }] },
  });
});

test("builds a scrubbed event tagged with the API request id", () => {
  const event = buildEvent(new Error("Could not save 03001234567"), { requestId: "abc-12345678", tags: { api_path: "/students" } }, { path: "/students/new" });
  assert.equal((event.exception as { values: { value: string }[] }).values[0].value, "Could not save [phone]");
  assert.deepEqual(event.tags, { api_path: "/students", request_id: "abc-12345678" });
  assert.deepEqual(event.request, { url: "/students/new", headers: undefined });
  const [header, item, body] = envelope(event).split("\n");
  assert.equal(JSON.parse(header).event_id, event.event_id);
  assert.deepEqual(JSON.parse(item), { type: "event" });
  assert.equal(JSON.parse(body).platform, "javascript");
});

test("reads Chrome and Firefox stack lines", () => {
  const frames = parseStack("Error: x\n    at save (https://app.pk/_next/a.js:10:5)\nload@https://app.pk/_next/b.js:3:7");
  assert.deepEqual(
    frames.map((f) => [f.function, f.lineno]),
    [["load", 3], ["save", 10]],
  );
});
