import type { Match, MatchPlayer, MatchResult, Player, SifupData } from "./types";

export function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nextMatch(matches: Match[]) {
  const now = new Date();
  const upcoming = matches
    .filter((match) => new Date(`${match.date}T${match.time || "00:00"}`) >= now)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  if (upcoming.length > 0) return upcoming[0];
  return [...matches].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
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
  return {
    confirmedCount: confirmed.length,
    paidCount: confirmed.filter((item) => item.paymentStatus === "paid").length,
    unpaidCount: confirmed.filter((item) => item.paymentStatus === "unpaid").length,
    promisedCount: confirmed.filter((item) => item.paymentStatus === "promised").length,
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
