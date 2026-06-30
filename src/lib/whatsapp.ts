import type { Match, MatchPlayer, MatchResult } from "./types";
import { formatCurrency, summarizeMatch } from "./store";

export function matchSummaryMessage(match: Match, players: MatchPlayer[]) {
  const summary = summarizeMatch(players);
  const list = players
    .map((player, index) => `${index + 1}. ${player.name} - ${labelPayment(player.paymentStatus)}`)
    .join("\n");
  return `SIFUP - Partido\n${match.date} ${match.time}\nLugar: ${match.location}\nConfirmados: ${summary.confirmedCount}\n\n${list}`;
}

export function pendingPaymentsMessage(match: Match, players: MatchPlayer[]) {
  const pending = players.filter((player) => player.paymentStatus !== "paid");
  if (pending.length === 0) return `SIFUP - Pagos al dia para ${match.date}.`;
  return `SIFUP - Pagos pendientes ${match.date}\n${pending
    .map((player) => `- ${player.name}: ${formatCurrency(Math.max(player.amountDue - player.amountPaid, 0))} (${labelPayment(player.paymentStatus)})`)
    .join("\n")}`;
}

export function teamsMessage(match: Match, players: MatchPlayer[]) {
  const teamA = players.filter((player) => player.team === "A").map((player) => player.name);
  const teamB = players.filter((player) => player.team === "B").map((player) => player.name);
  return `SIFUP - Equipos ${match.date}\n\nEquipo A:\n${teamA.map((name) => `- ${name}`).join("\n") || "- Por asignar"}\n\nEquipo B:\n${teamB.map((name) => `- ${name}`).join("\n") || "- Por asignar"}`;
}

export function finalResultMessage(match: Match, result?: MatchResult) {
  if (!result) return `SIFUP - Resultado pendiente para ${match.date}.`;
  const winner = result.winner === "draw" ? "Empate" : `Gana equipo ${result.winner}`;
  return `SIFUP - Resultado final ${match.date}\nEquipo A ${result.scoreA} - ${result.scoreB} Equipo B\n${winner}${result.notes ? `\n${result.notes}` : ""}`;
}

function labelPayment(status: MatchPlayer["paymentStatus"]) {
  if (status === "paid") return "pagado";
  if (status === "promised") return "prometido";
  return "no pagado";
}
