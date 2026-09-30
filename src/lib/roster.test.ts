import assert from "node:assert/strict";
import test from "node:test";
import { planRosterChange } from "./store";
import type { Match, MatchPlayer, MonthlyPayment } from "./types";

const matches = [
  { id: "m-jul", monthKey: "2026-07" },
  { id: "m-ago", monthKey: "2026-08" },
] as Match[];

function row(partial: Partial<MatchPlayer>): MatchPlayer {
  return { id: "r", matchId: "m-jul", name: "Juanjo", attendanceStatus: "confirmed", paymentStatus: "unpaid", amountDue: 0, amountPaid: 0, note: "", ...partial } as MatchPlayer;
}

test("a mensual cancela solo galletas impagas del mes y respeta lo ya pagado", () => {
  const plan = planRosterChange({
    playerRows: [
      row({ id: "a", amountDue: 3500 }),
      row({ id: "b", amountDue: 5000, amountPaid: 5000, paymentStatus: "paid" }),
      row({ id: "c", matchId: "m-ago", amountDue: 5000 }),
      row({ id: "d", attendanceStatus: "out", amountDue: 5000 }),
    ],
    matches,
    monthKey: "2026-07",
    monthly: true,
  });
  assert.equal(plan.unpaidGalletaCount, 1);
  assert.equal(plan.unpaidGalletaAmount, 3500);
  assert.equal(plan.paidGalletaAmount, 5000);
  assert.deepEqual(plan.rowUpdates.map((update) => [update.id, update.amountDue, update.paymentStatus]), [["a", 0, "paid"]]);
  assert.match(plan.rowUpdates[0].note, /mensualidad/);
});

test("a mensual sin cancelar solo informa el monto", () => {
  const plan = planRosterChange({ playerRows: [row({ id: "a", amountDue: 3500 })], matches, monthKey: "2026-07", monthly: true, cancelGalletas: false });
  assert.equal(plan.unpaidGalletaAmount, 3500);
  assert.equal(plan.rowUpdates.length, 0);
});

test("a galleta recalcula partidos confirmados a $0 y avisa mensualidad pagada", () => {
  const payment = { paymentStatus: "paid", amountPaid: 20000 } as MonthlyPayment;
  const plan = planRosterChange({
    playerRows: [
      row({ id: "a", paymentStatus: "paid", note: "mensualidad" }),
      row({ id: "b", attendanceStatus: "out" }),
      row({ id: "c", matchId: "m-ago" }),
    ],
    matches,
    monthKey: "2026-07",
    monthly: false,
    payment,
  });
  assert.equal(plan.repricedCount, 1);
  assert.equal(plan.paidMonthlyAmount, 20000);
  assert.deepEqual(plan.rowUpdates, [{ id: "a", amountDue: 5000, amountPaid: 0, paymentStatus: "unpaid", note: "" }]);
});
