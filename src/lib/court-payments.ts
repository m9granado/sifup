import { monthKey, weekLabel } from "./sifup-date";
import { newMatchId } from "./store";
import type { CourtPayment, Match, SifupData } from "./types";

export type CourtPaymentInput = { expenseId: string; matchId: string; targetDate?: string };

export function validCourtDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function courtWasPlayed(data: SifupData, match: Match) {
  if (match.status === "suspended") return false;
  return match.status === "played" || hasCourtActivity(data, match);
}

function hasCourtActivity(data: SifupData, match: Match) {
  return data.results.some((result) => result.matchId === match.id)
    || (data.matchTeams ?? []).some((team) => team.matchId === match.id && team.finalRank !== undefined)
    || (data.matchGames ?? []).some((game) => game.matchId === match.id);
}

// A single allocation covers one court in full. Partial payments and chained transfers
// need an explicit workflow rather than silently changing the agreed payment history.
export function planCourtPayment(data: SifupData, input: CourtPaymentInput, now = new Date().toISOString()) {
  const source = data.matches.find((match) => match.id === input.matchId);
  if (!source) throw new Error("No existe el partido de origen.");
  const expense = data.clubExpenses.find((item) => item.id === input.expenseId);
  if (!expense || expense.category !== "court") throw new Error("Selecciona un gasto de cancha existente.");
  if (!Number.isSafeInteger(source.courtCost) || source.courtCost <= 0) throw new Error("Costo de cancha invalido.");
  const date = input.targetDate ?? source.date;
  if (!validCourtDate(date)) throw new Error("Fecha invalida: usa YYYY-MM-DD.");
  const transfer = input.targetDate !== undefined;
  if (transfer && date <= source.date) throw new Error("La fecha destino debe ser posterior al partido suspendido.");
  const payments = data.courtPayments ?? [];
  const previous = payments.find((item) => item.sourceMatchId === source.id);
  if (payments.some((item) => item.targetMatchId === source.id && item.sourceMatchId !== source.id)) {
    throw new Error("Este partido ya recibe un credito trasladado; no se permiten traslados encadenados.");
  }
  const candidates = transfer ? data.matches.filter((match) => match.date === date) : [source];
  if (candidates.length > 1) throw new Error("Hay varios partidos en la fecha destino; resuelve la ambiguedad antes de trasladar.");
  const existingTarget = candidates[0];
  if (previous && (previous.expenseId !== expense.id || (previous.targetMatchId !== source.id && previous.targetMatchId !== existingTarget?.id))) {
    throw new Error("Este pago ya fue vinculado o trasladado a otro destino.");
  }
  if (transfer && (source.status === "played" || hasCourtActivity(data, source))) throw new Error("El origen tiene actividad o resultado: no puede suspenderse con este traslado.");
  if (!transfer && source.status === "suspended") throw new Error("No se puede consumir un pago en una fecha suspendida.");
  const sameAllocation = previous?.targetMatchId === existingTarget?.id && previous?.expenseId === expense.id;
  if (transfer && existingTarget && (existingTarget.status === "suspended" || (!sameAllocation && courtWasPlayed(data, existingTarget)))) {
    throw new Error("El destino debe ser un partido pendiente, sin actividad ni resultado.");
  }
  const target: Match = existingTarget ?? {
    ...source, id: newMatchId(date, data.matches.map((match) => match.id)), date,
    monthKey: monthKey(date), weekLabel: weekLabel(date), status: "confirmed",
    courtPrepaid: true, notes: "", createdAt: now, updatedAt: now,
  };
  if (target.courtCost !== source.courtCost) throw new Error("El destino debe mantener el valor de la cancha pagada.");
  if (payments.some((item) => item.targetMatchId === target.id && item.sourceMatchId !== source.id)) {
    throw new Error("El partido destino ya tiene otro pago vinculado.");
  }
  const amount = previous?.amount ?? source.courtCost;
  if (amount !== source.courtCost) throw new Error("El costo cambio desde la vinculacion; revisa el pago antes de trasladar.");
  const allocated = payments.filter((item) => item.expenseId === expense.id && item.sourceMatchId !== source.id).reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(expense.amount) || allocated + amount > expense.amount) throw new Error("El gasto no tiene saldo suficiente para cubrir esta cancha.");
  const payment: CourtPayment = { sourceMatchId: source.id, targetMatchId: target.id, expenseId: expense.id, amount };
  const unchanged = previous?.targetMatchId === target.id && previous.expenseId === expense.id && (!transfer || source.status === "suspended");
  return {
    payment, unchanged, createTarget: !existingTarget,
    source: transfer ? { ...source, status: "suspended" as const, courtPrepaid: false, updatedAt: now } : source,
    target: { ...target, courtPrepaid: true, updatedAt: now },
  };
}

export function courtFinanceSummary(data: SifupData, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mes invalido: usa YYYY-MM.");
  const payments = data.courtPayments ?? [];
  const expenses = data.clubExpenses.filter((expense) => expense.category === "court");
  const matches = data.matches.filter((match) => match.date.slice(0, 7) === month);
  const rows = matches.map((match) => {
    const payment = payments.find((item) => item.targetMatchId === match.id);
    const outgoing = payments.find((item) => item.sourceMatchId === match.id && item.targetMatchId !== match.id);
    const expense = expenses.find((item) => item.id === payment?.expenseId);
    const played = courtWasPlayed(data, match);
    return {
      matchId: match.id, date: match.date, status: match.status, played,
      courtCost: match.courtCost, allocatedAmount: payment?.amount ?? 0,
      consumedAmount: played ? payment?.amount ?? 0 : 0,
      scheduledCredit: !played && match.status !== "suspended" ? payment?.amount ?? 0 : 0,
      payment: payment ? { ...payment, paidDate: expense?.expenseDate } : null,
      transferredTo: outgoing ? data.matches.find((item) => item.id === outgoing.targetMatchId)?.date : null,
      needsPaymentLink: !payment && !outgoing,
    };
  });
  return {
    month, cashPaid: expenses.filter((expense) => expense.expenseDate.slice(0, 7) === month).reduce((sum, expense) => sum + expense.amount, 0),
    playedCount: rows.filter((row) => row.played).length,
    recordedPlayedCost: rows.filter((row) => row.played).reduce((sum, row) => sum + row.courtCost, 0),
    unlinkedPlayedCount: rows.filter((row) => row.played && row.needsPaymentLink).length,
    suspendedCount: rows.filter((row) => row.status === "suspended").length,
    allocatedAmount: rows.reduce((sum, row) => sum + row.allocatedAmount, 0),
    consumedAmount: rows.reduce((sum, row) => sum + row.consumedAmount, 0),
    scheduledCredit: rows.reduce((sum, row) => sum + row.scheduledCredit, 0),
    matches: rows,
    expenses: expenses.map((expense) => {
      const allocated = payments.filter((item) => item.expenseId === expense.id).reduce((sum, item) => sum + item.amount, 0);
      return { id: expense.id, date: expense.expenseDate, label: expense.label, amount: expense.amount, allocated, unallocated: expense.amount - allocated };
    }),
  };
}
