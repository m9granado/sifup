import Link from "next/link";
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

function winnerLabel(winner: Winner) {
  if (winner === "draw") return "Empate";
  return `El Equipo ${winner === "A" ? "Rojo" : "Amarillo"} fue el ganador`;
}

function playerNickname(row: MatchPlayer, players: Player[]) {
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  return player?.nickname || row.name;
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
  const currentRows = currentMatch ? data.matchPlayers.filter((row) => row.matchId === currentMatch.id) : [];
  const lastResultRows = lastResult ? sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === lastResult.match.id && row.attendanceStatus === "confirmed")) : [];
  const lastResultTeamA = lastResultRows.filter((row) => row.team === "A");
  const lastResultTeamB = lastResultRows.filter((row) => row.team === "B");
  const lastResultSummary = summarizeMatch(lastResultRows);
  const monthlyPlayerCount = data.players.filter((player) => player.active && player.paymentPlan === "monthly").length;
  const summary = summarizeMatch(currentRows);

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
          <article className="metric cyan">
            <span>Confirmados</span>
            <strong>{summary.confirmedCount}</strong>
          </article>
          <article className="metric lime">
            <span>Mensuales</span>
            <strong>{monthlyPlayerCount}</strong>
          </article>
          <article className="metric pink">
            <span>Pendiente</span>
            <strong>{formatCurrency(summary.pendingAmount)}</strong>
          </article>
          <article className="metric gold">
            <span>Recaudado</span>
            <strong>{formatCurrency(summary.totalCollected)}</strong>
          </article>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_0.9fr]">
        <section className="panel p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Partido pasado</p>
          {lastResult ? (
            <>
              <h2 className="mt-2 text-xl font-black text-white">{matchLabel(lastResult.match)}</h2>
              <p className="mt-3 text-3xl font-black text-white">Rojo {lastResult.result.scoreA} - {lastResult.result.scoreB} Amarillo</p>
              <p className="mt-2 text-sm font-bold text-(--muted)">
                {winnerLabel(lastResult.result.winner)}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-(--border) bg-white/[0.04] p-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-(--muted)">Falta</p>
                  <p className="mt-1 text-lg font-black text-(--pink)">{formatCurrency(lastResultSummary.pendingAmount)}</p>
                </div>
                <div className="rounded-md border border-(--border) bg-white/[0.04] p-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-(--muted)">Recaudado</p>
                  <p className="mt-1 text-lg font-black text-white">{formatCurrency(lastResultSummary.totalCollected)}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide text-(--red)">Rojo</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {lastResultTeamA.map((row) => (
                      <span key={row.id} className="rounded-md border border-(--red)/35 bg-(--red)/12 px-2 py-1 text-xs font-bold text-white">
                        {playerNickname(row, data.players)}
                      </span>
                    ))}
                    {lastResultTeamA.length === 0 ? <span className="text-xs text-(--muted)">Sin jugadores</span> : null}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide text-(--gold)">Amarillo</p>
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
