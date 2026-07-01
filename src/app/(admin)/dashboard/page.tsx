import Link from "next/link";
import { Trophy } from "lucide-react";
import { getSifupData } from "@/lib/repository";
import { formatCurrency, sortByWhatsappOrder, summarizeMatch } from "@/lib/store";
import type { Match, MatchPlayer, MatchResult, Player, Winner } from "@/lib/types";

type ResultWithMatch = { result: MatchResult; match: Match };

function matchTime(match: { date: string; time: string }) {
  return `${match.date} ${match.time}`;
}

function matchLabel(match: { weekLabel: string; date: string; time: string; location: string }) {
  return `${match.weekLabel || match.date} - ${match.time} - ${match.location}`;
}

function matchDateLabel(match: { weekLabel: string; date: string; time: string }) {
  return `${match.weekLabel || match.date} - ${match.time}`;
}

function winnerLabel(winner: Winner) {
  if (winner === "draw") return "Empate";
  return `Equipo ${winner === "A" ? "Rojo" : "Amarillo"} - GANADOR`;
}

function teamPoints(team: "A" | "B", winner: Winner) {
  if (winner === "draw") return 2;
  return winner === team ? 3 : 1;
}

function playerNickname(row: MatchPlayer, players: Player[]) {
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  return player?.nickname || row.name;
}

function isGalleta(row: MatchPlayer, players: Player[]) {
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  return (player?.paymentPlan ?? "perMatch") === "perMatch";
}

export default async function Page() {
  const data = await getSifupData();
  const resultMatchIds = new Set(data.results.map((result) => result.matchId));
  const pendingMatches = [...data.matches]
    .filter((match) => !resultMatchIds.has(match.id))
    .sort((a, b) => matchTime(a).localeCompare(matchTime(b)));
  const currentMatch = pendingMatches[0];
  const nextAvailableMatch = pendingMatches.find((match) => match.id !== currentMatch?.id);
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

  const latestMonthKey = [...data.matches].sort((a, b) => matchTime(b).localeCompare(matchTime(a)))[0]?.monthKey;
  const gastosTotal = data.clubFinance.prepaidTotal;
  const recaudadoMensuales = data.monthlyPayments
    .filter((payment) => payment.monthKey === latestMonthKey)
    .reduce((sum, payment) => sum + payment.amountPaid, 0);
  const galletaPlayerIds = new Set(data.players.filter((player) => player.paymentPlan === "perMatch").map((player) => player.id));
  const galletasRegistrados = new Set(
    data.matchPlayers
      .filter((row) => row.attendanceStatus === "confirmed" && (row.playerId ? galletaPlayerIds.has(row.playerId) : true))
      .map((row) => row.playerId ?? row.name.toLowerCase()),
  ).size;
  const partidosJugados = resultItems.length;

  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden="true"></div>
        <div className="hero-copy">
          <div className="label-row">
            <span>SIFUP</span>
            <strong>Portada</strong>
          </div>
          <h1>Inicio</h1>
          <p>Resultado del partido pasado, partido actual pendiente de resultado y proxima fecha disponible.</p>
        </div>
        <div className="hero-metrics" aria-label="Resumen">
          <article className="metric pink">
            <span>Gastos canchas</span>
            <strong>{formatCurrency(gastosTotal)}</strong>
          </article>
          <article className="metric lime">
            <span>Recaudado mensuales</span>
            <strong>{formatCurrency(recaudadoMensuales)}</strong>
          </article>
          <article className="metric cyan">
            <span>Galletas registrados</span>
            <strong>{galletasRegistrados}</strong>
          </article>
          <article className="metric gold">
            <span>Partidos jugados</span>
            <strong>{partidosJugados}</strong>
          </article>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_0.9fr]">
        <section className="panel p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Partido pasado</p>
          {lastResult ? (
            <>
              <h2 className="mt-2 text-xl font-black text-white">{matchDateLabel(lastResult.match)}</h2>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-3xl font-black">
                <span className={winner === "A" ? "text-(--red)" : "text-white/40"}>Rojo {lastResult.result.scoreA}</span>
                <span className="text-white/30">-</span>
                <span className={winner === "B" ? "text-(--gold)" : "text-white/40"}>{lastResult.result.scoreB} Amarillo</span>
              </p>
              {winner !== "draw" ? (
                <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 ${winner === "A" ? "border-(--red)/50 bg-(--red)/15" : "border-(--gold)/50 bg-(--gold)/15"}`}>
                  <Trophy size={14} className={winner === "A" ? "text-(--red)" : "text-(--gold)"} />
                  <p className={`text-xs font-black uppercase tracking-wide ${winner === "A" ? "text-(--red)" : "text-(--gold)"}`}>
                    {winner ? winnerLabel(winner) : ""}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm font-bold text-(--muted)">Empate</p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-(--border) bg-white/[0.04] p-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-(--muted)">Falta (galletas)</p>
                  <p className="mt-1 text-lg font-black text-(--pink)">{formatCurrency(lastResultSummary.pendingAmount)}</p>
                </div>
                <div className="rounded-md border border-(--border) bg-white/[0.04] p-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-(--muted)">Recaudado (galletas)</p>
                  <p className="mt-1 text-lg font-black text-white">{formatCurrency(lastResultSummary.totalCollected)}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className={`rounded-lg p-2 ${winner === "A" ? "bg-(--red)/10 ring-1 ring-(--red)/40" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black uppercase tracking-wide text-(--red)">Rojo</p>
                    {winner ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${winner === "A" ? "bg-(--red) text-white" : "bg-white/10 text-(--muted)"}`}>
                        +{teamPoints("A", winner)} pts
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {lastResultTeamA.map((row) => (
                      <span key={row.id} className="rounded-md border border-(--red)/35 bg-(--red)/12 px-2 py-1 text-xs font-bold text-white">
                        {playerNickname(row, data.players)}
                      </span>
                    ))}
                    {lastResultTeamA.length === 0 ? <span className="text-xs text-(--muted)">Sin jugadores</span> : null}
                  </div>
                </div>
                <div className={`rounded-lg p-2 ${winner === "B" ? "bg-(--gold)/10 ring-1 ring-(--gold)/40" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black uppercase tracking-wide text-(--gold)">Amarillo</p>
                    {winner ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${winner === "B" ? "bg-(--gold) text-(--bg-deep)" : "bg-white/10 text-(--muted)"}`}>
                        +{teamPoints("B", winner)} pts
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {lastResultTeamB.map((row) => (
                      <span key={row.id} className="rounded-md border border-(--gold)/40 bg-(--gold)/14 px-2 py-1 text-xs font-bold text-white">
                        {playerNickname(row, data.players)}
                      </span>
                    ))}
                    {lastResultTeamB.length === 0 ? <span className="text-xs text-(--muted)">Sin jugadores</span> : null}
                  </div>
                </div>
              </div>
              <Link href={`/matches/${lastResult.match.id}`} className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-bold text-white transition hover:bg-white/[0.12]">
                Ver partido
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-(--muted)">Todavia no hay resultados cerrados.</p>
          )}
        </section>

        <section className="panel p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Partido actual</p>
          {currentMatch ? (
            <>
              <h2 className="mt-2 text-xl font-black text-white">{matchLabel(currentMatch)}</h2>
              <p className="mt-2 text-sm text-(--muted)">Se muestra porque todavia no tiene resultado cargado.</p>
              <Link href={`/matches/${currentMatch.id}`} className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-(--green) bg-(--green) px-3 text-sm font-bold text-(--bg-deep) transition hover:bg-(--green-dark) hover:text-white">
                Ver partido
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-(--muted)">No hay partidos pendientes de resultado.</p>
          )}
        </section>

        <section className="panel p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Proxima fecha</p>
          {nextAvailableMatch ? (
            <>
              <h2 className="mt-2 text-xl font-black text-white">{matchLabel(nextAvailableMatch)}</h2>
              <Link href={`/matches/${nextAvailableMatch.id}`} className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-bold text-white transition hover:bg-white/[0.12]">
                Revisar fecha
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
