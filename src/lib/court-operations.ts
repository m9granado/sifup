import { validCourtDate, courtWasPlayed } from "./court-payments";
import { monthKey, weekLabel } from "./sifup-date";
import { newMatchId } from "./store";
import type { ClubExpense, Match, SifupData } from "./types";

export type ScheduleEntry = { date: string; time: string; location: string; status: "open" | "suspended"; notes: string; courtCost: number };
export type CourtExpenseInput = { expenseId: string; expenseDate: string; amount: number; label: string; payer: string; provider: string; evidence: string };

export function matchRecords(data: SifupData, dates: string[]) {
  if (!dates.length || dates.length > 12 || dates.some(date => !validCourtDate(date))) throw new Error("Selecciona entre 1 y 12 fechas validas.");
  return dates.map(date => ({ date, matches: data.matches.filter(match => match.date === date).map(match => ({
    match, players: data.matchPlayers.filter(row => row.matchId === match.id),
    results: data.results.filter(row => row.matchId === match.id),
    teams: data.matchTeams.filter(row => row.matchId === match.id), games: data.matchGames.filter(row => row.matchId === match.id),
    allocations: (data.courtPayments ?? []).filter(row => row.sourceMatchId === match.id || row.targetMatchId === match.id),
  })) }));
}

export function planSchedule(data: SifupData, entries: ScheduleEntry[], now = new Date().toISOString()) {
  if (!entries.length || entries.length > 12 || new Set(entries.map(row => row.date)).size !== entries.length) throw new Error("Selecciona entre 1 y 12 fechas distintas.");
  return entries.map(entry => {
    if (!validCourtDate(entry.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) throw new Error("Fecha u hora invalida.");
    if (!["open", "suspended"].includes(entry.status) || !entry.location.trim() || !entry.notes.trim() || !Number.isSafeInteger(entry.courtCost) || entry.courtCost <= 0) throw new Error("Estado, lugar, motivo y costo son obligatorios.");
    const candidates = data.matches.filter(match => match.date === entry.date);
    if (candidates.length > 1) throw new Error("Fecha ambigua: existe mas de un partido.");
    const previous = candidates[0];
    if (previous && courtWasPlayed(data, { ...previous, status: previous.status === "suspended" ? "open" : previous.status })) throw new Error("No se puede reprogramar una fecha con actividad o resultado.");
    if ((data.courtPayments ?? []).some(payment => payment.targetMatchId === previous?.id || payment.sourceMatchId === previous?.id)) throw new Error("La fecha tiene un pago vinculado: usa el traslado de credito, no la agenda.");
    const match: Match = { ...(previous ?? { id: newMatchId(entry.date, data.matches.map(match => match.id)), totalCost: entry.courtCost, courtPrepaid: false, matchFormat: "clasico", squadTarget: 12, createdAt: now }),
      ...entry, monthKey: monthKey(entry.date), weekLabel: weekLabel(entry.date), updatedAt: now };
    // Scheduling never certifies payment. Suspending an unlinked date clears only its unsupported prepaid flag.
    if (entry.status === "suspended") match.courtPrepaid = false;
    const unchanged = !!previous && ["time", "location", "status", "notes", "courtCost", "courtPrepaid"].every(key => previous[key as keyof Match] === match[key as keyof Match]);
    return { previous: previous ?? null, match: unchanged ? previous : match, unchanged };
  });
}

export function planCourtExpense(data: SifupData, input: CourtExpenseInput, now = new Date().toISOString()) {
  if (!validCourtDate(input.expenseDate) || !Number.isSafeInteger(input.amount) || input.amount <= 0 || [input.expenseId, input.label, input.payer, input.provider, input.evidence].some(text => !text.trim())) throw new Error("Gasto invalido: fecha, monto, pagador, proveedor y procedencia son obligatorios.");
  const note = `Pagador: ${input.payer}. Proveedor: ${input.provider}. Evidencia: ${input.evidence}`;
  const previous = data.clubExpenses.find(row => row.id === input.expenseId);
  if (previous && (previous.expenseDate !== input.expenseDate || previous.amount !== input.amount || previous.category !== "court" || previous.label !== input.label || previous.note !== note)) throw new Error("El identificador ya existe con otros datos; no se sobrescribe un gasto.");
  if (!previous && data.clubExpenses.some(row => row.category === "court" && row.expenseDate === input.expenseDate && row.amount === input.amount)) throw new Error("Posible gasto duplicado: revisa el existente por fecha y monto.");
  const expense: ClubExpense = previous ?? { id: input.expenseId, expenseDate: input.expenseDate, amount: input.amount, label: input.label, category: "court", note, createdAt: now, updatedAt: now };
  return { expense, unchanged: !!previous };
}
