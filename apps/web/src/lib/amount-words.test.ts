import assert from "node:assert/strict";
import { test } from "node:test";
import { numberInWords, rupeesInWords } from "./amount-words.ts";

test("writes small amounts", () => {
  assert.equal(numberInWords(0), "Zero");
  assert.equal(numberInWords(7), "Seven");
  assert.equal(numberInWords(15), "Fifteen");
  assert.equal(numberInWords(40), "Forty");
  assert.equal(numberInWords(99), "Ninety-Nine");
  assert.equal(numberInWords(105), "One Hundred Five");
});

test("groups by thousand, lakh and crore", () => {
  assert.equal(numberInWords(12_500), "Twelve Thousand Five Hundred");
  assert.equal(numberInWords(100_000), "One Lakh");
  assert.equal(numberInWords(1_250_000), "Twelve Lakh Fifty Thousand");
  assert.equal(numberInWords(30_000_001), "Three Crore One");
  assert.equal(numberInWords(1_000_000_000), "One Hundred Crore");
});

test("reads as a receipt line", () => {
  assert.equal(rupeesInWords(5_300), "Rupees Five Thousand Three Hundred Only");
  assert.equal(numberInWords(-500), "Minus Five Hundred");
});
