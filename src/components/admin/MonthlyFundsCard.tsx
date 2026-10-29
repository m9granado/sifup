import { clubCashSnapshot, monthlyFunds } from "@/lib/club-cash";
import { courtFinanceSummary } from "@/lib/court-payments";
import { formatCurrency, monthLabel } from "@/lib/store";
import type { SifupData } from "@/lib/types";
import { ClubCashCard } from "./ClubCashCard";

export function MonthlyFundsCard({ data, monthKey, cutoff }: { data: SifupData; monthKey: string; cutoff: string }) {
  const funds = monthlyFunds(data, monthKey, cutoff);

  const month = monthLabel(monthKey).split(" de ")[0];
  const coverage = courtFinanceSummary(data, monthKey).matches.filter(row => row.payment?.paidDate && row.payment.paidDate <= cutoff && row.allocatedAmount > 0);
  return <>
    <p className="mb-3 text-xs text-(--muted)">Según registros SIFUP · corte {cutoff}</p>
    <section aria-labelledby="monthly-funds-title" className="mb-4 rounded-xl border border-(--green)/40 bg-(--green)/5 p-5">
      <h2 id="monthly-funds-title" className="text-sm font-bold text-white">Saldo de fondos imputados · provisional</h2>
      <p className="mt-2 text-4xl font-black text-white">{formatCurrency(funds.balance)}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><p className="text-sm text-(--muted)">Recibido para {month}</p><p className="text-xl font-black text-(--green)">{formatCurrency(funds.received)}</p></div>
        <div><p className="text-sm text-(--muted)">Nuevos desembolsos del mes</p><p className="text-xl font-black text-white">{formatCurrency(funds.disbursed)}</p></div>
      </div>
      <p className="mt-3 text-sm text-(--muted)">Incluye anticipos para este mes. No equivale al saldo bancario ni a caja conciliada.</p>
      <details className="mt-2 text-sm"><summary className="cursor-pointer py-2 font-bold text-white focus-visible:outline-2 focus-visible:outline-(--green)">Ver cálculo y registros</summary>
        <p className="mb-3 text-(--muted)">Cuotas por mes y galletas por fecha del partido, solo importes recibidos. Sin pendientes, promesas ni reservas. Gastos según fecha de pago: no hay imputación independiente a otro mes. Gastos financiados con fondos anteriores o anticipos sin vínculo limitan este saldo provisional.</p>
        <p className="mb-3 text-(--muted)">Recibido para este mes sin fecha de recepción registrada: {formatCurrency(funds.undatedReceived)}. Incluido aquí; excluido del flujo fechado.</p>
        <ul className="max-h-64 space-y-2 overflow-auto text-(--muted)">{funds.receipts.map(item => <li key={item.id} className="border-t border-white/10 py-2">
          <p className="font-semibold text-white">Para {month} · {item.date ? `recibido en ${monthLabel(item.date.slice(0, 7)).split(" de ")[0]}` : "fecha de recepción no registrada"}</p>
          <p className="break-words">{item.source} · {item.date ?? "Sin fecha"} · {item.id} · {formatCurrency(item.amount)}</p>
        </li>)}</ul>
        {funds.receipts.length === 0 ? <p className="text-(--muted)">Sin fondos recibidos registrados para este mes.</p> : null}
        <ul className="mt-3 space-y-2 text-(--muted)">{funds.expenses.map(item => <li key={item.id} className="break-words">Desembolso {item.date} · {item.source} · {item.id} · {formatCurrency(Math.abs(item.amount))}</li>)}</ul>
      </details>
    </section>
    <section aria-labelledby="court-coverage-title" className="mb-4 rounded-xl border border-(--border) bg-white/[0.03] p-4">
      <h2 id="court-coverage-title" className="font-bold text-white">Cancha a favor / cobertura</h2>
      <p className="mt-2 text-sm text-(--muted)">Sesiones informadas por administración: respaldo y asignación pendientes de verificar. La cantidad informada no está registrada en esta fuente; no se presenta como crédito aplicado.</p>
      <p className="mt-2 text-sm text-white">Asignaciones con gasto vinculado para este mes: {coverage.length}.</p>
      <ul className="mt-1 text-sm text-(--muted)">{coverage.map(row => <li key={row.matchId}>{row.date} · {row.status === "suspended" ? "Fecha suspendida" : "Pago vinculado"} · desembolso original {row.payment?.paidDate}</li>)}</ul>
      <p className="mt-2 text-xs text-(--muted)">Sin vínculo no significa sin crédito a favor. Consumir o trasladar un anticipo no crea efectivo ni un nuevo desembolso. No se descuenta otra vez el costo programado.</p>
    </section>
  </>;
}

export function MonthlyFundsDetails({ data, monthKey, cutoff }: { data: SifupData; monthKey: string; cutoff: string }) {
  const funds = monthlyFunds(data, monthKey, cutoff);
  const period = clubCashSnapshot(data, cutoff).dated.filter(item => item.date?.startsWith(monthKey));
  return <>
    <details className="mb-3 mt-4 rounded-lg border border-(--border) px-4 text-sm">
      <summary className="cursor-pointer py-3 font-bold text-white">Flujo por fecha de cobro/pago</summary>
      <p className="pb-3 text-(--muted)">Solo movimientos fechados en {monthLabel(monthKey)}, hasta {cutoff}: recibido {formatCurrency(period.filter(item => item.amount > 0).reduce((sum, item) => sum + item.amount, 0))} · desembolsado {formatCurrency(funds.disbursed)}. Los anticipos recibidos en otro mes figuran en ese mes de recepción, no aquí.</p>
    </details>
    <details className="mb-4 rounded-lg border border-(--border) px-4 text-sm">
      <summary className="cursor-pointer py-3 font-bold text-white">Subtotal global no conciliado · independiente del mes</summary>
      <ClubCashCard data={data} cutoff={cutoff} />
    </details>
  </>;
}
