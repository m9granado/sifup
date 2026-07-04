import Link from "next/link";
import { CalendarDays, CircleDollarSign, MapPin, Medal, Trophy } from "lucide-react";
import { getSifupData } from "@/lib/repository";
import { formatCurrency, sortByWhatsappOrder, summarizeMatch, whatsappOrderFor } from "@/lib/store";
import type { Match, MatchPlayer, MatchResult, Player, Team, Winner } from "@/lib/types";

const WIN_POINTS = 4;
const DRAW_POINTS = 2;

type ResultWithMatch = { result: MatchResult; match: Match };
type PlayerStanding = {
  id: string;
  player: string;
  nickname?: string;
  plan: Player["paymentPlan"];
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  points: number;
  form: string;
};

function matchTime(match: { date: string; time: string }) {
  return `${match.date} ${match.time}`;
}

function matchDateTime(match: { date: string; time: string }) {
  return new Date(`${match.date}T${match.time || "00:00"}`);
}

function upcomingMatch(matches: Match[], now: Date) {
  return [...matches]
    .filter((match) => matchDateTime(match) >= now)
    .sort((a, b) => matchTime(a).localeCompare(matchTime(b)))[0];
}

function matchDateLabel(match: { weekLabel: string; date: string; time: string }) {
  return `${match.weekLabel || match.date} - ${match.time}`;
}

function winnerLabel(winner: Winner) {
  if (winner === "draw") return "Empate";
  return `Gano ${winner === "A" ? "Rojo" : "Amarillo"}`;
}

function rowTeamLabel(team: Team) {
  if (team === "A") return "Rojo";
  if (team === "B") return "Amarillo";
  return "Sin equipo";
}

function rowTeamClasses(team: Team) {
  if (team === "A") return "border-(--red)/40 bg-(--red)/12 text-(--red)";
  if (team === "B") return "border-(--gold)/45 bg-(--gold)/12 text-(--gold)";
  return "border-(--border) bg-white/[0.05] text-(--muted)";
}

function playerNickname(row: MatchPlayer, players: Player[]) {
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  return player?.nickname || row.name;
}

function playerInitials(player: string, nickname?: string) {
  return (nickname || player).slice(0, 2).toUpperCase();
}

function buildStandings(players: Player[], matchPlayers: MatchPlayer[], results: MatchResult[]): PlayerStanding[] {
  return players
    .map((player) => {
      const appearances = matchPlayers.filter((row) => (row.name === player.name || row.playerId === player.id) && row.attendanceStatus === "confirmed");
      let wins = 0;
      let losses = 0;
      let draws = 0;

      appearances.forEach((row) => {
        const result = results.find((item) => item.matchId === row.matchId);
        if (!result || row.team === "none") return;
        if (result.winner === "draw") draws += 1;
        else if (result.winner === row.team) wins += 1;
        else losses += 1;
      });

      const decided = wins + losses + draws;
      const winRate = appearances.length ? Math.round((wins / appearances.length) * 100) : 0;

      return {
        id: player.id,
        player: player.name,
        nickname: player.nickname,
        plan: player.paymentPlan,
        played: appearances.length,
        wins,
        draws,
        losses,
        winRate,
        points: wins * WIN_POINTS + draws * DRAW_POINTS,
        form: decided ? `${wins}-${draws}-${losses}` : "0-0-0",
      };
    })
    .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played);
}

function standingsLookup(standings: PlayerStanding[]) {
  return new Map(standings.flatMap((row, index) => {
    const standing = { ...row, rank: index + 1 };
    return [[row.id, standing], [row.player.toLowerCase(), standing]] as const;
  }));
}

function standingForRow(row: MatchPlayer, players: Player[], lookup: ReturnType<typeof standingsLookup>) {
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  return lookup.get(player?.id ?? "") ?? lookup.get(row.name.toLowerCase());
}

function topConfirmedRows(rows: MatchPlayer[], players: Player[], lookup: ReturnType<typeof standingsLookup>) {
  return [...rows]
    .sort((a, b) => {
      const standingA = standingForRow(a, players, lookup);
      const standingB = standingForRow(b, players, lookup);
      const rankA = standingA?.rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = standingB?.rank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      const pointsA = standingA?.points ?? -1;
      const pointsB = standingB?.points ?? -1;
      if (pointsA !== pointsB) return pointsB - pointsA;
      return whatsappOrderFor(a) - whatsappOrderFor(b) || a.name.localeCompare(b.name);
    })
    .slice(0, 4);
}

function pointsRowsForResult(rows: MatchPlayer[], winner: Winner | undefined) {
  if (!winner) return [];
  if (winner === "draw") return rows.filter((row) => row.team === "A" || row.team === "B");
  return rows.filter((row) => row.team === winner);
}

export default async function Page() {
  const data = await getSifupData();
  const now = new Date();
  const nextMatch = upcomingMatch(data.matches, now);
  const nextMatchRows = nextMatch ? sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === nextMatch.id && row.attendanceStatus === "confirmed")) : [];
  const nextMatchSummary = summarizeMatch(nextMatchRows);

  const resultItems: ResultWithMatch[] = data.results.flatMap((result) => {
    const match = data.matches.find((item) => item.id === result.matchId);
    return match && matchDateTime(match) < now ? [{ result, match }] : [];
  });
  const lastResult = resultItems.sort((a, b) => matchTime(b.match).localeCompare(matchTime(a.match)))[0];
  const lastResultRows = lastResult ? sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === lastResult.match.id && row.attendanceStatus === "confirmed")) : [];
  const winner = lastResult?.result.winner;
  const fullStandings = buildStandings(data.players, data.matchPlayers, data.results);
  const standingMap = standingsLookup(fullStandings);
  const standings = fullStandings.slice(0, 5);
  const nextTopRows = topConfirmedRows(nextMatchRows, data.players, standingMap);
  const scoringRows = pointsRowsForResult(lastResultRows, winner);
  const scoredPoints = winner === "draw" ? DRAW_POINTS : WIN_POINTS;

  return (
    <>
      <section className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="label-row">
            <span>SIFUP</span>
            <strong>Portada</strong>
          </div>
          <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">Resumen de la semana</h1>
        </div>
        <p className="max-w-xl text-sm text-(--muted)">Proximo partido primero, ranking vivo y ultimo resultado con los puntos que sumaron.</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.22fr_0.78fr]">
        <section className="panel overflow-hidden">
          <div className="border-b border-(--green)/25 bg-(--green)/10 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-(--lime)">Proximo partido</p>
            {nextMatch ? (
              <>
                <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h2 className="text-3xl font-black text-white sm:text-4xl">{nextMatch.weekLabel || nextMatch.date}</h2>
                    <div className="mt-4 flex flex-wrap gap-3 text-sm">
                      <p className="flex items-center gap-2 text-white">
                        <CalendarDays size={16} className="text-(--cyan)" />
                        <span>{nextMatch.date} · {nextMatch.time}</span>
                      </p>
                      <p className="flex items-start gap-2 text-(--muted)">
                        <MapPin size={16} className="mt-0.5 text-(--gold)" />
                        <span>{nextMatch.location}</span>
                      </p>
                    </div>
                  </div>
                  <Link href={`/matches/${nextMatch.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--green) bg-(--green) px-3 text-sm font-bold text-(--bg-deep) transition hover:bg-(--green-dark) hover:text-white">
                    <CircleDollarSign size={16} />
                    Ver partido
                  </Link>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-(--cyan)/40 bg-(--cyan)/12 p-4">
                    <p className="text-[11px] font-black uppercase tracking-wide text-(--muted)">Confirmados</p>
                    <p className="mt-2 text-6xl font-black leading-none text-white">{nextMatchSummary.confirmedCount}</p>
                    <p className="mt-2 text-sm font-semibold text-(--muted)">jugadores listos</p>
                  </div>
                  <div className="rounded-lg border border-(--pink)/45 bg-(--pink)/12 p-4">
                    <p className="text-[11px] font-black uppercase tracking-wide text-(--muted)">Falta cobrar</p>
                    <p className="mt-2 text-4xl font-black leading-none text-(--pink)">{formatCurrency(nextMatchSummary.pendingAmount)}</p>
                    <p className="mt-2 text-sm font-semibold text-(--muted)">saldo pendiente del partido</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-3 rounded-md border border-(--gold)/40 bg-(--gold)/15 p-4">
                <p className="text-2xl font-black text-(--gold)">Hay que reservar</p>
                <p className="mt-1 text-sm text-(--muted)">No hay otra fecha disponible cargada.</p>
              </div>
            )}
          </div>

          {nextMatch ? (
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-white">Top 4 confirmados por ranking</h3>
                  <p className="mt-1 text-sm text-(--muted)">Ordenado por puntos actuales; color segun equipo guardado.</p>
                </div>
                <Medal size={20} className="text-(--gold)" />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {nextTopRows.map((row) => {
                  const standing = standingForRow(row, data.players, standingMap);
                  return (
                    <article key={row.id} className={`rounded-lg border p-3 ${rowTeamClasses(row.team)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-black uppercase tracking-wide">Ranking #{standing?.rank ?? "SR"}</p>
                        <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-black uppercase">{rowTeamLabel(row.team)}</span>
                      </div>
                      <h4 className="mt-3 truncate text-lg font-black text-white">{playerNickname(row, data.players)}</h4>
                      <p className="mt-1 text-sm font-semibold text-white/75">{standing?.points ?? 0} pts</p>
                    </article>
                  );
                })}
                {nextTopRows.length === 0 ? <p className="text-sm text-(--muted)">Todavia no hay confirmados para mostrar.</p> : null}
              </div>
            </div>
          ) : null}
        </section>

        <div className="grid gap-4">
          <section className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Ranking actual</p>
                <h2 className="mt-2 text-xl font-black text-white">Top 5 jugadores</h2>
              </div>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--gold)/35 bg-(--gold)/15 text-(--gold)">
                <Medal size={18} />
              </span>
            </div>

            <div className="mt-4 divide-y divide-(--border)">
              {standings.map((row, index) => (
                <article key={row.player} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="w-5 text-sm font-black text-(--muted)">#{index + 1}</span>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] text-sm font-black text-white">
                    {playerInitials(row.player, row.nickname)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-black text-white">{row.nickname || row.player}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${row.plan === "monthly" ? "bg-(--cyan)/15 text-(--cyan)" : "bg-(--pink)/15 text-(--pink)"}`}>
                        {row.plan === "monthly" ? "Mensual" : "Galleta"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-(--muted)">{row.played} PJ · {row.wins} PG · {row.form}</p>
                  </div>
                  <div className="text-right">
                    <strong className="text-2xl font-black text-white">{row.points}</strong>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-(--muted)">pts</p>
                  </div>
                </article>
              ))}
            </div>

            <Link href="/standings" className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-bold text-white transition hover:bg-white/[0.12]">
              Ver ranking
            </Link>
          </section>

          <section className="panel overflow-hidden">
            <div className={`border-b p-4 ${winner === "A" ? "border-(--red)/35 bg-(--red)/12" : winner === "B" ? "border-(--gold)/45 bg-(--gold)/12" : "border-(--border) bg-white/[0.03]"}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Ultimo partido</p>
                {winner ? (
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${winner === "A" ? "border-(--red)/50 bg-(--red)/15 text-(--red)" : winner === "B" ? "border-(--gold)/50 bg-(--gold)/15 text-(--gold)" : "border-(--border) bg-white/[0.06] text-white"}`}>
                    <Trophy size={15} />
                    <span className="text-xs font-black uppercase tracking-wide">{winnerLabel(winner)}</span>
                  </span>
                ) : null}
              </div>
              {lastResult ? (
                <>
                  <h2 className="mt-2 text-lg font-black text-white">{matchDateLabel(lastResult.match)}</h2>
                  <p className="mt-1 text-sm text-(--muted)">{lastResult.match.location}</p>
                  <p className="mt-4 flex flex-wrap items-baseline gap-x-2 text-4xl font-black sm:text-5xl">
                    <span className={winner === "A" ? "text-(--red)" : "text-white/45"}>Rojo {lastResult.result.scoreA}</span>
                    <span className="text-white/25">-</span>
                    <span className={winner === "B" ? "text-(--gold)" : "text-white/45"}>{lastResult.result.scoreB} Amarillo</span>
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-(--muted)">Todavia no hay resultados cerrados.</p>
              )}
            </div>

            {lastResult ? (
              <div className="p-4">
                <h3 className="text-sm font-black uppercase tracking-wide text-white">Jugadores que sumaron puntos</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {scoringRows.map((row) => (
                    <span key={row.id} className={`rounded-md border px-2.5 py-1.5 text-xs font-black ${rowTeamClasses(row.team)}`}>
                      {playerNickname(row, data.players)} +{scoredPoints} pts
                    </span>
                  ))}
                  {scoringRows.length === 0 ? <span className="text-sm text-(--muted)">Sin jugadores con puntos registrados.</span> : null}
                </div>
                <Link href={`/matches/${lastResult.match.id}`} className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-bold text-white transition hover:bg-white/[0.12]">
                  Ver partido
                </Link>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}
