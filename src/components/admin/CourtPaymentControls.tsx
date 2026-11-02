"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkCourtPaymentAction } from "@/app/actions";
import { formatCurrency } from "@/lib/store";
import { matchStatusLabels } from "@/lib/matches-overview";
import type { CourtPaymentInput } from "@/lib/court-payments";
import type { SifupData } from "@/lib/types";

type Preview = Awaited<ReturnType<typeof linkCourtPaymentAction>>;
export function CourtPaymentControls({ data, canEdit }: { data: SifupData; canEdit: boolean }) {
  const router = useRouter();
  const [expenseId,setExpenseId] = useState("");
  const [matchId,setMatchId] = useState("");
  const [transfer,setTransfer] = useState(false);
  const [targetDate,setTargetDate] = useState("");
  const [evidence,setEvidence] = useState(false);
  const [preview,setPreview] = useState<{ input: CourtPaymentInput; result: Preview } | null>(null);
  const [message,setMessage] = useState("");
  const [busy,startTransition] = useTransition();
  if(!canEdit) return null;
  const input: CourtPaymentInput = {expenseId,matchId,...(transfer ? {targetDate} : {})};
  const current = preview && JSON.stringify(preview.input) === JSON.stringify(input);
  function run(apply: boolean) {
    if(!evidence || (apply && !current)) return;
    startTransition(async()=>{
      try {
        const result = await linkCourtPaymentAction({...input,dryRun:!apply});
        if(apply) { setPreview(null);setEvidence(false);setMessage("Asignación guardada y releída. No se registró un nuevo gasto ni se modificaron pagos de jugadores.");router.refresh(); }
        else {setPreview({input,result});setMessage("");}
      } catch(error) { setPreview(null);setMessage(error instanceof Error ? error.message : "No se pudo verificar la asignación."); }
    });
  }
  const field = "mt-1 w-full rounded-md border border-white/20 bg-(--panel-strong) px-3 py-2 text-white";
  return <section className="mb-4 rounded-xl border border-white/15 p-4" aria-labelledby="court-payment-controls">
    <h2 id="court-payment-controls" className="font-bold text-white">Vincular o trasladar un pago de cancha</h2>
    <p className="mt-2 text-sm text-amber-100">Solo con respaldo del gasto y crédito vigente conciliado. Saldo técnico sin asignar no demuestra crédito real; un paquete antiguo no respalda automáticamente otras fechas.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Gasto original<select disabled={busy} className={field} value={expenseId} onChange={event=>{setExpenseId(event.target.value);setEvidence(false);}}><option value="">Seleccionar gasto</option>{data.clubExpenses.filter(item=>item.category==="court").map(item=><option key={item.id} value={item.id}>{item.expenseDate} · {item.label} · {formatCurrency(item.amount)}</option>)}</select></label>
      <label className="text-sm">Partido de origen<select disabled={busy} className={field} value={matchId} onChange={event=>{setMatchId(event.target.value);setEvidence(false);}}><option value="">Seleccionar partido</option>{[...data.matches].sort((a,b)=>b.date.localeCompare(a.date)).map(match=><option key={match.id} value={match.id}>{match.date} · {match.time} · {matchStatusLabels[match.status]}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input disabled={busy} type="checkbox" checked={transfer} onChange={event=>{setTransfer(event.target.checked);setEvidence(false);}} />Trasladar a otra fecha conservando origen suspendido</label>
      {transfer ? <label className="text-sm">Fecha destino<input disabled={busy} type="date" className={field} value={targetDate} onChange={event=>{setTargetDate(event.target.value);setEvidence(false);}} /></label> : null}
    </div>
    <label className="mt-4 flex items-start gap-2 text-sm"><input disabled={busy} type="checkbox" className="mt-1" checked={evidence} onChange={event=>setEvidence(event.target.checked)} />Verifiqué el respaldo del pago original y el crédito real vigente para estas fechas. No estoy usando solo el saldo técnico.</label>
    <button type="button" disabled={busy || !evidence || !expenseId || !matchId || (transfer && !targetDate)} onClick={()=>run(false)} className="mt-3 rounded-lg border border-white/30 px-4 py-2 font-bold disabled:opacity-40">Previsualizar sin escribir</button>
    {current ? <div className="mt-4 rounded-lg border border-amber-200/40 p-3 text-sm"><p>Gasto: {preview.input.expenseId} · {formatCurrency(preview.result.payment.amount)}</p><p>Origen: {preview.result.source.date} → Destino: {preview.result.target.date}</p><p>{preview.result.createTarget ? "Se creará destino vacío." : "Se conserva la convocatoria del destino existente."} El gasto conserva su fecha; no se trasladan pagos de jugadores.</p><button type="button" disabled={busy || !evidence} onClick={()=>run(true)} className="mt-3 rounded-lg bg-amber-200 px-4 py-2 font-bold text-black disabled:opacity-40">Confirmar asignación previsualizada</button></div> : null}
    {message ? <p role="status" className="mt-3 break-words text-sm text-amber-100">{message}</p> : null}
  </section>;
}
