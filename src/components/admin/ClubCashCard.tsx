import { clubCashSnapshot } from "@/lib/club-cash";
import { formatCurrency } from "@/lib/store";
import type { SifupData } from "@/lib/types";

export function ClubCashCard({ data, cutoff }: { data: SifupData; cutoff: string }) {
  const cash = clubCashSnapshot(data, cutoff);
  return <section aria-labelledby="club-cash-title" className="mb-4 rounded-xl border border-amber-200/40 bg-amber-200/5 p-5">
    <h2 id="club-cash-title" className="text-sm font-bold text-white">Subtotal registrado del club · no conciliado</h2>
    <p className="mt-2 text-3xl font-black text-white">No conciliada</p>
    <p className="mt-2 text-sm text-amber-100">No hay saldo inicial ni movimientos completos conciliados. El subtotal registrado no es el saldo real del club.</p>
    <p className="mt-3 font-bold text-white">Subtotal de movimientos fechados: {formatCurrency(cash.recordedDatedBalance)}</p>
    <p className="mt-1 text-sm text-(--muted)">Corte acumulado: {cutoff} · Fuente: recibos y gastos registrados en SIFUP. No incluye reservas, crédito de cancha ni pagos prometidos.</p>
    <p className="mt-2 text-sm text-(--muted)">Recibido sin fecha verificable, fuera del subtotal: {formatCurrency(cash.undatedReceived)} ({cash.undated.length} registros). Ajustes/descuentos sin clasificar: {cash.unclassified.length}.</p>
    <details className="mt-3"><summary className="cursor-pointer rounded py-2 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-amber-200">Ver fuente del subtotal y recepción sin fecha</summary>
      <ul className="mt-2 max-h-64 space-y-2 overflow-auto text-sm text-(--muted)">{[...cash.dated,...cash.undated].map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 border-b border-white/10 py-1"><span className="min-w-0 break-words">{item.date ?? "Sin fecha"} · {item.source} · {item.id}</span><span>{formatCurrency(item.amount)}</span></li>)}</ul>
    </details>
  </section>;
}
