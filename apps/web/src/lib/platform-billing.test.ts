import assert from "node:assert/strict";
import { test } from "node:test";
import { billOwed, billState, businessLines, noticeTone, parseTaxPercent, schoolLines, totalOwed, type PlatformSettings } from "./platform-billing.ts";

const bill = (over: Partial<{ amount: number; amountPaid: number; status: "UNPAID" | "PAID" | "VOID"; dueDate: string }> = {}) => ({
  amount: 10_000,
  amountPaid: 0,
  status: "UNPAID" as const,
  dueDate: "2026-10-10T00:00:00.000Z",
  ...over,
});

test("still owed is amount less paid, and nothing on paid or void bills", () => {
  assert.equal(billOwed(bill()), 10_000);
  assert.equal(billOwed(bill({ amountPaid: 4_000 })), 6_000);
  assert.equal(billOwed(bill({ status: "PAID", amountPaid: 10_000 })), 0);
  assert.equal(billOwed(bill({ status: "VOID", amountPaid: 3_000 })), 0);
  assert.equal(billOwed(bill({ amountPaid: 12_000 })), 0);
  assert.equal(totalOwed([bill(), bill({ amountPaid: 2_500 }), bill({ status: "VOID" })]), 17_500);
});

test("bill state: part paid before the due date, overdue after it", () => {
  assert.equal(billState(bill(), "2026-10-05"), "UNPAID");
  assert.equal(billState(bill({ amountPaid: 1 }), "2026-10-05"), "PART_PAID");
  assert.equal(billState(bill({ amountPaid: 1 }), "2026-10-10"), "PART_PAID");
  assert.equal(billState(bill({ amountPaid: 1 }), "2026-10-11"), "OVERDUE");
  assert.equal(billState(bill(), "2026-11-01"), "OVERDUE");
  assert.equal(billState(bill({ status: "PAID", amountPaid: 10_000 }), "2027-01-01"), "PAID");
  assert.equal(billState(bill({ status: "VOID" }), "2027-01-01"), "VOID");
});

const settings: PlatformSettings = {
  businessName: "SchoolSyncer",
  address: "12 Main Boulevard, Lahore",
  phone: "042 111 222 333",
  email: null,
  ntn: null,
  strn: "  ",
  salesTaxPercent: null,
  paymentInstructions: null,
};

test("business lines leave out tax numbers that are not set", () => {
  assert.deepEqual(businessLines(settings), ["12 Main Boulevard, Lahore", "042 111 222 333"]);
  assert.deepEqual(businessLines({ ...settings, email: "billing@schoolsyncer.pk", ntn: "1234567-8", strn: "17-00-1234-567-89" }), [
    "12 Main Boulevard, Lahore",
    "042 111 222 333 | billing@schoolsyncer.pk",
    "NTN 1234567-8 | STRN 17-00-1234-567-89",
  ]);
  assert.deepEqual(businessLines({ ...settings, address: null, phone: null }), []);
});

test("school lines show city and contacts", () => {
  assert.deepEqual(schoolLines({ id: "s", name: "Iqra", slug: "iqra", city: "Multan", phone: "0300 1234567", email: "office@iqra.pk" }), [
    "Multan",
    "0300 1234567 | office@iqra.pk",
  ]);
  assert.deepEqual(schoolLines({ id: "s", name: "Iqra", slug: "iqra", city: null, phone: null, email: null }), []);
});

test("sales tax box: empty is off, whole percents 1 to 50", () => {
  assert.deepEqual(parseTaxPercent(""), { value: null });
  assert.deepEqual(parseTaxPercent("  "), { value: null });
  assert.deepEqual(parseTaxPercent("16"), { value: 16 });
  assert.deepEqual(parseTaxPercent("16%"), { value: 16 });
  assert.ok("error" in parseTaxPercent("0"));
  assert.ok("error" in parseTaxPercent("51"));
  assert.ok("error" in parseTaxPercent("7.5"));
  assert.ok("error" in parseTaxPercent("abc"));
});

test("notice tone follows severity", () => {
  assert.equal(noticeTone("INFO"), "info");
  assert.equal(noticeTone("WARNING"), "warning");
  assert.equal(noticeTone("URGENT"), "danger");
});
