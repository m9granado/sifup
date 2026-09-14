"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { addClubExpenseAction, saveMonthlyPaymentAction } from "@/app/actions";
import { Button, Card, Input, Modal, PageTitle, PaymentBadge, Stat } from "./SifupWorkspace";
import { formatCurrency, isPlayerMonthlyForMonth, monthLabel, monthlyPaymentFor, newId, shiftMonthKey } from "@/lib/store";
import type { ClubExpense, MonthlyPayment, Player, SifupData } from "@/lib/types";

export function PaymentsSummary({ data, monthKey, canEdit }: { data: SifupData; monthKey: string; canEdit: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showExpenseForm, setShowExpenseForm] = useState(false);

  const monthlyPlayers = data.players
    .filter((player) => player.active && isPlayerMonthlyForMonth(player.id, monthKey, data.players, data.monthlyPayments))
    .sort((a, b) => a.name.localeCompare(b.name));
  const paidCount = monthlyPlayers.filter((player) => data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey)?.paymentStatus === "paid").length;

  const matchesInMonth = [...data.matches.filter((match) => match.monthKey === monthKey)].sort((a, b) => a.date.localeCompare(b.date));
  const matchIdsInMonth = new Set(matchesInMonth.map((match) => match.id));
  const gastoPartidos = matchesInMonth.reduce((sum, match) => sum + match.totalCost, 0);
  const expensesInMonth = [...data.clubExpenses.filter((expense) => expense.expenseDate.slice(0, 7) === monthKey)].sort((a, b) => a.expenseDate.localeCompare(b.expenseDate));
  const gastoExtra = expensesInMonth.reduce((sum, expense) => sum + expense.amount, 0);
  const gastoTotal = gastoPartidos + gastoExtra;

  const galletaRows = data.matchPlayers.filter(
    (row) => matchIdsInMonth.has(row.matchId) && !(row.playerId && isPlayerMonthlyForMonth(row.playerId, monthKey, data.players, data.monthlyPayments))
  );
  const ingresosGalleta = galletaRows.reduce((sum, row) => sum + row.amountPaid, 0);

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

  return (
    <div>
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

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Cuotas pagadas" value={`${paidCount}/${monthlyPlayers.length}`} />
        <Stat label="Gasto del mes" value={formatCurrency(gastoTotal)} />
        <Stat label="Ingresos galleta" value={formatCurrency(ingresosGalleta)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="space-y-3">
          <h2 className="text-lg font-black text-white">Cuota del mes</h2>
          <ul className="space-y-2">
            {monthlyPlayers.map((player) => {
              const payment = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey);
              const status = payment?.paymentStatus ?? "unpaid";
              return (
                <li key={player.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white">{player.name}</span>
                  {canEdit ? (
                    <button type="button" disabled={isPending} onClick={() => toggleCuota(player)} className="disabled:opacity-60">
                      <PaymentBadge status={status} />
                    </button>
                  ) : (
                    <PaymentBadge status={status} />
                  )}
                </li>
              );
            })}
            {monthlyPlayers.length === 0 ? <li className="text-sm text-(--muted)">Sin jugadores mensuales este mes.</li> : null}
          </ul>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-black text-white">Gasto del mes</h2>
            {canEdit ? (
              <Button variant="secondary" onClick={() => setShowExpenseForm(true)}>
                <Plus size={14} /> Gasto
              </Button>
            ) : null}
          </div>
          <ul className="space-y-2">
            {matchesInMonth.map((match) => (
              <li key={match.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-(--muted)">Partido {match.date}</span>
                <span className="font-bold text-white">{formatCurrency(match.totalCost)}</span>
              </li>
            ))}
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
          <h2 className="text-lg font-black text-white">Ingresos por galleta</h2>
          <ul className="space-y-2">
            {matchesInMonth.map((match) => {
              const matchGalletaTotal = galletaRows.filter((row) => row.matchId === match.id).reduce((sum, row) => sum + row.amountPaid, 0);
              return (
                <li key={match.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-(--muted)">Partido {match.date}</span>
                  <span className="font-bold text-white">{formatCurrency(matchGalletaTotal)}</span>
                </li>
              );
            })}
            {matchesInMonth.length === 0 ? <li className="text-sm text-(--muted)">Sin partidos este mes.</li> : null}
          </ul>
          <div className="flex items-center justify-between border-t border-(--border) pt-2 text-sm font-black text-white">
            <span>Total</span>
            <span>{formatCurrency(ingresosGalleta)}</span>
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
