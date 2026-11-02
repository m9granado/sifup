import assert from "node:assert/strict";
import test from "node:test";
import { mergedReceipt, parsePaymentReceipt } from "./payment-receipt";

test("receipt date precision and explicit offset survive without guessed clock time", () => {
  assert.deepEqual(parsePaymentReceipt("2026-10-28"), { paidDate: "2026-10-28", paidAt: undefined });
  assert.deepEqual(parsePaymentReceipt("2026-10-28T00:02-03:00"), { paidDate: "2026-10-28", paidAt: "2026-10-28T03:02:00.000Z" });
  assert.deepEqual(parsePaymentReceipt("2026-10-28T23:59:30+14:00"), { paidDate: "2026-10-28", paidAt: "2026-10-28T09:59:30.000Z" });
  assert.equal(parsePaymentReceipt("2024-02-29").paidDate, "2024-02-29");
});

test("receipt boundary rejects impossible calendars, clocks and missing/invalid zones", () => {
  for (const bad of ["", "0000-01-01", "2026-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-10-28 00:02", "2026-10-28T00:02", "2026-10-28T24:00Z", "2026-10-28T00:60Z", "2026-10-28T00:02:60Z", "2026-10-28T00:02-00:00", "2026-10-28T00:02+14:01", "2026-10-28T00:02+15:00", "2026-10-28junk"]) {
    assert.throws(() => parsePaymentReceipt(bad), Error, bad);
  }
});

test("duplicate consolidation retains the sole receipt and refuses ambiguous dates", () => {
  const paid = { amountPaid: 5000, ...parsePaymentReceipt("2026-10-28") };
  const empty = { amountPaid: 0 };
  assert.deepEqual(mergedReceipt(empty, paid), parsePaymentReceipt("2026-10-28"));
  assert.deepEqual(mergedReceipt(paid, empty), parsePaymentReceipt("2026-10-28"));
  assert.throws(() => mergedReceipt(paid, { amountPaid: 5000, ...parsePaymentReceipt("2026-10-29") }), /conciliar/);
});
