import type { Match, MatchPlayer, MatchResult, MatchTeam } from "./types";
import { formatCurrency, sortByWhatsappOrder, whatsappOrderFor } from "./store";
import { PUBLIC_BASE_URL } from "./sifup-constants";

const MINIMUM_PLAYERS = 12;
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function matchSummaryMessage(match: Match, players: MatchPlayer[]) {
  const confirmed = sortByWhatsappOrder(players.filter((player) => player.attendanceStatus === "confirmed"));
  const out = sortByWhatsappOrder(players.filter((player) => player.attendanceStatus === "out"));
  const playerLines = Array.from({ length: Math.max(MINIMUM_PLAYERS, confirmed.length) }, (_, index) => {
    const player = confirmed[index];
    return `${index + 1}- ${player?.name ?? ""}`;
  });
  const outLines = out.length > 0 ? out.map((player) => `- ${player.name}`) : ["-"];

  return `Partidos ${formatMatchDate(match.date)} ${formatMatchTime(match.time)}
${match.location}:

Jugadores:
${playerLines.join("\n")}

No pueden
${outLines.join("\n")}

Ver partido:
${shortMatchUrl(match)}`;
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
