import type { Match, MatchPlayer, MatchResult } from "./types";
import { formatCurrency, sortByWhatsappOrder, whatsappOrderFor } from "./store";

const MINIMUM_PLAYERS = 12;
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const PUBLIC_BASE_URL = "https://sifup.vercel.app";

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

export function finalResultMessage(match: Match, result?: MatchResult) {
  if (!result) return `SIFUP - Resultado pendiente para ${match.date}.`;
  const winner = result.winner === "draw" ? "Empate" : `Gana ${result.winner === "A" ? "Rojo" : "Amarillo"}`;
  return `SIFUP - Resultado final ${match.date}\nRojo ${result.scoreA} - ${result.scoreB} Amarillo\n${winner}${result.notes ? `\n${result.notes}` : ""}`;
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
