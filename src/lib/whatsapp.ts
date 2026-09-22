import type { Match, MatchPlayer, MatchResult, MatchTeam, MonthlyPayment, Player } from "./types";
import { formatCurrency, isPlayerMonthlyForMonth, sortByWhatsappOrder, whatsappOrderFor } from "./store";
import { PUBLIC_BASE_URL } from "./sifup-constants";

const MINIMUM_PLAYERS = 12;
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function isMonthlyRow(row: MatchPlayer, players: Player[], monthKey: string, monthlyPayments: MonthlyPayment[]) {
  if (row.note.toLowerCase().includes("mensualidad")) return true;
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  return player ? isPlayerMonthlyForMonth(player.id, monthKey, players, monthlyPayments) : false;
}

function sortRowsMonthlyFirst(rows: MatchPlayer[], players: Player[], monthKey: string, monthlyPayments: MonthlyPayment[]) {
  return [...rows].sort((a, b) => {
    const monthlyA = isMonthlyRow(a, players, monthKey, monthlyPayments) ? 0 : 1;
    const monthlyB = isMonthlyRow(b, players, monthKey, monthlyPayments) ? 0 : 1;
    if (monthlyA !== monthlyB) return monthlyA - monthlyB;
    return whatsappOrderFor(a) - whatsappOrderFor(b) || a.name.localeCompare(b.name);
  });
}

export function matchSummaryMessage(match: Match, rows: MatchPlayer[], players: Player[], monthlyPayments: MonthlyPayment[]) {
  const confirmed = sortRowsMonthlyFirst(rows.filter((row) => row.attendanceStatus === "confirmed"), players, match.monthKey, monthlyPayments);
  const squadTarget = match.squadTarget ?? MINIMUM_PLAYERS;
  const official = confirmed.slice(0, squadTarget);
  const overflow = confirmed.slice(squadTarget).map((row) => ({ ...row, note: "Banca" }));
  const waitlist = sortByWhatsappOrder(rows.filter((row) => row.attendanceStatus === "waitlist"));
  const galletas = waitlist.filter((row) => !row.note.toLowerCase().includes("banca"));
  const bench = [...waitlist.filter((row) => row.note.toLowerCase().includes("banca")), ...overflow];
  const out = sortByWhatsappOrder(rows.filter((row) => row.attendanceStatus === "out"));
  const officialCount = waitlist.length > 0 || overflow.length > 0 ? official.length : Math.max(squadTarget, official.length);
  const playerLines = Array.from({ length: officialCount }, (_, index) => {
    const player = official[index];
    return `${index + 1}- ${player?.name ?? ""}`;
  });
  const outLines = out.length > 0 ? out.map((player) => `- ${player.name}`) : ["-"];

  return `Partidos ${formatMatchDate(match.date)} ${formatMatchTime(match.time)}
${match.location}:

Jugadores:
${playerLines.join("\n")}

${formatGalletasSection(galletas, Math.max(squadTarget - official.length, 0))}

${formatWaitlistSection("Banca", bench)}

No pueden
${outLines.join("\n")}

Ver partido:
${shortMatchUrl(match)}`;
}

function formatWaitlistSection(title: string, rows: MatchPlayer[]) {
  return `${title}:\n${rows.map((row, index) => `${index + 1}- ${row.name}`).join("\n") || "-"}`;
}

function formatGalletasSection(rows: MatchPlayer[], openSlots: number) {
  return `Lista de Espera de Galletas:\n${rows.map((row, index) => {
    const role = index < openSlots ? "disponible para completar el cupo" : "respaldo si alguien se cae";
    return `${index + 1}- ${row.name} (${role})`;
  }).join("\n") || "-"}`;
}

export function pendingPaymentsMessage(match: Match, players: MatchPlayer[]) {
  const pending = players.filter((player) => player.paymentStatus !== "paid");
  if (pending.length === 0) return `SIFUP - Pagos al dia para ${match.date}.`;
  return `SIFUP - Pagos pendientes ${match.date}\n${pending
    .map((player) => `- ${player.name}: ${formatCurrency(Math.max(player.amountDue - player.amountPaid, 0))} (${labelPayment(player.paymentStatus)})`)
    .join("\n")}`;
}

export function teamsMessage(match: Match, players: MatchPlayer[]) {
  const teamA = sortByWhatsappOrder(players.filter((player) => player.team === "A"));
  const teamB = sortByWhatsappOrder(players.filter((player) => player.team === "B"));
  return `SIFUP - Equipos ${match.date}\n\nEquipo Rojo:\n${teamA.map((player) => `- #${whatsappOrderFor(player)} ${player.name}`).join("\n") || "- Por asignar"}\n\nEquipo Amarillo:\n${teamB.map((player) => `- #${whatsappOrderFor(player)} ${player.name}`).join("\n") || "- Por asignar"}`;
}

export function royalTeamsMessage(match: Match, teams: MatchTeam[], players: MatchPlayer[]) {
  const sortedTeams = [...teams].sort((a, b) => a.seq - b.seq);
  const blocks = sortedTeams.map((team) => {
    const teamPlayers = sortByWhatsappOrder(players.filter((player) => player.teamId === team.id));
    return `${team.name}:\n${teamPlayers.map((player) => `- #${whatsappOrderFor(player)} ${player.name}`).join("\n") || "- Por asignar"}`;
  });
  return `SIFUP - Rey de la Cancha ${match.date}\n\n${blocks.join("\n\n")}`;
}

export function finalResultMessage(match: Match, result?: MatchResult) {
  if (!result) return `SIFUP - Resultado pendiente para ${match.date}.`;
  const winner = result.winner === "draw" ? "Empate" : `Gana ${result.winner === "A" ? "Rojo" : "Amarillo"}`;
  return `SIFUP - Resultado final ${match.date}\nRojo ${result.scoreA} - ${result.scoreB} Amarillo\n${winner}${result.notes ? `\n${result.notes}` : ""}`;
}

export function standingsMessage(ranked: { rank: number; name: string; points: number; wins: number; draws: number; losses: number; winRate: number; played: number }[]) {
  const now = new Date();
  const monthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  const lines = ranked.map((p) => `${p.rank}. ${p.name} — ${p.points} pts | ${p.wins}V-${p.draws}E-${p.losses}D | ${p.winRate}%`);
  return `SIFUP - Ranking ${monthLabel}\n\n${lines.join("\n")}`;
}

function labelPayment(status: MatchPlayer["paymentStatus"]) {
  if (status === "paid") return "pagado";
  if (status === "promised") return "prometido";
  return "no pagado";
}

function formatMatchDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${day} ${monthNames[parsed.getMonth()] ?? ""}`.trim();
}

function formatMatchTime(time: string) {
  const [hour] = time.split(":");
  return `${Number(hour)} horas`;
}

export function shortMatchCode(match: Match) {
  return match.date.slice(5).replace("-", "");
}

export function shortMatchUrl(match: Match) {
  return `${PUBLIC_BASE_URL}/m/${shortMatchCode(match)}`;
}
