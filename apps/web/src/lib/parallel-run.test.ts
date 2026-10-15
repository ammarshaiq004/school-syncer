import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceTable, cellText, feeDayTable, methodLabel, voucherTable, type AttendanceGrid, type FeeTotals, type VoucherTally } from "./parallel-run.ts";

test("labels payment methods", () => {
  assert.equal(methodLabel("CASH"), "Cash");
  assert.equal(methodLabel("BANK_TRANSFER"), "Bank transfer");
});

test("lays fees out per day with a column per method and a totals row", () => {
  const r: FeeTotals = {
    from: "2026-10-01",
    to: "2026-10-02",
    total: 11000,
    receipts: 3,
    methods: ["CASH", "BANK"],
    byDay: [
      { date: "2026-10-01", total: 6000, receipts: 1, byMethod: { CASH: 6000 } },
      { date: "2026-10-02", total: 5000, receipts: 2, byMethod: { CASH: 3000, BANK: 2000 } },
    ],
    byMethod: [
      { name: "CASH", total: 9000, receipts: 2 },
      { name: "BANK", total: 2000, receipts: 1 },
    ],
    byHead: [],
  };
  const t = feeDayTable(r);
  assert.deepEqual(t.header, ["Date", "Receipts", "Cash", "Bank", "Total"]);
  assert.deepEqual(t.rows, [
    ["2026-10-01", 1, 6000, 0, 6000],
    ["2026-10-02", 2, 3000, 2000, 5000],
    ["Total", 3, 9000, 2000, 11000],
  ]);
});

test("adds a totals row to the voucher table", () => {
  const tally = (name: string, issued: number): VoucherTally => ({ name, issued, billed: issued * 100, paid: issued, partial: 0, unpaid: 0, carried: 0, collected: issued * 100, outstanding: 0 });
  const t = voucherTable([tally("Grade 1", 2), tally("Grade 2", 1)], tally("All vouchers", 3), "Class");
  assert.equal(t.header[0], "Class");
  assert.deepEqual(t.rows.at(-1), ["Total", 3, 300, 3, 0, 0, 0, 300, 0]);
  assert.equal(t.rows.length, 3);
});

test("grids attendance as present/marked with blanks for days not marked", () => {
  const r: AttendanceGrid = {
    from: "2026-10-01",
    to: "2026-10-02",
    dates: ["2026-10-01", "2026-10-02"],
    sections: [
      { sectionId: "a", name: "Grade 1 A", cells: { "2026-10-01": { present: 18, marked: 20, percent: 90 } }, days: 1, present: 18, marked: 20, percent: 90 },
      { sectionId: "b", name: "Grade 2 A", cells: { "2026-10-02": { present: 9, marked: 10, percent: 90 } }, days: 1, present: 9, marked: 10, percent: 90 },
    ],
    byDate: [
      { date: "2026-10-01", sections: 1, present: 18, marked: 20, percent: 90 },
      { date: "2026-10-02", sections: 1, present: 9, marked: 10, percent: 90 },
    ],
    present: 27,
    marked: 30,
    percent: 90,
  };
  const t = attendanceTable(r);
  assert.deepEqual(t.header, ["Section", "2026-10-01", "2026-10-02", "Days marked", "% present"]);
  assert.deepEqual(t.rows[0], ["Grade 1 A", "18/20", "", 1, 90]);
  assert.deepEqual(t.rows.at(-1), ["All sections", "18/20", "9/10", 2, 90]);
  assert.equal(cellText(undefined), "");
});
