import "server-only";
import { revalidatePath } from "next/cache";
import { applyCourtPayment, applyCourtExpense, applySchedule, getSifupData } from "./repository";
import { matchRecords, planSchedule, planCourtExpense, type ScheduleEntry, type CourtExpenseInput } from "./court-operations";

export async function getMatchRecords(input: { dates: string[] }) {
  return { records: matchRecords(await getSifupData(), input.dates) };
}

export async function scheduleMatches(input: { entries: ScheduleEntry[]; dryRun?: boolean }) {
  const preview = planSchedule(await getSifupData(), input.entries);
  if (input.dryRun !== false) return { dryRun: true, plan: preview };
  const plan = await applySchedule(input.entries);
  for (const path of ["/dashboard", "/matches", "/payments", "/payments/resumen", ...plan.map(row => `/matches/${row.match.id}`)]) revalidatePath(path);
  const records = matchRecords(await getSifupData(), input.entries.map(row => row.date));
  for (const { match } of plan) {
    const saved = records.flatMap(row => row.matches).find(row => row.match.id === match.id)?.match;
    if (!saved || ["date", "time", "location", "status", "notes", "courtCost", "courtPrepaid"].some(key => saved[key as keyof typeof saved] !== match[key as keyof typeof match])) throw new Error("Agenda no verificada; consulta fechas antes de reintentar.");
  }
  return { dryRun: false, plan, records };
}

export async function registerCourtExpense(input: CourtExpenseInput & { dryRun?: boolean }) {
  const preview = planCourtExpense(await getSifupData(), input);
  if (input.dryRun !== false) return { dryRun: true, ...preview };
  const plan = await applyCourtExpense(input);
  for (const path of ["/dashboard", "/payments", "/payments/resumen"]) revalidatePath(path);
  const saved = (await getSifupData()).clubExpenses.find(row => row.id === input.expenseId);
  if (!saved || saved.expenseDate !== plan.expense.expenseDate || saved.amount !== plan.expense.amount || saved.note !== plan.expense.note) throw new Error("Gasto no verificado; consulta antes de reintentar.");
  return { dryRun: false, unchanged: plan.unchanged, expense: saved };
}
import { courtFinanceSummary, planCourtPayment, type CourtPaymentInput } from "./court-payments";

export async function getCourtFinances(input: { monthKey: string }) {
  return courtFinanceSummary(await getSifupData(), input.monthKey);
}

export async function linkCourtPayment(input: CourtPaymentInput & { dryRun?: boolean }) {
  const preview = planCourtPayment(await getSifupData(), input);
  if (input.dryRun !== false) return { dryRun: true, ...preview };
  const plan = await applyCourtPayment(input);
  for (const path of ["/dashboard", "/matches", "/payments", "/payments/resumen", "/standings", `/matches/${plan.source.id}`, `/matches/${plan.target.id}`]) {
    revalidatePath(path);
  }
  // Read back the exact allocation before reporting a successful mutation.
  const data = await getSifupData();
  const saved = data.courtPayments?.find((payment) => payment.sourceMatchId === input.matchId);
  if (!saved || saved.targetMatchId !== plan.payment.targetMatchId || saved.expenseId !== plan.payment.expenseId || saved.amount !== plan.payment.amount) {
    throw new Error("El pago no pudo verificarse tras la escritura; consulta el estado antes de reintentar.");
  }
  const source = data.matches.find((match) => match.id === plan.source.id);
  const target = data.matches.find((match) => match.id === plan.target.id);
  if (!source || !target || target.date !== plan.target.date || (source.id !== target.id && source.status !== "suspended")) {
    throw new Error("El traslado no pudo verificarse; consulta ambos partidos antes de reintentar.");
  }
  return { dryRun: false, ...plan, payment: saved };
}
