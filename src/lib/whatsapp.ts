import type { Match, MatchPlayer, MatchResult } from "./types";
import { formatCurrency, sortByWhatsappOrder, summarizeMatch, whatsappOrderFor } from "./store";

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
