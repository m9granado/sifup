import assert from "node:assert/strict";
import test from "node:test";
import { courtFinanceSummary, planCourtPayment, validCourtDate } from "./court-payments";
import { seedData } from "./mock-data";
import { nextMatch } from "./store";
import { rankingMatches } from "./standings";
import type { Match, SifupData } from "./types";

function fixture(): SifupData {
  const base = seedData.matches[0];
  return {
    ...structuredClone(seedData),
    matches: ["06", "13", "20", "27"].map((day): Match => ({ ...base, id: `match-2026-10-${day}`, date: `2026-10-${day}`, monthKey: "2026-10", status: "confirmed", courtCost: 35000, courtPrepaid: true })),
    results: [{ id: "result-27", matchId: "match-2026-10-27", scoreA: 0, scoreB: 1, winner: "B", notes: "" }],
    matchTeams: [], matchGames: [], courtPayments: [],
    // Synthetic fixture, not the club's real expense amount.
    clubExpenses: [{ id: "october", expenseDate: "2026-10-01", label: "Test: four courts", amount: 140000, category: "court", note: "", createdAt: "", updatedAt: "" }],
  };
}

function apply(data: SifupData, input: Parameters<typeof planCourtPayment>[1]) {
  const plan = planCourtPayment(data, input, "2026-10-28T12:00:00Z");
  data.matches = data.matches.map((match) => match.id === plan.source.id ? plan.source : match);
  if (plan.createTarget) data.matches.push(plan.target);
  else data.matches = data.matches.map((match) => match.id === plan.target.id ? plan.target : match);
  data.courtPayments = [...(data.courtPayments ?? []).filter((payment) => payment.sourceMatchId !== plan.payment.sourceMatchId), plan.payment];
  return plan;
}

const transfer = { expenseId: "october", matchId: "match-2026-10-06", targetDate: "2026-11-03" };

test("October to November: three suspended dates, one played; cash date and player payments are preserved", () => {
  const data = fixture();
  const before = structuredClone(data);
  for (const [from, to] of [["06", "03"], ["13", "10"], ["20", "17"]]) {
    apply(data, { expenseId: "october", matchId: `match-2026-10-${from}`, targetDate: `2026-11-${to}` });
  }
  apply(data, { expenseId: "october", matchId: "match-2026-10-27" });
  const october = courtFinanceSummary(data, "2026-10");
  const november = courtFinanceSummary(data, "2026-11");
  assert.equal(october.cashPaid, 140000);
  assert.equal(october.playedCount, 1);
  assert.equal(october.suspendedCount, 3);
  assert.equal(october.consumedAmount, 35000);
  assert.equal(november.cashPaid, 0);
  assert.equal(november.allocatedAmount, 105000);
  assert.equal(november.scheduledCredit, 105000);
  assert.equal(november.consumedAmount, 0);
  assert.equal(november.expenses[0].unallocated, 0);
  assert.deepEqual(october.matches.slice(0, 3).map((row) => row.transferredTo), ["2026-11-03", "2026-11-10", "2026-11-17"]);
  assert.deepEqual(data.clubExpenses, before.clubExpenses);
  assert.deepEqual(data.matchPlayers, before.matchPlayers);
  assert.deepEqual(data.monthlyPayments, before.monthlyPayments);
  assert.deepEqual(data.results, before.results);
});

test("planning is a read-only preview; retries reuse the same allocation and target", () => {
  const data = fixture();
  const before = structuredClone(data);
  const preview = planCourtPayment(data, transfer);
  assert.deepEqual(data, before);
  assert.equal(preview.createTarget, true);
  apply(data, transfer);
  const count = data.matches.length;
  assert.equal(apply(data, transfer).unchanged, true);
  assert.equal(data.matches.length, count);
  assert.equal(data.courtPayments?.length, 1);
  assert.throws(() => planCourtPayment(data, { ...transfer, targetDate: "2026-11-10" }), /otro destino/);
});

test("an existing destination retains its roster/settings; another payment cannot use it", () => {
  const data = fixture();
  data.matches.push({ ...data.matches[0], id: "already-scheduled", date: "2026-11-03", monthKey: "2026-11", notes: "keep me", squadTarget: 14 });
  const plan = apply(data, transfer);
  assert.equal(plan.createTarget, false);
  assert.equal(plan.target.id, "already-scheduled");
  assert.equal(plan.target.notes, "keep me");
  assert.equal(plan.target.squadTarget, 14);
  assert.throws(() => planCourtPayment(data, { ...transfer, matchId: "match-2026-10-13" }), /otro pago/);
});

test("an already-linked payment can transfer once, without consuming another expense balance", () => {
  const data = fixture();
  data.clubExpenses[0].amount = 35000;
  apply(data, { expenseId: "october", matchId: transfer.matchId });
  apply(data, transfer);
  assert.equal(data.courtPayments?.length, 1);
  assert.equal(courtFinanceSummary(data, "2026-11").expenses[0].unallocated, 0);
  assert.throws(() => planCourtPayment(data, { ...transfer, matchId: "match-2026-10-13", targetDate: "2026-11-10" }), /saldo suficiente/);
});

test("playing the destination consumes credit once, and later retries remain idempotent", () => {
  const data = fixture();
  const { target } = apply(data, transfer);
  data.results.push({ id: "nov-result", matchId: target.id, winner: "A", scoreA: 1, scoreB: 0, notes: "" });
  assert.equal(courtFinanceSummary(data, "2026-11").consumedAmount, 35000);
  assert.equal(courtFinanceSummary(data, "2026-11").scheduledCredit, 0);
  assert.equal(apply(data, transfer).unchanged, true);
});

test("played sources, results, royal standings and game activity prevent suspending a date", () => {
  for (const kind of ["status", "result", "team", "game", "suspended-result"]) {
    const data = fixture();
    if (kind === "status") data.matches[0].status = "played";
    if (kind.includes("result")) data.results[0].matchId = transfer.matchId;
    if (kind === "suspended-result") data.matches[0].status = "suspended";
    if (kind === "team") data.matchTeams.push({ id: "team", matchId: transfer.matchId, finalRank: 1 } as SifupData["matchTeams"][number]);
    if (kind === "game") data.matchGames.push({ id: "game", matchId: transfer.matchId } as SifupData["matchGames"][number]);
    assert.throws(() => planCourtPayment(data, transfer), /actividad o resultado/, kind);
  }
});

test("invalid dates, past/same date, changed costs, wrong expenses and insufficient funds are rejected", () => {
  for (const date of ["2026-02-30", "2026-13-03", "2026-11-3", "2026-10-06", "2026-10-01"]) {
    assert.throws(() => planCourtPayment(fixture(), { ...transfer, targetDate: date }));
  }
  assert.equal(validCourtDate("2028-02-29"), true);
  assert.equal(validCourtDate("2026-02-29"), false);
  for (const amount of [0, -1, 34999, NaN, Infinity, 1.5]) {
    const data = fixture(); data.clubExpenses[0].amount = amount;
    assert.throws(() => planCourtPayment(data, transfer));
  }
  const data = fixture(); data.clubExpenses[0].category = "other";
  assert.throws(() => planCourtPayment(data, transfer), /gasto de cancha/);
  assert.throws(() => planCourtPayment(fixture(), { ...transfer, matchId: "missing" }), /origen/);
  const cost = fixture(); cost.matches.push({ ...cost.matches[0], id: "nov", date: transfer.targetDate, courtCost: 40000 });
  assert.throws(() => planCourtPayment(cost, transfer), /mantener el valor/);
});

test("ambiguous/played/suspended destination and chained credits fail safely", () => {
  for (const state of ["ambiguous", "played", "suspended"]) {
    const data = fixture();
    data.matches.push({ ...data.matches[0], id: "nov", date: transfer.targetDate, status: state === "played" ? "played" : state === "suspended" ? "suspended" : "confirmed" });
    if (state === "ambiguous") data.matches.push({ ...data.matches.at(-1)!, id: "nov2" });
    assert.throws(() => planCourtPayment(data, transfer), /varios partidos|partido pendiente/);
  }
  const data = fixture();
  const { target } = apply(data, transfer);
  assert.throws(() => planCourtPayment(data, { ...transfer, matchId: target.id, targetDate: "2026-12-01" }), /encadenados/);
});

test("unlinked historical matches are explicit, not invented payments; month validation is strict", () => {
  const data = fixture();
  const summary = courtFinanceSummary(data, "2026-10");
  assert.equal(summary.consumedAmount, 0);
  assert.equal(summary.playedCount, 1);
  assert.equal(summary.recordedPlayedCost, 35000);
  assert.equal(summary.unlinkedPlayedCount, 1);
  assert.equal(summary.matches.every((row) => row.needsPaymentLink), true);
  for (const month of ["2026-13", "2026-9", "2026/10", "bad"]) assert.throws(() => courtFinanceSummary(data, month), /Mes invalido/);
});

test("suspended dates are neither the next match nor ranking matches, even with a stale result", () => {
  const data = fixture();
  data.matches[3].status = "suspended";
  assert.notEqual(nextMatch(data.matches)?.id, data.matches[3].id);
  assert.deepEqual(rankingMatches(data.matches, data.results, []), []);
  assert.equal(nextMatch(data.matches.map((match) => ({ ...match, status: "suspended" }))), undefined);
});
