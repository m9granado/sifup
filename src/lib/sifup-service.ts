import "server-only";

import { revalidatePath } from "next/cache";
import { COURT_COST, PER_MATCH_AMOUNT } from "./sifup-constants";
import { monthKey, weekLabel } from "./sifup-date";
import { parseWhatsAppList } from "./parser";
import { getSifupData, saveMatchWithPlayers } from "./repository";
import { newId, nextMatch, sortByWhatsappOrder, summarizeMatch } from "./store";
import { finalResultMessage, matchSummaryMessage, pendingPaymentsMessage, teamsMessage } from "./whatsapp";
import type { Match, MatchPlayer, Player } from "./types";

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
  const match =
    (input.matchId ? data.matches.find((item) => item.id === input.matchId) : undefined) ??
    (input.date ? data.matches.find((item) => item.date === input.date) : undefined) ??
    nextMatch(data.matches);

  if (!match) throw new Error("No hay partidos registrados.");

  const rows = sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === match.id));
  const result = data.results.find((item) => item.matchId === match.id);
  return buildMatchPayload(match, rows, result, "summary");
}

function buildMatchPayload(match: Match, rows: MatchPlayer[], result: Parameters<typeof finalResultMessage>[1], status: "created" | "updated" | "summary") {
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
    url: `https://sifup.vercel.app/matches/${match.id}`,
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

function revalidateSifupViews(matchId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/matches");
  revalidatePath("/payments");
  revalidatePath("/players");
  revalidatePath("/standings");
  revalidatePath(`/matches/${matchId}`);
}

