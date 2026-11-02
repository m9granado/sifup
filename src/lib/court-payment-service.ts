import "server-only";
import { revalidatePath } from "next/cache";
import { applyCourtPayment, getSifupData } from "./repository";
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
