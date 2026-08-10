import assert from "node:assert/strict";
import test from "node:test";
import { calculatePlayerRecord, pointsForMatchRow } from "./standings";

test("calculatePlayerRecord applies 4/2/1 to wins, draws and losses", () => {
  const appearances = [
    { matchId: "win", team: "A" as const },
    { matchId: "draw", team: "B" as const },
    { matchId: "loss", team: "A" as const },
    { matchId: "pending", team: "B" as const },
    { matchId: "unassigned", team: "none" as const },
  ];
  const results = [
    { matchId: "win", winner: "A" as const },
    { matchId: "draw", winner: "draw" as const },
    { matchId: "loss", winner: "B" as const },
    { matchId: "unassigned", winner: "A" as const },
  ];

  assert.deepEqual(calculatePlayerRecord(appearances, results), {
    played: 5,
    wins: 1,
    draws: 1,
    losses: 1,
    winRate: 20,
    points: 7,
    form: "1-1-1",
  });
});

test("pointsForMatchRow awards one point for a completed loss", () => {
  assert.equal(pointsForMatchRow({ matchId: "loss", team: "A" }, { matchId: "loss", winner: "B" }), 1);
});

test("six completed losses award six points", () => {
  const appearances = Array.from({ length: 6 }, (_, index) => ({ matchId: `loss-${index}`, team: "A" as const }));
  const results = appearances.map(({ matchId }) => ({ matchId, winner: "B" as const }));

  assert.equal(calculatePlayerRecord(appearances, results).points, 6);
});
