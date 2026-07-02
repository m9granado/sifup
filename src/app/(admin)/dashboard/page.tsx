import Link from "next/link";
import { CalendarDays, CircleDollarSign, MapPin, Medal, Trophy } from "lucide-react";
import { getSifupData } from "@/lib/repository";
import { formatCurrency, sortByWhatsappOrder, summarizeMatch } from "@/lib/store";
import type { Match, MatchPlayer, MatchResult, Player, Winner } from "@/lib/types";

type ResultWithMatch = { result: MatchResult; match: Match };
type PlayerStanding = {
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

function matchDateLabel(match: { weekLabel: string; date: string; time: string }) {
  return `${match.weekLabel || match.date} - ${match.time}`;
}

function winnerLabel(winner: Winner) {
  if (winner === "draw") return "Empate";
  return `Equipo ${winner === "A" ? "Rojo" : "Amarillo"} ganador`;
}

function teamPoints(team: "A" | "B", winner: Winner) {
  if (winner === "draw") return 2;
  return winner === team ? 3 : 1;
}

function teamLabel(team: "A" | "B") {
  return team === "A" ? "Rojo" : "Amarillo";
}

function playerNickname(row: MatchPlayer, players: Player[]) {
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  return player?.nickname || row.name;
}

function isGalleta(row: MatchPlayer, players: Player[]) {
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  return (player?.paymentPlan ?? "perMatch") === "perMatch";
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
        player: player.name,
        nickname: player.nickname,
        plan: player.paymentPlan,
        played: appearances.length,
        wins,
        draws,
        losses,
        winRate,
        points: wins * 3 + draws * 2 + losses,
        form: decided ? `${wins}-${draws}-${losses}` : "0-0-0",
      };
    })
    .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played);
}

export default async function Page() {
  const data = await getSifupData();
  const resultMatchIds = new Set(data.results.map((result) => result.matchId));
  const pendingMatches = [...data.matches]
    .filter((match) => !resultMatchIds.has(match.id))
    .sort((a, b) => matchTime(a).localeCompare(matchTime(b)));
  const nextMatch = pendingMatches[0];
  const nextMatchRows = nextMatch ? sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === nextMatch.id && row.attendanceStatus === "confirmed")) : [];
  const nextMatchSummary = summarizeMatch(nextMatchRows);

  const resultItems: ResultWithMatch[] = data.results.flatMap((result) => {
    const match = data.matches.find((item) => item.id === result.matchId);
    return match ? [{ result, match }] : [];
  });
  const lastResult = resultItems.sort((a, b) => matchTime(b.match).localeCompare(matchTime(a.match)))[0];
  const lastResultRows = lastResult ? sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === lastResult.match.id && row.attendanceStatus === "confirmed")) : [];
  const lastResultTeamA = lastResultRows.filter((row) => row.team === "A");
  const lastResultTeamB = lastResultRows.filter((row) => row.team === "B");
  const lastResultGalletaRows = lastResultRows.filter((row) => isGalleta(row, data.players));
  const lastResultSummary = summarizeMatch(lastResultGalletaRows);
  const winner = lastResult?.result.winner;
  const standings = buildStandings(data.players, data.matchPlayers, data.results).slice(0, 5);

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
        <p className="max-w-xl text-sm text-(--muted)">Partido anterior, ranking actual y proxima fecha en una vista rapida.</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr_0.95fr]">
        <section className="panel overflow-hidden">
          <div className={`border-b border-(--border) p-4 ${winner === "A" ? "bg-(--red)/10" : winner === "B" ? "bg-(--gold)/10" : "bg-white/[0.03]"}`}>
            <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Partido anterior</p>
            {lastResult ? (
              <>
                <h2 className="mt-2 text-xl font-black text-white">{matchDateLabel(lastResult.match)}</h2>
                <p className="mt-1 text-sm text-(--muted)">{lastResult.match.location}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-4xl font-black">
                    <span className={winner === "A" ? "text-(--red)" : "text-white/45"}>Rojo {lastResult.result.scoreA}</span>
                    <span className="text-white/25">-</span>
                    <span className={winner === "B" ? "text-(--gold)" : "text-white/45"}>{lastResult.result.scoreB} Amarillo</span>
                  </p>
                  <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${winner === "A" ? "border-(--red)/50 bg-(--red)/15 text-(--red)" : winner === "B" ? "border-(--gold)/50 bg-(--gold)/15 text-(--gold)" : "border-(--border) bg-white/[0.06] text-white"}`}>
                    <Trophy size={15} />
                    <span className="text-xs font-black uppercase tracking-wide">{winner ? winnerLabel(winner) : ""}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-(--muted)">Todavia no hay resultados cerrados.</p>
            )}
          </div>

          {lastResult ? (
            <div className="p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {(["A", "B"] as const).map((team) => {
                  const rows = team === "A" ? lastResultTeamA : lastResultTeamB;
                  const isWinner = winner === team;
                  const colorClass = team === "A" ? "text-(--red)" : "text-(--gold)";
                  const borderClass = team === "A" ? "border-(--red)/35 bg-(--red)/10" : "border-(--gold)/40 bg-(--gold)/12";
                  return (
                    <article key={team} className={`rounded-lg border p-3 ${isWinner ? borderClass : "border-(--border) bg-white/[0.035]"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-xs font-black uppercase tracking-wide ${colorClass}`}>{teamLabel(team)}</p>
                        {winner ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black uppercase text-white">+{teamPoints(team, winner)} pts</span> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {rows.map((row) => (
                          <span key={row.id} className={`rounded-md border px-2 py-1 text-xs font-bold text-white ${team === "A" ? "border-(--red)/35 bg-(--red)/12" : "border-(--gold)/35 bg-(--gold)/12"}`}>
                            {playerNickname(row, data.players)}
                          </span>
                        ))}
                        {rows.length === 0 ? <span className="text-xs text-(--muted)">Sin jugadores</span> : null}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-(--border) bg-white/[0.04] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-(--muted)">Falta galletas</p>
                  <p className="mt-1 text-lg font-black text-(--pink)">{formatCurrency(lastResultSummary.pendingAmount)}</p>
                </div>
                <div className="rounded-md border border-(--border) bg-white/[0.04] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-(--muted)">Recaudado</p>
                  <p className="mt-1 text-lg font-black text-white">{formatCurrency(lastResultSummary.totalCollected)}</p>
                </div>
              </div>
              <Link href={`/matches/${lastResult.match.id}`} className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-bold text-white transition hover:bg-white/[0.12]">
                Ver partido
              </Link>
            </div>
          ) : null}
        </section>

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

        <section className="panel p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Proximo partido</p>
          {nextMatch ? (
            <>
              <h2 className="mt-2 text-xl font-black text-white">{nextMatch.weekLabel || nextMatch.date}</h2>
              <div className="mt-4 space-y-3 text-sm">
                <p className="flex items-center gap-2 text-white">
                  <CalendarDays size={16} className="text-(--cyan)" />
                  <span>{nextMatch.date} · {nextMatch.time}</span>
                </p>
                <p className="flex items-start gap-2 text-(--muted)">
                  <MapPin size={16} className="mt-0.5 text-(--gold)" />
                  <span>{nextMatch.location}</span>
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-(--border) bg-white/[0.04] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-(--muted)">Confirmados</p>
                  <p className="mt-1 text-2xl font-black text-white">{nextMatchSummary.confirmedCount}</p>
                </div>
                <div className="rounded-md border border-(--border) bg-white/[0.04] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-(--muted)">Falta cobrar</p>
                  <p className="mt-1 text-lg font-black text-(--pink)">{formatCurrency(nextMatchSummary.pendingAmount)}</p>
                </div>
              </div>

              <Link href={`/matches/${nextMatch.id}`} className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--green) bg-(--green) px-3 text-sm font-bold text-(--bg-deep) transition hover:bg-(--green-dark) hover:text-white">
                <CircleDollarSign size={16} />
                Ver partido
              </Link>
            </>
          ) : (
            <div className="mt-3 rounded-md border border-(--gold)/40 bg-(--gold)/15 p-3">
              <p className="text-lg font-black text-(--gold)">Hay que reservar</p>
              <p className="mt-1 text-sm text-(--muted)">No hay otra fecha disponible cargada.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
