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
  const squadTarget = match.squadTarget ?? (match.matchFormat === "7x7" ? 14 : MINIMUM_PLAYERS);
  const confirmed = sortRowsMonthlyFirst(rows.filter((row) => row.attendanceStatus === "confirmed"), players, match.monthKey, monthlyPayments);
  const official = confirmed.slice(0, squadTarget);
  const overflow = confirmed.slice(squadTarget);

  const galletas = sortByWhatsappOrder(rows.filter((row) => row.attendanceStatus === "galleta" || (row.attendanceStatus === "waitlist" && !row.note.toLowerCase().includes("banca"))));
  const bench = [
    ...sortByWhatsappOrder(rows.filter((row) => row.attendanceStatus === "banca" || (row.attendanceStatus === "waitlist" && row.note.toLowerCase().includes("banca")))),
    ...overflow,
  ];
  const out = sortByWhatsappOrder(rows.filter((row) => row.attendanceStatus === "out"));

  const matchDate = new Date(`${match.date}T12:00:00`);
  const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const rawDayOfWeek = dayNames[matchDate.getDay()] ?? "Martes";
  const dayOfWeek = rawDayOfWeek.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // "Martes", "Miercoles"
  const dayNum = matchDate.getDate();
  const monthName = monthNames[matchDate.getMonth()] ?? "Septiembre";
  const timeFormatted = match.time.length <= 2 ? `${match.time.padStart(2, "0")}:00` : match.time.slice(0, 5);

  const header = `⚽ *SIFUP · Fútbol de ${dayOfWeek.toLowerCase()}*`;
  const dateTime = `📅 ${dayOfWeek} ${dayNum} ${monthName} · 🕘 ${timeFormatted} hrs`;
  const location = `📍 ${match.location}`;
  const court = match.courtPrepaid ? "💰 Cancha pagada ✅" : `💰 Cancha: ${formatCurrency(match.courtCost)}`;

  const slotCount = Math.max(squadTarget, official.length);
  const playerLines = Array.from({ length: slotCount }, (_, index) => {
    const player = official[index];
    const num = String(index + 1).padStart(2, " ");
    if (!player) return `${num} · `;
    const isPaid = player.paymentStatus === "paid" || isMonthlyRow(player, players, match.monthKey, monthlyPayments);
    return `${num} · ${player.name}${isPaid ? " ✅" : ""}`;
  });

  let galletasBlock = "🍪 *Galletas abiertas:* -";
  if (galletas.length > 0) {
    const lines = galletas.map((row, index) => `${index + 1} · ${row.name} 🍪`);
    galletasBlock = `🍪 *Galletas abiertas*\n${lines.join("\n")}`;
  }

  let benchBlock = "🪑 *Banca:* -";
  if (bench.length > 0) {
    const lines = bench.map((row, index) => `${index + 1} · ${row.name}`);
    benchBlock = `🪑 *Banca*\n${lines.join("\n")}`;
  }

  let outBlock = "❌ *No pueden:* -";
  if (out.length > 0) {
    const lines = out.map((row) => `- ${row.name}`);
    outBlock = `❌ *No pueden:*\n${lines.join("\n")}`;
  }

  return `${header}
${dateTime}
${location}
${court}

*Jugadores (${Math.min(confirmed.length, squadTarget)}/${squadTarget})*
${playerLines.join("\n")}

${galletasBlock}

${benchBlock}
${outBlock}

🔗 Ver partido:
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
  const playerLabel = (player: MatchPlayer) => `${player.attendanceStatus === "galleta" || player.attendanceStatus === "waitlist" || player.note.toLowerCase().includes("galleta") ? "🍪 " : ""}#${whatsappOrderFor(player)} ${player.name}`;
  return `SIFUP - Equipos ${match.date}\n\nEquipo Rojo:\n${teamA.map((player) => `- ${playerLabel(player)}`).join("\n") || "- Por asignar"}\n\nEquipo Amarillo:\n${teamB.map((player) => `- ${playerLabel(player)}`).join("\n") || "- Por asignar"}`;
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

export function shortMatchCode(match: Match) {
  return match.date.slice(5).replace("-", "");
}

export function shortMatchUrl(match: Match) {
  return `${PUBLIC_BASE_URL}/m/${shortMatchCode(match)}`;
}
