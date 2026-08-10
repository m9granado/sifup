import { DRAW_POINTS, LOSS_POINTS, WIN_POINTS } from "./sifup-constants";
import type { MatchPlayer, MatchResult } from "./types";

type ScoredAppearance = Pick<MatchPlayer, "matchId" | "team">;
type MatchOutcome = Pick<MatchResult, "matchId" | "winner">;

export type PlayerRecord = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  points: number;
  form: string;
};

export function pointsForMatchRow(row: ScoredAppearance, result?: MatchOutcome) {
  if (!result || row.team === "none") return 0;
  if (result.winner === "draw") return DRAW_POINTS;
  return result.winner === row.team ? WIN_POINTS : LOSS_POINTS;
}

export function calculatePlayerRecord(appearances: ScoredAppearance[], results: MatchOutcome[]): PlayerRecord {
  const resultsByMatch = new Map(results.map((result) => [result.matchId, result]));
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let points = 0;

  appearances.forEach((row) => {
    const result = resultsByMatch.get(row.matchId);
    if (!result || row.team === "none") return;

    if (result.winner === "draw") draws += 1;
    else if (result.winner === row.team) wins += 1;
    else losses += 1;

    points += pointsForMatchRow(row, result);
  });

  const decided = wins + losses + draws;
  return {
    played: appearances.length,
    wins,
    draws,
    losses,
    winRate: appearances.length ? Math.round((wins / appearances.length) * 100) : 0,
    points,
    form: decided ? `${wins}-${draws}-${losses}` : "0-0-0",
  };
}
