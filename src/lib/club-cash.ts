import type { SifupData } from "./types";

export function clubCashSnapshot(data: SifupData, cutoff: string) {
  const movements: { id: string; date: string | null; amount: number; source: string; kind: "monthly" | "match" | "expense"; category?: string }[] = [];
  for (const payment of [...data.monthlyPayments, ...data.matchPlayers]) {
    if (payment.amountPaid <= 0) continue;
    const date = payment.paidDate ?? (payment.paidAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(payment.paidAt)) : null);
    movements.push({ id: payment.id, date, amount: payment.amountPaid, kind: "monthKey" in payment ? "monthly" : "match", source: "monthKey" in payment ? `Cuota ${payment.monthKey}` : `Galleta ${payment.matchId}` });
  }
  const unclassified = data.clubExpenses.filter(expense => expense.amount < 0);
  for (const expense of data.clubExpenses.filter(expense => expense.amount > 0)) movements.push({ id: expense.id, date: expense.expenseDate, amount: -expense.amount, kind: "expense", category: expense.category, source: expense.label });
  const dated = movements.filter(item => item.date && item.date <= cutoff);
  const undated = movements.filter(item => !item.date);
  const sum = (rows: typeof movements) => rows.reduce((total, row) => total + row.amount, 0);
  const period = dated.filter(item => item.date?.startsWith(cutoff.slice(0, 7)));
  return {
    cutoff, recordedDatedBalance: sum(dated), undatedReceived: sum(undated), dated, undated, unclassified,
    periodReceived: sum(period.filter(item => item.amount > 0)),
    periodDisbursed: Math.abs(sum(period.filter(item => item.amount < 0))),
    // There is no reconciled opening balance or complete ledger in the current model.
    reconciled: false as const,
  };
}

export function clubCashYear(data: SifupData, year: number, cutoff: string) {
  const cash = clubCashSnapshot(data, cutoff);
  let running = 0;
  return Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const movements = cash.dated.filter(item => item.date?.startsWith(key));
    const sum = (kind: string, category?: string) => movements.filter(item => item.kind === kind && (!category || item.category === category)).reduce((total, item) => total + item.amount, 0);
    const galletas = sum("match"), mensual = sum("monthly");
    const gastosCancha = Math.abs(sum("expense", "court")), otrosGastos = Math.abs(sum("expense")) - gastosCancha;
    running += galletas + mensual - gastosCancha - otrosGastos;
    return { key, galletas, mensual, gastosCancha, otrosGastos, running };
  });
}
