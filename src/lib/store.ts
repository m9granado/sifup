import type { Match, MatchPlayer, MatchResult, MonthlyPayment, Player, SifupData } from "./types";
import { MONTHLY_AMOUNT, PER_MATCH_AMOUNT } from "./sifup-constants";

export function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newMatchId(date: string, existingIds: Iterable<string> = []) {
  const taken = new Set(existingIds);
  const base = `match-${date}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

export function newPlayerId(name: string, existingIds: Iterable<string> = []) {
  const taken = new Set(existingIds);
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `player-${slug || "jugador"}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

export function nextMatch(matches: Match[]) {
  const now = new Date();
  const upcoming = matches
    .filter((match) => new Date(`${match.date}T${match.time || "00:00"}`) >= now)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  if (upcoming.length > 0) return upcoming[0];
  return [...matches].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
}

export function adjacentMatches(matches: Match[], matchId: string) {
  const sorted = [...matches].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const index = sorted.findIndex((item) => item.id === matchId);
  return {
    previous: index > 0 ? sorted[index - 1] : undefined,
    next: index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : undefined,
  };
}

export function upsertMatch(data: SifupData, match: Match) {
  const matches = data.matches.some((item) => item.id === match.id)
    ? data.matches.map((item) => (item.id === match.id ? match : item))
    : [match, ...data.matches];
  return { ...data, matches };
}

export function replaceMatchPlayers(data: SifupData, matchId: string, rows: MatchPlayer[]) {
  return {
    ...data,
    matchPlayers: [
      ...data.matchPlayers.filter((item) => item.matchId !== matchId),
      ...rows,
    ],
  };
}

export function sortByWhatsappOrder(rows: MatchPlayer[]) {
  return [...rows].sort((a, b) => {
    const orderA = whatsappOrderFor(a);
    const orderB = whatsappOrderFor(b);
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

export function whatsappOrderFor(row: MatchPlayer) {
  const orderFromId = Number(row.id.match(/-player-(\d+)$/)?.[1] ?? 0);
  return row.whatsappOrder || orderFromId || Number.MAX_SAFE_INTEGER;
}

export function isPlayerMonthlyForMonth(playerId: string, monthKey: string, players: Player[], monthlyPayments: SifupData["monthlyPayments"]) {
  const hasRosterForMonth = monthlyPayments.some((payment) => payment.monthKey === monthKey);
  if (hasRosterForMonth) {
    return monthlyPayments.some((payment) => payment.playerId === playerId && payment.monthKey === monthKey);
  }
  return players.find((player) => player.id === playerId)?.paymentPlan === "monthly";
}

export function upsertResult(data: SifupData, result: MatchResult) {
  const results = data.results.some((item) => item.matchId === result.matchId)
    ? data.results.map((item) => (item.matchId === result.matchId ? result : item))
    : [...data.results, result];
  return { ...data, results };
}

export function upsertPlayer(data: SifupData, player: Player) {
  const players = data.players.some((item) => item.id === player.id)
    ? data.players.map((item) => (item.id === player.id ? player : item))
    : [...data.players, player];
  return { ...data, players };
}

export function summarizeMatch(players: MatchPlayer[]) {
  const confirmed = players.filter((item) => item.attendanceStatus === "confirmed");
  // Inconsistencia resuelta: unpaidCount, paidCount y promisedCount abarcan a todos los jugadores activos/no-out
  // para que si pendingAmount > 0 (ej. galletas en lista de espera o banca con saldo pendiente),
  // unpaidCount refleje de manera consistente la cantidad de jugadores que adeudan el monto.
  const payablePlayers = players.filter((item) => item.attendanceStatus !== "out");
  return {
    confirmedCount: confirmed.length,
    paidCount: payablePlayers.filter((item) => item.paymentStatus === "paid").length,
    unpaidCount: payablePlayers.filter((item) => item.paymentStatus === "unpaid" && (item.amountDue > item.amountPaid || item.amountDue > 0)).length,
    promisedCount: payablePlayers.filter((item) => item.paymentStatus === "promised").length,
    totalExpected: payablePlayers.reduce((sum, item) => sum + item.amountDue, 0),
    totalCollected: payablePlayers.reduce((sum, item) => sum + item.amountPaid, 0),
    pendingAmount: payablePlayers.reduce((sum, item) => sum + Math.max(item.amountDue - item.amountPaid, 0), 0),
  };
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function shiftMonthKey(key: string, delta: number) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  const value = new Date(`${key}-10T12:00:00`);
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(value);
}

export function paymentDueLabel(key: string) {
  return `10/${key.slice(5)}`;
}

export function monthlyPaymentFor(player: Player, month: string, existing?: MonthlyPayment): MonthlyPayment {
  if (existing) return existing;
  const now = new Date().toISOString();
  return {
    id: `monthly-${month}-${player.id}`,
    playerId: player.id,
    monthKey: month,
    expectedAmount: MONTHLY_AMOUNT,
    amountPaid: 0,
    paymentStatus: "unpaid",
    note: `Mensualidad ${monthLabel(month)}, vencimiento ${paymentDueLabel(month)}`,
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertMonthlyPayment(payments: MonthlyPayment[], payment: MonthlyPayment) {
  return payments.some((item) => item.id === payment.id || (item.playerId === payment.playerId && item.monthKey === payment.monthKey))
    ? payments.map((item) => (item.id === payment.id || (item.playerId === payment.playerId && item.monthKey === payment.monthKey) ? payment : item))
    : [...payments, payment];
}

export type RosterRowUpdate = Pick<MatchPlayer, "id" | "amountDue" | "amountPaid" | "paymentStatus" | "note">;

export type RosterChangePlan = {
  rowUpdates: RosterRowUpdate[];
  unpaidGalletaCount: number;
  unpaidGalletaAmount: number;
  paidGalletaAmount: number;
  repricedCount: number;
  paidMonthlyAmount: number;
};

const MONTHLY_NOTE = /\s*mensualidad\s*/i;

// Cobros de un jugador al cambiar su condicion mensual/galleta en un mes.
// `playerRows` son solo las filas del jugador; se filtran por mes y se ignoran las "out".
export function planRosterChange({
  playerRows,
  matches,
  monthKey,
  monthly,
  payment,
  cancelGalletas = true,
}: {
  playerRows: MatchPlayer[];
  matches: Match[];
  monthKey: string;
  monthly: boolean;
  payment?: MonthlyPayment;
  cancelGalletas?: boolean;
}): RosterChangePlan {
  const monthMatchIds = new Set(matches.filter((match) => match.monthKey === monthKey).map((match) => match.id));
  const rows = playerRows.filter((row) => monthMatchIds.has(row.matchId) && row.attendanceStatus !== "out");
  const plan: RosterChangePlan = { rowUpdates: [], unpaidGalletaCount: 0, unpaidGalletaAmount: 0, paidGalletaAmount: 0, repricedCount: 0, paidMonthlyAmount: 0 };

  if (monthly) {
    for (const row of rows) {
      plan.paidGalletaAmount += row.amountPaid;
      const pending = Math.max(row.amountDue - row.amountPaid, 0);
      if (pending <= 0) continue;
      plan.unpaidGalletaCount += 1;
      plan.unpaidGalletaAmount += pending;
      if (!cancelGalletas) continue;
      // Si ya habia abonado algo, se respeta lo pagado y solo se cancela el saldo.
      plan.rowUpdates.push({
        id: row.id,
        amountDue: row.amountPaid,
        amountPaid: row.amountPaid,
        paymentStatus: "paid",
        note: row.note.toLowerCase().includes("mensualidad") ? row.note : [row.note, "mensualidad"].filter(Boolean).join(" · "),
      });
    }
    return plan;
  }

  plan.paidMonthlyAmount = payment?.paymentStatus === "paid" ? payment.amountPaid : 0;
  for (const row of rows) {
    if (row.attendanceStatus !== "confirmed" || row.amountDue > 0) continue;
    plan.repricedCount += 1;
    plan.rowUpdates.push({
      id: row.id,
      amountDue: PER_MATCH_AMOUNT,
      amountPaid: 0,
      paymentStatus: "unpaid",
      note: row.note.replace(MONTHLY_NOTE, " ").trim(),
    });
  }
  return plan;
}
