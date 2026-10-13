import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell } from "./csv.ts";

test("neutralises cells a spreadsheet would run as formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\",\"Fees\")"), `"'=HYPERLINK(""http://x"",""Fees"")"`);
  assert.equal(csvCell("+92 300 1234567"), "'+92 300 1234567");
  assert.equal(csvCell("-2+3+cmd|' /C calc'!A0"), "'-2+3+cmd|' /C calc'!A0");
  assert.equal(csvCell("@SUM(A1:A9)"), "'@SUM(A1:A9)");
  assert.equal(csvCell("\t=1+1"), "'\t=1+1");
  assert.equal(csvCell("\r=1+1"), `"'\r=1+1"`);
});

test("leaves plain text and numbers alone", () => {
  assert.equal(csvCell("Ali Khan"), "Ali Khan");
  assert.equal(csvCell("a=b"), "a=b");
  assert.equal(csvCell(-500), "-500");
  assert.equal(csvCell("-500"), "-500");
  assert.equal(csvCell("+12.5"), "+12.5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("quotes commas, quotes and line breaks", () => {
  assert.equal(csvCell("Khan, Ali"), '"Khan, Ali"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
});
