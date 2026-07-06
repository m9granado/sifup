import "server-only";

import { revalidatePath } from "next/cache";
import { COURT_COST, MONTHLY_AMOUNT, PER_MATCH_AMOUNT, PUBLIC_BASE_URL } from "./sifup-constants";
import { monthKey, weekLabel } from "./sifup-date";
import { parseWhatsAppList } from "./parser";
import { getSifupData, saveMatchPlayers, saveMatchWithPlayers, saveMonthlyPayment } from "./repository";
import { newId, nextMatch, sortByWhatsappOrder, summarizeMatch } from "./store";
import { finalResultMessage, matchSummaryMessage, pendingPaymentsMessage, teamsMessage } from "./whatsapp";
import type { AttendanceStatus, Match, MatchPlayer, MonthlyPayment, Player, Team } from "./types";

export type ImportWhatsAppMatchInput = {
  message: string;
  matchId?: string;
  amountDue?: number;
};

export async function importWhatsAppMatch({ message, matchId, amountDue = PER_MATCH_AMOUNT }: ImportWhatsAppMatchInput) {
  const parsed = parseWhatsAppList(message, amountDue);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.join(" "));
  }

  const data = await getSifupData();
  const existing = matchId
    ? data.matches.find((match) => match.id === matchId)
    : data.matches.find((match) => match.date === parsed.match.date && match.time === parsed.match.time);
  const now = new Date().toISOString();
  const targetId = existing?.id ?? newId("match");
  const match: Match = {
    id: targetId,
    date: parsed.match.date,
    time: parsed.match.time,
    location: existing?.location || parsed.match.location || "Por definir",
    status: existing?.status ?? "confirmed",
    totalCost: existing?.totalCost ?? COURT_COST,
    weekLabel: existing?.weekLabel || weekLabel(parsed.match.date),
    monthKey: existing?.monthKey || monthKey(parsed.match.date),
    courtCost: existing?.courtCost ?? COURT_COST,
    courtPrepaid: existing?.courtPrepaid ?? true,
    notes: existing?.notes || "Importado desde WhatsApp por MCP.",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const rows: MatchPlayer[] = parsed.players.map((row, index) => {
    const player = findKnownPlayer(data.players, row.name);
    const monthly = player?.paymentPlan === "monthly";
    const out = row.attendanceStatus === "out";
    return {
      ...row,
      id: `${targetId}-player-${index + 1}`,
      matchId: targetId,
      playerId: player?.id,
      name: player?.name ?? row.name,
      phone: player?.phone ?? row.phone,
      paymentStatus: out || monthly ? "paid" : row.paymentStatus,
      amountDue: out || monthly ? 0 : row.amountDue,
      amountPaid: out || monthly ? 0 : row.amountPaid,
      note: out ? "No puede" : monthly && !row.note ? "mensualidad" : row.note,
      team: out ? "none" : row.team,
      whatsappOrder: row.whatsappOrder || index + 1,
      createdAt: now,
      updatedAt: now,
    };
  });

  await saveMatchWithPlayers(match, rows);
  revalidateSifupViews(match.id);

  return buildMatchPayload(match, rows, data.results.find((result) => result.matchId === match.id), existing ? "updated" : "created");
}

export async function getNextMatchSummary(input: { matchId?: string; date?: string } = {}) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);

  if (!match) throw new Error("No hay partidos registrados.");

  const rows = sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === match.id));
  const result = data.results.find((item) => item.matchId === match.id);
  return buildMatchPayload(match, rows, result, "summary");
}

export type AddPlayerToMatchInput = {
  name: string;
  matchId?: string;
  date?: string;
  phone?: string;
  attendanceStatus?: AttendanceStatus;
  team?: Team;
  amountDue?: number;
};

export async function addPlayerToMatch(input: AddPlayerToMatchInput) {
  const name = input.name?.trim();
  if (!name) throw new Error("Falta el nombre del jugador.");

  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const currentRows = data.matchPlayers.filter((row) => row.matchId === match.id);
  const result = data.results.find((item) => item.matchId === match.id);
  const known = findKnownPlayer(data.players, name);
  const already = currentRows.find(
    (row) => (known && row.playerId === known.id) || normalizeName(row.name) === normalizeName(name),
  );
  if (already) {
    const payload = buildMatchPayload(match, currentRows, result, "unchanged");
    return { ...payload, note: `${already.name} ya estaba en la lista del partido.` };
  }

  const attendanceStatus = input.attendanceStatus ?? "confirmed";
  const out = attendanceStatus === "out";
  const monthly = known?.paymentPlan === "monthly";
  const amountDue = input.amountDue ?? PER_MATCH_AMOUNT;
  const now = new Date().toISOString();
  const newRow: MatchPlayer = {
    id: newId("mp"),
    matchId: match.id,
    playerId: known?.id,
    name: known?.name ?? name,
    phone: input.phone ?? known?.phone ?? "",
    attendanceStatus,
    paymentStatus: out || monthly ? "paid" : "unpaid",
    amountDue: out || monthly ? 0 : amountDue,
    amountPaid: 0,
    note: out ? "No puede" : monthly ? "mensualidad" : "",
    team: out ? "none" : input.team ?? "none",
    whatsappOrder: Math.max(0, ...currentRows.map((row) => row.whatsappOrder || 0)) + 1,
    goals: 0,
    createdAt: now,
    updatedAt: now,
  };

  const nextRows = [...currentRows, newRow];
  await saveMatchPlayers(match.id, nextRows);
  revalidateSifupViews(match.id);

  const payload = buildMatchPayload(match, nextRows, result, "updated");
  return { ...payload, note: `${newRow.name} agregado al partido en el puesto #${newRow.whatsappOrder}.` };
}

function resolveMatch(matches: Match[], input: { matchId?: string; date?: string }) {
  return (
    (input.matchId ? matches.find((item) => item.id === input.matchId) : undefined) ??
    (input.date ? matches.find((item) => item.date === input.date) : undefined) ??
    nextMatch(matches)
  );
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export type RegisterMonthlyPaymentInput = {
  name?: string;
  playerId?: string;
  monthKey?: string;
  paid?: boolean;
};

export async function registerMonthlyPayment(input: RegisterMonthlyPaymentInput) {
  const data = await getSifupData();
  const player = input.playerId
    ? data.players.find((item) => item.id === input.playerId)
    : input.name
      ? findKnownPlayer(data.players, input.name)
      : undefined;
  if (!player) throw new Error("Jugador no encontrado.");
  if (player.paymentPlan !== "monthly") throw new Error(`${player.name} no es jugador mensual (oficial).`);

  const targetMonth = input.monthKey ?? currentMonthKey();
  const paid = input.paid ?? true;
  const existing = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === targetMonth);
  const expected = existing?.expectedAmount ?? MONTHLY_AMOUNT;
  const now = new Date().toISOString();
  const payment: MonthlyPayment = {
    id: existing?.id ?? `monthly-${targetMonth}-${player.id}`,
    playerId: player.id,
    monthKey: targetMonth,
    expectedAmount: expected,
    amountPaid: paid ? expected : 0,
    paymentStatus: paid ? "paid" : "unpaid",
    note: existing?.note ?? `Mensualidad ${targetMonth}, vencimiento 10/${targetMonth.slice(5)}`,
    paidAt: paid ? now : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await saveMonthlyPayment(payment);
  revalidateSifupViews();

  return {
    status: paid ? "paid" : "unpaid",
    player: player.name,
    monthKey: targetMonth,
    expectedAmount: expected,
    amountPaid: payment.amountPaid,
    paidAt: payment.paidAt ?? null,
    note: paid
      ? `${player.name} pago la mensualidad de ${targetMonth}.`
      : `Se marco pendiente la mensualidad de ${player.name} para ${targetMonth}.`,
  };
}

export async function getPendingPayments(input: { monthKey?: string } = {}) {
  const data = await getSifupData();
  const targetMonth = input.monthKey ?? currentMonthKey();

  const monthlyPending = data.players
    .filter((player) => player.active && player.paymentPlan === "monthly")
    .map((player) => {
      const payment = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === targetMonth);
      const expected = payment?.expectedAmount ?? MONTHLY_AMOUNT;
      const amountPaid = payment?.paymentStatus === "paid" ? expected : payment?.amountPaid ?? 0;
      return { player: player.name, monthKey: targetMonth, expected, pending: Math.max(expected - amountPaid, 0), status: payment?.paymentStatus ?? "unpaid" };
    })
    .filter((item) => item.pending > 0);

  const perMatchPending = data.matchPlayers
    .filter((row) => row.amountDue > row.amountPaid)
    .map((row) => {
      const match = data.matches.find((item) => item.id === row.matchId);
      return { player: row.name, match: match?.weekLabel || match?.date || row.matchId, matchId: row.matchId, pending: Math.max(row.amountDue - row.amountPaid, 0), status: row.paymentStatus };
    });

  return {
    monthKey: targetMonth,
    totals: {
      monthly: monthlyPending.reduce((sum, item) => sum + item.pending, 0),
      perMatch: perMatchPending.reduce((sum, item) => sum + item.pending, 0),
    },
    monthlyPending,
    perMatchPending,
  };
}

function buildMatchPayload(match: Match, rows: MatchPlayer[], result: Parameters<typeof finalResultMessage>[1], status: "created" | "updated" | "summary" | "unchanged") {
  const sortedRows = sortByWhatsappOrder(rows);
  const summary = summarizeMatch(sortedRows);
  const confirmed = sortedRows.filter((row) => row.attendanceStatus === "confirmed");
  const out = sortedRows.filter((row) => row.attendanceStatus === "out");

  return {
    status,
    match,
    summary,
    players: {
      confirmed: confirmed.map(publicMatchPlayer),
      out: out.map(publicMatchPlayer),
      all: sortedRows.map(publicMatchPlayer),
    },
    messages: {
      matchSummary: matchSummaryMessage(match, sortedRows),
      pendingPayments: pendingPaymentsMessage(match, sortedRows),
      teams: teamsMessage(match, sortedRows),
      finalResult: finalResultMessage(match, result),
    },
    url: `${PUBLIC_BASE_URL}/matches/${match.id}`,
  };
}

function publicMatchPlayer(row: MatchPlayer) {
  return {
    id: row.id,
    name: row.name,
    attendanceStatus: row.attendanceStatus,
    paymentStatus: row.paymentStatus,
    amountDue: row.amountDue,
    amountPaid: row.amountPaid,
    note: row.note,
    team: row.team,
    whatsappOrder: row.whatsappOrder,
  };
}

export type FindPlayerInput = {
  query: string;
  limit?: number;
};

export async function findPlayer({ query, limit = 5 }: FindPlayerInput) {
  const data = await getSifupData();
  const candidates = rankPlayerCandidates(data.players, query).slice(0, limit);

  return {
    query,
    matches: candidates.map(({ player, matchType, score }) => ({
      id: player.id,
      name: player.name,
      nickname: player.nickname,
      active: player.active,
      paymentPlan: player.paymentPlan,
      skillLevel: player.skillLevel,
      matchType,
      score,
    })),
  };
}

type PlayerMatchType = "exact" | "prefix" | "nickname" | "contains" | "nickname-contains" | "token";

function rankPlayerCandidates(players: Player[], name: string) {
  const target = normalizeName(name);
  const ranked: { player: Player; matchType: PlayerMatchType; score: number }[] = [];

  for (const player of players) {
    const match = scorePlayerMatch(player, target);
    if (match) ranked.push({ player, ...match });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

function scorePlayerMatch(player: Player, target: string): { matchType: PlayerMatchType; score: number } | null {
  const playerName = normalizeName(player.name);
  const nickname = normalizeName(player.nickname);

  if (target === playerName || (nickname && target === nickname)) return { matchType: "exact", score: 100 };

  if (target.length >= 3 && (playerName.startsWith(target) || target.startsWith(playerName))) {
    return { matchType: "prefix", score: 85 };
  }

  if (nickname && target.length >= 2 && (nickname.startsWith(target) || target.startsWith(nickname))) {
    return { matchType: "nickname", score: 80 };
  }

  if (playerName.includes(target) || target.includes(playerName)) {
    return { matchType: "contains", score: 65 };
  }

  if (nickname && (nickname.includes(target) || target.includes(nickname))) {
    return { matchType: "nickname-contains", score: 60 };
  }

  const targetTokens = new Set(target.split(" ").filter(Boolean));
  const overlap = playerName.split(" ").filter((token) => token && targetTokens.has(token)).length;
  if (overlap > 0) return { matchType: "token", score: 40 + overlap * 10 };

  return null;
}

function findKnownPlayer(players: Player[], name: string) {
  const target = normalizeName(name);
  return players.find((player) => {
    const playerName = normalizeName(player.name);
    const nickname = normalizeName(player.nickname);
    return (
      target === playerName ||
      target === nickname ||
      (target.length >= 5 && playerName.startsWith(target)) ||
      (playerName.length >= 5 && target.startsWith(playerName)) ||
      (nickname.length >= 5 && target.includes(nickname))
    );
  });
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function revalidateSifupViews(matchId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/matches");
  revalidatePath("/payments");
  revalidatePath("/players");
  revalidatePath("/standings");
  if (matchId) revalidatePath(`/matches/${matchId}`);
}

