"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock, Plus, Scale, TrendingUp, Wallet } from "lucide-react";
import { addClubExpenseAction, saveMonthlyPaymentAction, setMatchPlayerPaymentStatusAction } from "@/app/actions";
import { Button, Card, Input, Modal, PageTitle, Stat } from "./SifupWorkspace";
import { formatCurrency, isPlayerMonthlyForMonth, monthLabel, monthlyPaymentFor, newId, shiftMonthKey } from "@/lib/store";
import type { ClubExpense, Match, MatchPlayer, MonthlyPayment, Player, SifupData } from "@/lib/types";

type GalletaPlayerSummary = {
  key: string;
  playerId: string | null;
  name: string;
  paid: number;
  pending: number;
  rows: { match: Match; row: MatchPlayer }[];
};

export function PaymentsSummary({ data, monthKey, canEdit }: { data: SifupData; monthKey: string; canEdit: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showExpenseForm, setShowExpenseForm] = useState(false);

  const monthlyPlayers = data.players
    .filter((player) => player.active && isPlayerMonthlyForMonth(player.id, monthKey, data.players, data.monthlyPayments))
    .sort((a, b) => a.name.localeCompare(b.name));

  const matchesInMonth = [...data.matches.filter((match) => match.monthKey === monthKey)].sort((a, b) => a.date.localeCompare(b.date));
  const matchIdsInMonth = new Set(matchesInMonth.map((match) => match.id));

  const cuotaPayments = monthlyPlayers.map((player) => ({
    player,
    payment: monthlyPaymentFor(player, monthKey, data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey)),
    playedCount: data.matchPlayers.filter((row) => matchIdsInMonth.has(row.matchId) && row.playerId === player.id && row.attendanceStatus !== "out").length,
  }));
  const paidCount = cuotaPayments.filter((item) => item.payment.paymentStatus === "paid").length;
  const cuotaCollected = cuotaPayments.reduce((sum, item) => sum + item.payment.amountPaid, 0);
  const cuotaExpected = cuotaPayments.reduce((sum, item) => sum + item.payment.expectedAmount, 0);
  const cuotaPending = cuotaPayments.reduce((sum, item) => sum + Math.max(item.payment.expectedAmount - item.payment.amountPaid, 0), 0);
  const cuotaPlayedTotal = cuotaPayments.reduce((sum, item) => sum + item.playedCount, 0);

  const gastoPartidos = matchesInMonth.reduce((sum, match) => sum + match.totalCost, 0);
  const expensesInMonth = [...data.clubExpenses.filter((expense) => expense.expenseDate.slice(0, 7) === monthKey)].sort((a, b) => a.expenseDate.localeCompare(b.expenseDate));
  const gastoExtra = expensesInMonth.reduce((sum, expense) => sum + expense.amount, 0);
  const gastoTotal = gastoPartidos + gastoExtra;

  const galletaRows = data.matchPlayers.filter(
    (row) =>
      matchIdsInMonth.has(row.matchId) &&
      row.attendanceStatus !== "out" &&
      !(row.playerId && isPlayerMonthlyForMonth(row.playerId, monthKey, data.players, data.monthlyPayments))
  );
  const ingresosGalleta = galletaRows.reduce((sum, row) => sum + row.amountPaid, 0);
  const galletaPending = galletaRows.reduce((sum, row) => sum + Math.max(row.amountDue - row.amountPaid, 0), 0);

  const galletaByPlayer = new Map<string, GalletaPlayerSummary>();
  for (const row of galletaRows) {
    const match = matchesInMonth.find((item) => item.id === row.matchId);
    if (!match) continue;
    const key = row.playerId ?? `name:${row.name.trim().toLowerCase()}`;
    const entry = galletaByPlayer.get(key) ?? { key, playerId: row.playerId ?? null, name: row.name, paid: 0, pending: 0, rows: [] };
    entry.paid += row.amountPaid;
    entry.pending += Math.max(row.amountDue - row.amountPaid, 0);
    entry.rows.push({ match, row });
    galletaByPlayer.set(key, entry);
  }
  const galletaPlayers = [...galletaByPlayer.values()].sort((a, b) => a.name.localeCompare(b.name));

  const ingresosDelMes = cuotaCollected + ingresosGalleta;
  const pendientesDePago = cuotaPending + galletaPending;
  const saldoDelMes = ingresosDelMes + pendientesDePago - gastoTotal;

  function toggleCuota(player: Player) {
    const existing = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey);
    const base = monthlyPaymentFor(player, monthKey, existing);
    const now = new Date().toISOString();
    const wasPaid = base.paymentStatus === "paid";
    const updated: MonthlyPayment = wasPaid
      ? { ...base, paymentStatus: "unpaid", amountPaid: 0, paidAt: undefined, updatedAt: now }
      : { ...base, paymentStatus: "paid", amountPaid: base.expectedAmount, paidAt: now, updatedAt: now };
    setError("");
    startTransition(async () => {
      try {
        await saveMonthlyPaymentAction(updated);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo actualizar la cuota.");
      }
    });
  }

  function addExpense(expense: ClubExpense) {
    setError("");
    startTransition(async () => {
      try {
        await addClubExpenseAction(expense);
        setShowExpenseForm(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el gasto.");
      }
    });
  }

  function toggleGalleta(row: MatchPlayer) {
    const nextStatus = row.paymentStatus === "paid" ? "unpaid" : "paid";
    setError("");
    startTransition(async () => {
      try {
        await setMatchPlayerPaymentStatusAction(row.id, nextStatus);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo actualizar el pago.");
      }
    });
  }

  return (
    <div>
      <Link href="/payments" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-(--muted) transition hover:text-white">
        <ChevronLeft size={14} /> Pagos
      </Link>
      <PageTitle
        title="Resumen mensual"
        description={monthLabel(monthKey).replace(/^\w/, (letter) => letter.toUpperCase())}
        action={
          <div className="flex items-center gap-1">
            <Link href={`?date=${shiftMonthKey(monthKey, -1)}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] text-white transition hover:bg-white/[0.12]" aria-label="Mes anterior">
              <ChevronLeft size={16} />
            </Link>
            <span className="min-w-24 rounded-md border border-(--border) bg-white/[0.04] px-3 py-1.5 text-center text-sm font-black text-white">{monthKey}</span>
            <Link href={`?date=${shiftMonthKey(monthKey, 1)}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] text-white transition hover:bg-white/[0.12]" aria-label="Mes siguiente">
              <ChevronRight size={16} />
            </Link>
          </div>
        }
      />

      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Costos del mes" value={formatCurrency(-gastoTotal)} tone="red" icon={<Wallet size={18} />} />
        <Stat label="Ingresos del mes" value={formatCurrency(ingresosDelMes)} tone="green" icon={<TrendingUp size={18} />} />
        <Stat label="Pendientes de pago" value={formatCurrency(pendientesDePago)} tone="gold" icon={<Clock size={18} />} />
        <Stat label="Saldo del mes" value={formatCurrency(saldoDelMes)} tone={saldoDelMes >= 0 ? "green" : "red"} icon={<Scale size={18} />} highlight />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-black text-white">Gastos</h2>
            {canEdit ? (
              <Button variant="secondary" onClick={() => setShowExpenseForm(true)}>
                <Plus size={14} /> Gasto
              </Button>
            ) : null}
          </div>
          <ul className="space-y-2">
            {matchesInMonth.map((match) => {
              const played = data.results.some((result) => result.matchId === match.id);
              return (
                <li key={match.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2 text-(--muted)">
                    <Link href={`/matches/${match.id}`} className="hover:text-(--cyan) hover:underline">Partido {match.date}</Link>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${played ? "bg-(--green)/15 text-(--green)" : "bg-white/10 text-(--muted)"}`}>
                      {played ? "Jugado" : "Pendiente"}
                    </span>
                  </span>
                  <span className="font-bold text-white">{formatCurrency(match.totalCost)}</span>
                </li>
              );
            })}
            {expensesInMonth.map((expense) => (
              <li key={expense.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-(--muted)">{expense.label}</span>
                <span className="font-bold text-white">{formatCurrency(expense.amount)}</span>
              </li>
            ))}
            {matchesInMonth.length === 0 && expensesInMonth.length === 0 ? <li className="text-sm text-(--muted)">Sin gastos registrados este mes.</li> : null}
          </ul>
          <div className="flex items-center justify-between border-t border-(--border) pt-2 text-sm font-black text-white">
            <span>Total</span>
            <span>{formatCurrency(gastoTotal)}</span>
          </div>
        </Card>

        <Card className="space-y-3">
          <div>
            <h2 className="text-lg font-black text-white">Situacion galletas</h2>
            <p className="text-xs text-(--muted)">Solo jugadores que jugaron algun partido este mes.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-(--border)">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-[10px] font-black uppercase tracking-wide text-(--muted)">
                <tr>
                  <th className="px-2 py-1.5 text-left">Jugador</th>
                  <th className="px-2 py-1.5 text-left">Partidos</th>
                  <th className="px-2 py-1.5 text-right">Pagado</th>
                  <th className="px-2 py-1.5 text-right">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {galletaPlayers.map((entry) => {
                  const sortedRows = [...entry.rows].sort((a, b) => a.match.date.localeCompare(b.match.date));
                  return (
                    <tr key={entry.key} className="border-t border-(--border)">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {entry.playerId ? (
                          <Link href={`/players/${entry.playerId}`} className="font-semibold text-white hover:text-(--cyan) hover:underline">{entry.name}</Link>
                        ) : (
                          <span className="font-semibold text-white">{entry.name}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {sortedRows.map(({ match, row }) => {
                            const paid = row.paymentStatus === "paid";
                            const title = `${match.date}: ${paid ? "Pagado" : "Pendiente"}${canEdit ? " - toca para cambiar" : ""}`;
                            return (
                              <button
                                key={row.id}
                                type="button"
                                disabled={!canEdit || isPending}
                                title={title}
                                onClick={() => toggleGalleta(row)}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition disabled:cursor-not-allowed ${paid ? "bg-(--green)/15 text-(--green)" : "bg-(--red)/15 text-(--red)"} ${canEdit ? "hover:opacity-80" : ""}`}
                              >
                                {match.date.slice(5)}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-bold text-(--green)">{formatCurrency(entry.paid)}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right font-bold ${entry.pending > 0 ? "text-(--red)" : "text-(--muted)"}`}>
                        {entry.pending > 0 ? formatCurrency(entry.pending) : "-"}
                      </td>
                    </tr>
                  );
                })}
                {galletaPlayers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-sm text-(--muted)">Sin galletas este mes.</td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className="border-t border-(--border) font-black text-white">
                  <td className="px-2 py-1.5" colSpan={2}>Total</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{formatCurrency(ingresosGalleta)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{formatCurrency(galletaPending)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card className="space-y-3">
          <div>
            <h2 className="text-lg font-black text-white">Oficiales Mensuales</h2>
            <p className="text-xs font-semibold text-(--muted)">{paidCount}/{monthlyPlayers.length} pagaron</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-(--border)">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-[10px] font-black uppercase tracking-wide text-(--muted)">
                <tr>
                  <th className="px-2 py-1.5 text-left">Jugador</th>
                  <th className="px-2 py-1.5 text-right">Partidos</th>
                  <th className="px-2 py-1.5 text-right">Pagado</th>
                  <th className="px-2 py-1.5 text-right">No pagado</th>
                </tr>
              </thead>
              <tbody>
                {cuotaPayments.map(({ player, payment, playedCount }) => {
                  const paid = payment.paymentStatus === "paid";
                  const amountCell = canEdit ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => toggleCuota(player)}
                      title="Toca para cambiar el estado"
                      className={`font-bold transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60 ${paid ? "text-(--green)" : "text-(--red)"}`}
                    >
                      {formatCurrency(payment.expectedAmount)}
                    </button>
                  ) : (
                    <span className={`font-bold ${paid ? "text-(--green)" : "text-(--red)"}`}>{formatCurrency(payment.expectedAmount)}</span>
                  );
                  return (
                    <tr key={player.id} className="border-t border-(--border)">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <Link href={`/players/${player.id}`} className="font-semibold text-white hover:text-(--cyan) hover:underline">{player.name}</Link>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-(--muted)">{playedCount}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{paid ? amountCell : "-"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{paid ? "-" : amountCell}</td>
                    </tr>
                  );
                })}
                {monthlyPlayers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-sm text-(--muted)">Sin jugadores mensuales este mes.</td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className="border-t border-(--border) font-black text-white">
                  <td className="px-2 py-1.5">Total</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{cuotaPlayedTotal}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{formatCurrency(cuotaCollected)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{formatCurrency(cuotaExpected - cuotaCollected)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>

      {showExpenseForm ? (
        <Modal title="Agregar gasto" onClose={() => setShowExpenseForm(false)}>
          <ExpenseForm monthKey={monthKey} isPending={isPending} onSave={addExpense} onCancel={() => setShowExpenseForm(false)} />
        </Modal>
      ) : null}
    </div>
  );
}

function ExpenseForm({
  monthKey,
  isPending,
  onSave,
  onCancel,
}: {
  monthKey: string;
  isPending: boolean;
  onSave: (expense: ClubExpense) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ClubExpense["category"]>("other");
  const [expenseDate, setExpenseDate] = useState(`${monthKey}-01`);

  function submit() {
    if (!label.trim() || !Number(amount)) return;
    const now = new Date().toISOString();
    onSave({
      id: newId("expense"),
      expenseDate,
      label: label.trim(),
      amount: Number(amount),
      category,
      note: "",
      createdAt: now,
      updatedAt: now,
    });
  }

  return (
    <div className="space-y-3 pb-4">
      <Input label="Descripcion" value={label} onChange={setLabel} />
      <Input label="Monto" type="number" value={amount} onChange={setAmount} />
      <Input label="Fecha" type="date" value={expenseDate} onChange={setExpenseDate} />
      <label className="block space-y-1 text-sm font-medium text-(--muted)">
        <span>Categoria</span>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as ClubExpense["category"])}
          className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white outline-none focus:border-(--green) focus:ring-4 focus:ring-(--green)/20"
        >
          <option value="court">Cancha</option>
          <option value="equipment">Equipamiento</option>
          <option value="other">Otro</option>
        </select>
      </label>
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button onClick={submit} disabled={isPending}>Guardar</Button>
      </div>
    </div>
  );
}
