import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { matchesOverview, matchStatusLabels as labels } from "@/lib/matches-overview";
import { monthLabel, summarizeMatch } from "@/lib/store";
import { SQUAD_TARGET } from "@/lib/sifup-constants";
import type { Match, SifupData } from "@/lib/types";

function Status({ match }: { match: Match }) {
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${match.status === "suspended" ? "bg-orange-200/10 text-orange-200" : match.status === "open" ? "bg-amber-200/10 text-amber-200" : match.status === "roster_locked" ? "bg-sky-200/10 text-sky-200" : "bg-emerald-200/10 text-emerald-200"}`}>{labels[match.status] ?? match.status}</span>;
}
const fullDate = (date: string) => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00`));

export function MatchesList({ data, today }: { data: SifupData; today: string }) {
  const { next, months } = matchesOverview(data.matches, today);
  const confirmed = next ? summarizeMatch(data.matchPlayers.filter(row => row.matchId === next.id)).confirmedCount : 0;
  const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-200";
  return <div className="mx-auto max-w-4xl space-y-6">
    {next ? <section aria-labelledby="next-match-title" className="rounded-2xl border border-emerald-200/30 bg-emerald-950/60 p-5 sm:p-6">
      <p className="text-xs font-black uppercase tracking-wide text-emerald-200">Próximo partido</p>
      <h2 id="next-match-title" className="mt-3 text-2xl font-black text-white first-letter:uppercase"><time dateTime={next.date}>{fullDate(next.date)}</time></h2>
      <p className="mt-2 break-words text-sm text-slate-200">{next.time} · {next.location || "Cancha por definir"}</p>
      <div className="mt-4"><Status match={next} /></div>
      <p className="mt-4 font-bold text-white">{confirmed} / {next.squadTarget ?? SQUAD_TARGET} jugadores</p>
      <Link href={`/matches/${next.id}`} className={`mt-4 block rounded-lg bg-emerald-200 px-4 py-3 text-center font-black text-emerald-950 hover:bg-emerald-100 ${focus}`}>Ver partido</Link>
    </section> : <p className="rounded-xl border border-white/15 p-5 text-(--muted)">Sin próxima fecha programada. El historial sigue disponible abajo.</p>}
    <section aria-labelledby="matches-by-month">
      <h2 id="matches-by-month" className="mb-2 text-xs font-bold uppercase tracking-wide text-(--muted)">Por mes</h2>
      {months.map(group => <details key={group.key} open={group.open} className="group/month border-b border-white/15 py-2">
        <summary className={`flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-1 font-bold text-white [&::-webkit-details-marker]:hidden ${focus}`}>
          <span>{monthLabel(group.key)} <span className="ml-2 text-xs font-normal text-(--muted)">({group.matches.length + (next?.date.startsWith(group.key) ? 1 : 0)})</span></span>
          <span aria-hidden="true" className="text-xl"><span className="group-open/month:hidden">+</span><span className="hidden group-open/month:inline">−</span></span>
        </summary>
        {next?.date.startsWith(group.key) ? <p className="px-1 pb-3 text-sm text-(--muted)">Próxima fecha destacada arriba.</p> : null}
        <ul className="space-y-2 pb-3">
          {group.matches.map(match => {
            const result = match.status === "played" ? data.results.find(item => item.matchId === match.id) : undefined;
            const title = result ? result.winner === "draw" ? "Empate" : `Ganó ${result.winner === "A" ? "Rojo" : "Amarillo"}` : `${match.time} · ${match.location || "Cancha por definir"}`;
            return <li key={match.id}><Link href={`/matches/${match.id}`} className={`flex min-h-20 items-center gap-3 rounded-xl bg-emerald-950/30 px-3 py-3 hover:bg-emerald-950/60 ${focus}`}>
              <time dateTime={match.date} className="w-14 shrink-0 text-center text-sm font-bold uppercase text-slate-300">{new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" }).format(new Date(`${match.date}T12:00:00`))}</time>
              <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-bold text-white">{title}</h3><div className="mt-2"><Status match={match} /></div>{match.status === "suspended" && match.notes ? <p className="mt-2 break-words text-xs text-slate-300">{match.notes}</p> : null}</div>
              <ChevronRight aria-hidden="true" className="shrink-0 text-slate-300" size={18} /><span className="sr-only">Ver detalle del {fullDate(match.date)}</span>
            </Link></li>;
          })}
        </ul>
      </details>)}
      {!months.length ? <p className="py-4 text-(--muted)">No hay partidos registrados.</p> : null}
      <p className="mt-4 text-xs text-(--muted)">Lista cerrada significa inscripciones cerradas, no partido jugado. Las fechas suspendidas conservan su detalle.</p>
    </section>
  </div>;
}
