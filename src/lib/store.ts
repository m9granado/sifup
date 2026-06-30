"use client";

import { seedData } from "./mock-data";
import type { Match, MatchPlayer, MatchResult, Player, SifupData } from "./types";

const STORAGE_KEY = "sifup.local.v1";

export function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadData(): SifupData {
  if (typeof window === "undefined") return seedData;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    saveData(seedData);
    return seedData;
  }
  try {
    return JSON.parse(raw) as SifupData;
  } catch {
    saveData(seedData);
    return seedData;
  }
}

export function saveData(data: SifupData) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
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
  return {
    confirmedCount: players.filter((item) => item.attendanceStatus === "confirmed").length,
    paidCount: players.filter((item) => item.paymentStatus === "paid").length,
    unpaidCount: players.filter((item) => item.paymentStatus === "unpaid").length,
    promisedCount: players.filter((item) => item.paymentStatus === "promised").length,
    totalExpected: players.reduce((sum, item) => sum + item.amountDue, 0),
    totalCollected: players.reduce((sum, item) => sum + item.amountPaid, 0),
    pendingAmount: players.reduce((sum, item) => sum + Math.max(item.amountDue - item.amountPaid, 0), 0),
  };
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}
