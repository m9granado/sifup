import Link from "next/link";
import { getSifupData } from "@/lib/repository";
import { formatCurrency, summarizeMatch } from "@/lib/store";
import type { Match, MatchResult } from "@/lib/types";

type ResultWithMatch = { result: MatchResult; match: Match };

function matchTime(match: { date: string; time: string }) {
  return `${match.date} ${match.time}`;
}

function matchLabel(match: { weekLabel: string; date: string; time: string; location: string }) {
  return `${match.weekLabel || match.date} - ${match.time} - ${match.location}`;
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
            <span>Pagados</span>
            <strong>{summary.paidCount}</strong>
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
                {lastResult.result.winner === "draw" ? "Empate" : lastResult.result.winner === "A" ? "Gana Rojo" : "Gana Amarillo"}
              </p>
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
