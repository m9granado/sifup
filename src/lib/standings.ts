import { DRAW_POINTS, LOSS_POINTS, STANDINGS_WINDOW, WIN_POINTS } from "./sifup-constants";
import type { Match, MatchPlayer, MatchResult, MatchTeam } from "./types";

type ScoredAppearance = Pick<MatchPlayer, "matchId" | "team">;
type MatchOutcome = Pick<MatchResult, "matchId" | "winner">;
type RoyalAppearance = Pick<MatchPlayer, "matchId" | "teamId">;
type RoyalTeam = Pick<MatchTeam, "id" | "finalRank">;

export type PlayerRecord = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  points: number;
  form: string;
};

export function rankingMatches(matches: Pick<Match, "id" | "date" | "time" | "weekLabel" | "matchFormat">[], results: Pick<MatchResult, "matchId">[], teams: Pick<MatchTeam, "matchId" | "finalRank">[]) {
  const resultMatchIds = new Set(results.map((result) => result.matchId));
  const teamsByMatch = new Map<string, Pick<MatchTeam, "matchId" | "finalRank">[]>();
  teams.forEach((team) => teamsByMatch.set(team.matchId, [...(teamsByMatch.get(team.matchId) ?? []), team]));

  return matches
    .filter((match) => {
      if (match.matchFormat !== "rey_de_la_cancha") return resultMatchIds.has(match.id);
      const matchTeams = teamsByMatch.get(match.id) ?? [];
      return matchTeams.length > 0 && matchTeams.every((team) => team.finalRank !== undefined);
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, STANDINGS_WINDOW);
}

export function calculateRankingRecord(appearances: MatchPlayer[], matches: Match[], results: MatchResult[], teams: MatchTeam[]) {
  const rankingMatchIds = new Set(rankingMatches(matches, results, teams).map((match) => match.id));
  const eligible = appearances.filter((row) => rankingMatchIds.has(row.matchId));
  const formatByMatchId = new Map(matches.map((match) => [match.id, match.matchFormat]));
  const classicAppearances = eligible.filter((row) => (formatByMatchId.get(row.matchId) ?? "clasico") === "clasico");
  const royalAppearances = eligible.filter((row) => formatByMatchId.get(row.matchId) === "rey_de_la_cancha");
  return combinePlayerRecords(
    calculatePlayerRecord(classicAppearances, results),
    calculateRoyalRecord(royalAppearances, teams),
  );
}

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
  let played = 0;

  appearances.forEach((row) => {
    const result = resultsByMatch.get(row.matchId);
    if (!result || row.team === "none") return;
    played += 1;

    if (result.winner === "draw") draws += 1;
    else if (result.winner === row.team) wins += 1;
    else losses += 1;

    points += pointsForMatchRow(row, result);
  });

  return {
    played,
    wins,
    draws,
    losses,
    winRate: played ? Math.round((wins / played) * 100) : 0,
    points,
    form: played ? `${wins}-${draws}-${losses}` : "0-0-0",
  };
}

/**
 * Puntaje de Rey de la Cancha: el equipo campeon de la noche (finalRank 1) suma
 * WIN_POINTS por jugador, los otros dos equipos (finalRank 2 o 3) suman LOSS_POINTS
 * cada uno -- misma escala que la regla semanal clasica, sin distincion de puntos
 * entre 2do y 3er lugar. Noches sin cerrar (finalRank aun no definido) no suman.
 */
export function calculateRoyalRecord(appearances: RoyalAppearance[], teams: RoyalTeam[]): PlayerRecord {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  let wins = 0;
  let losses = 0;
  let points = 0;
  let played = 0;

  appearances.forEach((row) => {
    if (!row.teamId) return;
    const team = teamsById.get(row.teamId);
    if (!team || !team.finalRank) return;
    played += 1;

    if (team.finalRank === 1) {
      wins += 1;
      points += WIN_POINTS;
    } else {
      losses += 1;
      points += LOSS_POINTS;
    }
  });

  return {
    played,
    wins,
    draws: 0,
    losses,
    winRate: played ? Math.round((wins / played) * 100) : 0,
    points,
    form: played ? `${wins}-0-${losses}` : "0-0-0",
  };
}

export function combinePlayerRecords(a: PlayerRecord, b: PlayerRecord): PlayerRecord {
  const played = a.played + b.played;
  const wins = a.wins + b.wins;
  const draws = a.draws + b.draws;
  const losses = a.losses + b.losses;
  const points = a.points + b.points;
  const decided = wins + draws + losses;
  return {
    played,
    wins,
    draws,
    losses,
    winRate: played ? Math.round((wins / played) * 100) : 0,
    points,
    form: decided ? `${wins}-${draws}-${losses}` : "0-0-0",
  };
}
