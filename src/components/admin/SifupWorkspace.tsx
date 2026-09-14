"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Clipboard, MapPin, Medal, MessageCircle, Pencil, Plus, RotateCcw, Save, Search, Share, Shield, Sparkles, Trophy, UserMinus, UserPlus, Users, WalletCards, X } from "lucide-react";
import {
  clearMatchFinalStandingAction,
  createMatchAction,
  finishMatchGameAction,
  markMatchPlayerPaidAction,
  removeMonthlyPaymentAction,
  saveMatchAction,
  saveMatchDetailAction,
  saveMatchTeamsAction,
  saveMonthlyPaymentAction,
  savePlayerAction,
  setMatchFinalStandingAction,
  startMatchGameAction,
  updateMatchGameScoreAction,
  mergePlayersAction,
  savePlayerLoginAction,
  removePlayerLoginAction,
  type PlayerLoginInput,
} from "@/app/actions";
import type { PlayerLogin } from "@/lib/auth";
import { useIsAdmin } from "./AuthMode";
import { parseWhatsAppList } from "@/lib/parser";
import { adjacentMatches, currentMonthKey, formatCurrency, isPlayerMonthlyForMonth, monthLabel, monthlyPaymentFor, newId, newMatchId, newPlayerId, nextMatch, replaceMatchPlayers, shiftMonthKey, sortByWhatsappOrder, summarizeMatch, upsertMatch, upsertMonthlyPayment, upsertPlayer, upsertResult, whatsappOrderFor } from "@/lib/store";
import { calculateRankingRecord, pointsForMatchRow, rankingMatches } from "@/lib/standings";
import { matchSummaryMessage, royalTeamsMessage, teamsMessage } from "@/lib/whatsapp";
import { COURT_COST, LOSS_POINTS, MATCH_TEAM_COLOR_CLASSES, MATCH_TEAM_COLOR_LABEL, MATCH_TEAM_DEFAULT_COLORS, MONTHLY_AMOUNT, PAYMENT_STATUS_LABEL, PER_MATCH_AMOUNT, ROYAL_GAME_TIME_LIMIT_MIN, ROYAL_GOAL_DIFF_TO_WIN, ROYAL_SQUAD_TARGET, SQUAD_TARGET, WIN_POINTS } from "@/lib/sifup-constants";
import type { AttendanceStatus, ClubExpense, GameEndReason, Match, MatchFormat, MatchGame, MatchPlayer, MatchResult, MatchTeam, MatchTeamColor, MonthlyPayment, PaymentPlan, PaymentStatus, Player, SifupData, Team } from "@/lib/types";

const sampleInput = `martes 30 junio, 21 horas, agrupacion de sordos:

1. Wictor (pagado)
2. Galleta
3. Marcio (pagado)
4. Juanjo (pagado)
5. Beto (no pagado)
6. Francis (pagado)
7. Cooper (pagado)
8. Mantelli (no pagado)
9. Pololo de Francis (no pagado)
10. Mario Quintana (pagado)
11. Alonso Duran (pago manana)
12. Felipe arquero (galleta Cooper)`;

type InitialDataProps = { initialData: SifupData };
type PlayerStanding = {
  rank: number;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
};
type TeamAssignableRow = Pick<MatchPlayer, "attendanceStatus" | "name" | "playerId" | "team" | "whatsappOrder">;
type RankedTeamRow<T extends TeamAssignableRow> = {
  row: T;
  index: number;
  standing?: PlayerStanding;
  suggestedTeam: Team;
};

function useSifupData(initialData: SifupData) {
  const [data, setData] = useState<SifupData>(initialData);
  return { data, commit: setData };
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function weekLabel(date: string) {
  if (!date) return "";
  const value = new Date(`${date}T12:00:00`);
  const month = new Intl.DateTimeFormat("es-CL", { month: "short" }).format(value).replace(".", "");
  return `${Math.ceil(value.getDate() / 7)}a sem ${month}`;
}

function findKnownPlayer(players: Player[], name: string) {
  const clean = name.trim().toLowerCase();
  const normalized = clean === "wictor" ? "victor" : clean;

  // Normalized group aliases for Piti / Pituto / Cristopher
  const pitiAliases = ["piti", "pituto", "cristopher"];
  if (pitiAliases.includes(clean)) {
    const found = players.find(
      (player) =>
        pitiAliases.includes(player.name.toLowerCase()) ||
        pitiAliases.includes(player.nickname.toLowerCase())
    );
    if (found) return found;
  }

  return players.find((player) => {
    const aliases = [player.name, ...player.nickname.split(/[|,/]/)].map((alias) => alias.trim().toLowerCase());
    return aliases.includes(clean) || aliases.includes(normalized);
  });
}

function addPlayerAlias(player: Player, alias: string) {
  const cleanAlias = alias.trim();
  if (!cleanAlias) return player;
  const aliases = player.nickname.split(/[|,/]/).map((item) => item.trim()).filter(Boolean);
  if (aliases.some((item) => item.toLocaleLowerCase("es-CL") === cleanAlias.toLocaleLowerCase("es-CL"))) return player;
  return { ...player, nickname: [...aliases, cleanAlias].join(", "), updatedAt: new Date().toISOString() };
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d]/g, "");
}

function whatsappHref(phone: string, text?: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  const withCountry = normalized.startsWith("56") ? normalized : `56${normalized}`;
  return text ? `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}` : `https://wa.me/${withCountry}`;
}

function googleMapsHref(location: string) {
  if (!location.trim()) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function teamLabel(team: Team) {
  if (team === "A") return "Rojo";
  if (team === "B") return "Amarillo";
  return "Sin equipo";
}

function matchStatusLabel(status: string) {
  return { open: "Abierto", confirmed: "Confirmado", played: "Jugado", closed: "Cerrado" }[status] ?? status;
}

function playerForMatchRow(row: Pick<MatchPlayer, "playerId" | "name">, players: Player[]) {
  return players.find((player) => player.id === row.playerId) ?? findKnownPlayer(players, row.name);
}

function matchRowBelongsToPlayer(row: Pick<MatchPlayer, "playerId" | "name">, player: Player, players: Player[]) {
  return row.playerId === player.id || playerForMatchRow(row, players)?.id === player.id;
}

function isMonthlyMatchRow(row: MatchPlayer, players: Player[], monthKey: string, monthlyPayments: MonthlyPayment[]) {
  const player = playerForMatchRow(row, players);
  if (row.note.toLowerCase().includes("mensualidad")) return true;
  if (!player) return false;
  return isPlayerMonthlyForMonth(player.id, monthKey, players, monthlyPayments);
}

function buildPlayerStandings(data: SifupData) {
  const ranked = data.players
    .map((player) => {
      const appearances = data.matchPlayers.filter((row) => matchRowBelongsToPlayer(row, player, data.players) && row.attendanceStatus === "confirmed");
      const record = calculateRankingRecord(appearances, data.matches, data.results, data.matchTeams);
      return {
        id: player.id,
        name: player.name,
        ...record,
      };
    })
    .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played);

  return new Map(ranked.flatMap((row, index) => {
    const standing = { rank: index + 1, points: row.points, played: row.played, wins: row.wins, draws: row.draws, losses: row.losses };
    return [[row.id, standing], [row.name.toLowerCase(), standing]] as const;
  }));
}

function computePlayerStats(player: Player, data: SifupData) {
  const appearances = data.matchPlayers.filter((row) => matchRowBelongsToPlayer(row, player, data.players) && row.attendanceStatus === "confirmed");
  const record = calculateRankingRecord(appearances, data.matches, data.results, data.matchTeams);
  const matchDebt = appearances.reduce((sum, row) => sum + Math.max(row.amountDue - row.amountPaid, 0), 0);
  const monthlyDebt = data.monthlyPayments.filter((payment) => payment.playerId === player.id).reduce((sum, payment) => sum + Math.max(payment.expectedAmount - payment.amountPaid, 0), 0);
  return {
    appearances,
    ...record,
    pendingDebt: matchDebt + monthlyDebt,
  };
}

function standingForMatchRow(row: Pick<MatchPlayer, "playerId" | "name">, players: Player[], standings: Map<string, PlayerStanding>) {
  const player = playerForMatchRow(row, players);
  return standings.get(player?.id ?? "") ?? standings.get(row.name.toLowerCase());
}

function rowOrder(row: Pick<MatchPlayer, "whatsappOrder"> & Partial<Pick<MatchPlayer, "id">>, index: number) {
  if (row.whatsappOrder || row.id) return whatsappOrderFor(row as MatchPlayer);
  return index + 1;
}

function suggestedTeamForRank(pairIndex: number, positionInPair: number): Team {
  if (positionInPair > 1) return "none";
  const invertedPair = pairIndex % 2 === 1;
  if (!invertedPair) return positionInPair === 0 ? "A" : "B";
  return positionInPair === 0 ? "B" : "A";
}

function buildRankedTeamRows<T extends TeamAssignableRow>(rows: T[], players: Player[], standings: Map<string, PlayerStanding>) {
  const isGoalkeeper = (r: T) => {
    return playerForMatchRow(r, players)?.isGoalkeeper === true;
  };

  const mapped = rows
    .map((row, index) => ({
      row,
      index,
      standing: standingForMatchRow(row, players, standings),
    }))
    .filter((item) => item.row.attendanceStatus === "confirmed");

  // Separar arqueros de jugadores de campo
  const goalkeepers = mapped.filter((item) => isGoalkeeper(item.row));
  const fieldPlayers = mapped.filter((item) => !isGoalkeeper(item.row));

  const sortByRank = (a: typeof mapped[0], b: typeof mapped[0]) => {
    const rankA = a.standing?.rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.standing?.rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const pointsA = a.standing?.points ?? -1;
    const pointsB = b.standing?.points ?? -1;
    if (pointsA !== pointsB) return pointsB - pointsA;
    return rowOrder(a.row, a.index) - rowOrder(b.row, b.index) || a.row.name.localeCompare(b.row.name);
  };

  goalkeepers.sort(sortByRank);
  fieldPlayers.sort(sortByRank);

  // Asignar jugadores de campo de manera balanceada
  const rankedFieldPlayers = fieldPlayers.map((item, index): RankedTeamRow<T> => ({
    ...item,
    suggestedTeam: suggestedTeamForRank(Math.floor(index / 2), index % 2),
  }));

  // Calcular puntos de campo para determinar el equipo más débil
  const pointsA = rankedFieldPlayers
    .filter((item) => item.suggestedTeam === "A")
    .reduce((sum, item) => sum + (item.standing?.points ?? 0), 0);
  const pointsB = rankedFieldPlayers
    .filter((item) => item.suggestedTeam === "B")
    .reduce((sum, item) => sum + (item.standing?.points ?? 0), 0);

  const weakerTeam = pointsA <= pointsB ? "A" : "B";
  const strongerTeam = weakerTeam === "A" ? "B" : "A";

  // Asignar arqueros: el arquero más fuerte (primer elemento) va al equipo más débil
  const rankedGoalkeepers = goalkeepers.map((item, index): RankedTeamRow<T> => {
    let suggestedTeam: Team = "none";
    if (index === 0) {
      suggestedTeam = weakerTeam;
    } else if (index === 1) {
      suggestedTeam = strongerTeam;
    } else {
      suggestedTeam = index % 2 === 0 ? weakerTeam : strongerTeam;
    }
    return {
      ...item,
      suggestedTeam,
    };
  });

  return [...rankedGoalkeepers, ...rankedFieldPlayers];
}

function applyBalancedTeams<T extends TeamAssignableRow>(rows: T[], players: Player[], standings: Map<string, PlayerStanding>) {
  const assignments = new Map<number, Team>();
  buildRankedTeamRows(rows, players, standings).forEach((item) => {
    assignments.set(item.index, item.suggestedTeam);
  });
  return rows.map((row, index) => ({
    ...row,
    team: row.attendanceStatus === "confirmed" ? assignments.get(index) ?? "none" : "none",
  }));
}

type RoyalAssignableRow = Pick<MatchPlayer, "attendanceStatus" | "name" | "playerId" | "whatsappOrder" | "team" | "teamId">;
type RankedRoyalTeamRow<T extends RoyalAssignableRow> = {
  row: T;
  index: number;
  standing?: PlayerStanding;
  suggestedTeamIndex: 0 | 1 | 2;
};

function suggestedRoyalTeamIndex(groupIndex: number, positionInGroup: number): 0 | 1 | 2 {
  const order = groupIndex % 2 === 1 ? [2, 1, 0] : [0, 1, 2];
  return order[positionInGroup] as 0 | 1 | 2;
}

function buildRankedRoyalTeamRows<T extends RoyalAssignableRow>(rows: T[], players: Player[], standings: Map<string, PlayerStanding>) {
  const isGoalkeeper = (r: T) => playerForMatchRow(r, players)?.isGoalkeeper === true;

  const mapped = rows
    .map((row, index) => ({
      row,
      index,
      standing: standingForMatchRow(row, players, standings),
    }))
    .filter((item) => item.row.attendanceStatus === "confirmed");

  const goalkeepers = mapped.filter((item) => isGoalkeeper(item.row));
  const fieldPlayers = mapped.filter((item) => !isGoalkeeper(item.row));

  const sortByRank = (a: typeof mapped[0], b: typeof mapped[0]) => {
    const rankA = a.standing?.rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.standing?.rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const pointsA = a.standing?.points ?? -1;
    const pointsB = b.standing?.points ?? -1;
    if (pointsA !== pointsB) return pointsB - pointsA;
    return rowOrder(a.row, a.index) - rowOrder(b.row, b.index) || a.row.name.localeCompare(b.row.name);
  };

  goalkeepers.sort(sortByRank);
  fieldPlayers.sort(sortByRank);

  // Reparto serpentina en grupos de 3: jugador 1->equipo0, 2->equipo1, 3->equipo2, 4->equipo2, 5->equipo1, 6->equipo0...
  const rankedFieldPlayers = fieldPlayers.map((item, index): RankedRoyalTeamRow<T> => ({
    ...item,
    suggestedTeamIndex: suggestedRoyalTeamIndex(Math.floor(index / 3), index % 3),
  }));

  const pointsByTeam: [number, number, number] = [0, 1, 2].map((teamIndex) =>
    rankedFieldPlayers
      .filter((item) => item.suggestedTeamIndex === teamIndex)
      .reduce((sum, item) => sum + (item.standing?.points ?? 0), 0),
  ) as [number, number, number];

  // Arqueros: se reparten priorizando reforzar siempre al equipo con menos puntos acumulados
  const rankedGoalkeepers = goalkeepers.map((item): RankedRoyalTeamRow<T> => {
    const order = ([0, 1, 2] as const).slice().sort((a, b) => pointsByTeam[a] - pointsByTeam[b]);
    const suggestedTeamIndex = order[0];
    pointsByTeam[suggestedTeamIndex] += item.standing?.points ?? 0;
    return { ...item, suggestedTeamIndex };
  });

  return [...rankedGoalkeepers, ...rankedFieldPlayers];
}

function applyBalancedRoyalTeams<T extends RoyalAssignableRow>(rows: T[], players: Player[], standings: Map<string, PlayerStanding>, teamIds: [string, string, string]): T[] {
  const assignments = new Map<number, string>();
  buildRankedRoyalTeamRows(rows, players, standings).forEach((item) => {
    assignments.set(item.index, teamIds[item.suggestedTeamIndex]);
  });
  return rows.map((row, index) => ({
    ...row,
    team: "none",
    teamId: row.attendanceStatus === "confirmed" ? assignments.get(index) : undefined,
  }));
}

function pendingForMatchRow(row: MatchPlayer) {
  return Math.max(row.amountDue - row.amountPaid, 0);
}

function sortRowsWithMonthlyLast(rows: MatchPlayer[], players: Player[], monthKey: string, monthlyPayments: MonthlyPayment[]) {
  return [...rows].sort((a, b) => {
    const monthlyA = isMonthlyMatchRow(a, players, monthKey, monthlyPayments) ? 1 : 0;
    const monthlyB = isMonthlyMatchRow(b, players, monthKey, monthlyPayments) ? 1 : 0;
    if (monthlyA !== monthlyB) return monthlyA - monthlyB;
    return whatsappOrderFor(a) - whatsappOrderFor(b) || a.name.localeCompare(b.name);
  });
}

export function PageTitle({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-black uppercase tracking-tight text-white">{title}</h1>
        {description ? <p className="mt-1 text-sm leading-6 text-(--muted)">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel p-4 ${className}`}>{children}</section>;
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  className = "",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void | Promise<void>;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  disabled?: boolean;
}) {
  const variants = {
    primary: "bg-(--green) text-(--bg-deep) hover:bg-(--green-dark) hover:text-white border-(--green)",
    secondary: "bg-white/[0.06] text-white hover:bg-white/[0.12] border-(--border)",
    danger: "bg-(--red) text-white hover:bg-red-600 border-(--red)",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function CtaLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--green) bg-(--green) px-3 text-sm font-bold text-(--bg-deep) transition hover:bg-(--green-dark) hover:text-white"
    >
      {children}
    </Link>
  );
}

function AdminOnlyNotice({ label = "Solo admin puede editar esta vista." }: { label?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-(--lime)/30 bg-(--lime)/10 px-3 py-2 text-sm text-(--lime)">
      <Shield size={16} />
      {label}
    </div>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const styles = {
    paid: "bg-(--green)/15 text-(--green) ring-(--green)/30",
    unpaid: "bg-(--red)/15 text-(--red) ring-(--red)/30",
    promised: "bg-(--gold)/15 text-(--gold) ring-(--gold)/30",
  };
  return <span className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${styles[status]}`}>{PAYMENT_STATUS_LABEL[status]}</span>;
}

function StatusBadge({ value }: { value: string }) {
  return <span className="rounded-full bg-white/[0.08] px-2 py-1 text-xs font-bold text-white ring-1 ring-(--border)">{value}</span>;
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </Card>
  );
}

function PaymentAccountCard({ data }: { data: SifupData }) {
  const finance = data.clubFinance;
  return (
    <Card className="space-y-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-(--muted)">Transferencias</p>
        <h2 className="mt-1 text-lg font-black text-white">{finance.bank}</h2>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-(--muted)">Cuenta</dt><dd className="font-bold text-white">{finance.account}</dd></div>
        <div><dt className="text-(--muted)">Mail</dt><dd className="font-bold text-white">{finance.email}</dd></div>
        <div><dt className="text-(--muted)">RUT</dt><dd className="font-bold text-white">{finance.rut}</dd></div>
        <div><dt className="text-(--muted)">Cancha</dt><dd className="font-bold text-white">{formatCurrency(finance.courtCost)}</dd></div>
      </dl>
      <p className="rounded-md bg-(--green)/15 px-3 py-2 text-sm font-bold text-(--green)">
        {finance.prepaidCourts} canchas pagadas: {formatCurrency(finance.prepaidTotal)}.
      </p>
    </Card>
  );
}

function CopyBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-white">{title}</h3>
        <Button variant="secondary" onClick={copy}>
          <Clipboard size={16} />
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-(--bg-deep) p-3 text-xs leading-5 text-(--muted)">{text}</pre>
    </Card>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="panel w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl sm:rounded-2xl"
        style={{ maxHeight: "calc(90dvh - env(safe-area-inset-bottom, 0px))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 mb-3 flex items-center justify-between gap-3 bg-(--panel) px-4 pt-4">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-(--muted) hover:bg-white/[0.08] hover:text-white" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="px-4">
          {children}
        </div>
      </div>
    </div>
  );
}

const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function totalPayments(payments: MonthlyPayment[], rows: MatchPlayer[]) {
  return payments.reduce((sum, payment) => sum + payment.amountPaid, 0) + rows.reduce((sum, row) => sum + row.amountPaid, 0);
}

function pendingPayments(payments: MonthlyPayment[], rows: MatchPlayer[]) {
  return payments.reduce((sum, payment) => sum + Math.max(payment.expectedAmount - payment.amountPaid, 0), 0) + rows.reduce((sum, row) => sum + Math.max(row.amountDue - row.amountPaid, 0), 0);
}

type MonthlyFinanceRow = {
  key: string;
  galletas: number;
  mensual: number;
  gastosCancha: number;
  otrosGastos: number;
  running: number;
};

function monthlyFinanceSummary(year: number, data: SifupData): MonthlyFinanceRow[] {
  const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
  let running = 0;
  return months.map((mm) => {
    const key = `${year}-${mm}`;
    const galletas = data.matches
      .filter((match) => match.monthKey === key)
      .reduce((sum, match) => sum + data.matchPlayers.filter((row) => row.matchId === match.id).reduce((rowSum, row) => rowSum + row.amountPaid, 0), 0);
    const mensual = data.monthlyPayments.filter((payment) => payment.monthKey === key).reduce((sum, payment) => sum + payment.amountPaid, 0);
    const gastosCancha = data.clubExpenses.filter((expense) => expense.category === "court" && expense.expenseDate.slice(0, 7) === key).reduce((sum, expense) => sum + expense.amount, 0);
    const otrosGastos = data.clubExpenses.filter((expense) => expense.category !== "court" && expense.expenseDate.slice(0, 7) === key).reduce((sum, expense) => sum + expense.amount, 0);
    running += galletas + mensual - gastosCancha - otrosGastos;
    return { key, galletas, mensual, gastosCancha, otrosGastos, running };
  });
}

function nextWeekDates(latestDate: string, count: number) {
  const base = new Date(`${latestDate}T12:00:00`);
  const dates: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const next = new Date(base);
    next.setDate(next.getDate() + i * 7);
    dates.push(next.toISOString().slice(0, 10));
  }
  return dates;
}

export function DashboardPage({ initialData }: InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data } = useSifupData(initialData);
  const match = nextMatch(data.matches);
  const rows = data.matchPlayers.filter((row) => row.matchId === match?.id);
  const summary = summarizeMatch(rows);

  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden="true"></div>
        <div className="hero-copy">
          <div className="label-row">
            <span>SIFUP</span>
            <strong>Resumen del proximo partido</strong>
          </div>
          <h1>Inicio</h1>
          <p>Vision general del proximo partido, jugadores confirmados y estado de cobranza.</p>
        </div>
        <div className="hero-metrics" aria-label="Vision general">
          <article className="metric cyan">
            <span>Confirmados</span>
            <strong>{summary.confirmedCount}</strong>
          </article>
          <article className="metric lime">
            <span>Pagados</span>
            <strong>{summary.paidCount}</strong>
          </article>
          <article className="metric pink">
            <span>Pendiente</span>
            <strong>{formatCurrency(summary.pendingAmount)}</strong>
          </article>
          <article className="metric gold">
            <span>Recaudado</span>
            <strong>{formatCurrency(summary.totalCollected)}</strong>
          </article>
        </div>
      </section>
      <div className="mt-5 flex items-center justify-end">
        {isAdmin ? <CtaLink href="/matches/new"><Plus size={16} />Nuevo partido</CtaLink> : null}
      </div>
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: entra como admin para crear partidos y editar pagos." /> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{match?.weekLabel || match?.date} - {match?.time}</h2>
              <p className="mt-1 text-sm text-(--muted)">{match?.location}</p>
            </div>
            {match ? <StatusBadge value={matchStatusLabel(match.status)} /> : null}
          </div>
          <div className="mt-4 divide-y divide-white/10">
            {rows.slice(0, 8).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium">{row.name}</span>
                <PaymentBadge status={row.paymentStatus} />
              </div>
            ))}
          </div>
        </Card>
        {match ? <CopyBlock title="Resumen del partido" text={matchSummaryMessage(match, rows, data.players, data.monthlyPayments)} /> : null}
      </div>
      <div className="mt-4"><PaymentAccountCard data={data} /></div>
    </>
  );
}

export function MatchesPage({ initialData }: InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function createUpcomingMatches() {
    const latest = [...data.matches].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) return;
    const dates = nextWeekDates(latest.date, 2).filter((date) => !data.matches.some((match) => match.date === date));
    if (dates.length === 0) return;
    startTransition(async () => {
      try {
        let next = data;
        for (const date of dates) {
          const now = new Date().toISOString();
          const match: Match = {
            id: newMatchId(date, next.matches.map((item) => item.id)),
            date,
            time: latest.time,
            location: latest.location,
            status: "confirmed",
            totalCost: latest.totalCost,
            weekLabel: weekLabel(date),
            monthKey: monthKey(date),
            courtCost: latest.courtCost,
            courtPrepaid: true,
            notes: "",
            matchFormat: "clasico",
            createdAt: now,
            updatedAt: now,
          };
          await createMatchAction(match, []);
          next = upsertMatch(next, match);
        }
        commit(next);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudieron crear los proximos partidos.");
      }
    });
  }

  return (
    <>
      <PageTitle
        title="Partidos"
        description="Martes registrados por semana, pagos y asistencia."
        action={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={createUpcomingMatches} disabled={isPending}>
                <CalendarPlus size={16} />
                Crear proximas 2 fechas
              </Button>
              <CtaLink href="/matches/new"><Plus size={16} />Nuevo partido</CtaLink>
            </div>
          ) : undefined
        }
      />
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      <div className="space-y-3">
        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          const nextId = [...data.matches]
            .filter((match) => match.date >= today && match.status !== "played" && match.status !== "closed")
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0]?.id;
          const sortedMatches = [...data.matches].sort((a, b) => b.date.localeCompare(a.date));
          return sortedMatches.map((match) => {
            const rows = data.matchPlayers.filter((row) => row.matchId === match.id);
            const summary = summarizeMatch(rows);
            const isNext = match.id === nextId;
            const isCompactConfirmed = match.status === "confirmed" && !isNext;
            const result = data.results.find((r) => r.matchId === match.id);
            const winners = result && result.winner !== "draw"
              ? data.matchPlayers.filter((mp) => mp.matchId === match.id && mp.team === result.winner && mp.attendanceStatus === "confirmed")
              : [];

            return (
              <Link key={match.id} href={`/matches/${match.id}`} className="block">
                <Card
                  className={`transition ${
                    result
                      ? "played-match-card"
                      : isNext
                      ? "next-match-card ring-2 ring-(--lime)/20"
                      : "upcoming-match-card"
                  }`}
                >
                  {result ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-(--gold)">
                            <Trophy size={16} aria-hidden="true" />
                            <p className="text-xs font-black uppercase tracking-wide">Partido finalizado</p>
                          </div>
                          <h2 className="mt-1 text-lg font-black text-white">
                            {result.winner === "draw" ? "Empate" : `Ganó el equipo ${teamLabel(result.winner)}`}
                          </h2>
                          <p className="mt-1 text-sm font-medium text-(--muted)">
                            {match.date}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <StatusBadge value={matchStatusLabel(match.status)} />
                        </div>
                      </div>
                      {winners.length > 0 ? (
                        <div className="rounded-lg border border-(--gold)/45 bg-(--gold)/12 p-3">
                          <p className="mb-2 text-xs font-black uppercase tracking-wide text-(--gold)">Jugadores ganadores</p>
                          <div className="flex flex-wrap gap-2">
                          {winners.map((w) => (
                            <span key={w.id} className="inline-flex items-center rounded-md bg-(--gold) px-3 py-1.5 text-sm font-black text-(--bg-deep)">
                              {w.name}
                            </span>
                          ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : isCompactConfirmed ? (
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="min-w-0 truncate text-base font-medium text-white">{match.weekLabel || match.date}</h2>
                      <StatusBadge value={matchStatusLabel(match.status)} />
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-white">{match.weekLabel || match.date}</h2>
                            {isNext ? <span className="rounded-full bg-(--lime) px-2 py-1 text-xs font-bold text-(--bg-deep)">Proximo partido</span> : null}
                          </div>
                          <p className="mt-1 text-sm font-medium text-(--muted)">{match.date} - {match.time}</p>
                          <p className="mt-1 text-sm text-(--muted)">{match.location}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <StatusBadge value={matchStatusLabel(match.status)} />
                        </div>
                      </div>
                      <div className="mt-3 text-sm font-bold text-(--muted)">
                        <span>{summary.confirmedCount}/{SQUAD_TARGET} jugadores</span>
                      </div>
                    </div>
                  )}
                </Card>
              </Link>
            );
          });
        })()}
      </div>
    </>
  );
}

function NewMatchTeamSuggestion<T extends TeamAssignableRow>({ rows, players, standings }: { rows: T[]; players: Player[]; standings: Map<string, PlayerStanding> }) {
  const rankedRows = buildRankedTeamRows(rows, players, standings);
  const teamA = rankedRows.filter((item) => item.suggestedTeam === "A");
  const teamB = rankedRows.filter((item) => item.suggestedTeam === "B");
  const pointsA = teamA.reduce((sum, item) => sum + (item.standing?.points ?? 0), 0);
  const pointsB = teamB.reduce((sum, item) => sum + (item.standing?.points ?? 0), 0);
  const pairs = Array.from({ length: Math.ceil(rankedRows.length / 2) }, (_, index) => rankedRows.slice(index * 2, index * 2 + 2));

  if (rankedRows.length === 0) {
    return (
      <div className="rounded-md border border-(--border) bg-white/[0.04] p-3">
        <p className="text-sm font-semibold text-white">Sin jugadores confirmados para sugerir equipos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-(--border) bg-white/[0.04] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-white">Sugerencia automatica por ranking</p>
          <p className="mt-1 text-xs text-(--muted)">El #1 enfrenta al #2, el #3 al #4, y asi sigue. Los colores se alternan por pareja para equilibrar puntos.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-xs font-black uppercase">
          <span className="rounded-md border border-(--red)/35 bg-(--red)/10 px-3 py-2 text-(--red)">Rojo {teamA.length} - {pointsA} pts</span>
          <span className="rounded-md border border-(--gold)/40 bg-(--gold)/10 px-3 py-2 text-(--gold)">Amarillo {teamB.length} - {pointsB} pts</span>
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {pairs.map((pair, pairIndex) => (
          <div key={pairIndex} className="grid gap-2 rounded-md border border-white/10 bg-black/10 p-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            {pair.map((item) => {
              const isArq = playerForMatchRow(item.row, players)?.isGoalkeeper === true;
              return (
                <div key={`${item.index}-${item.row.name}`} className={`rounded-md border px-3 py-2 ${item.suggestedTeam === "A" ? "border-(--red)/35 bg-(--red)/10" : "border-(--gold)/40 bg-(--gold)/10"}`}>
                  <p className="text-xs font-black uppercase tracking-wide text-(--muted)">#{item.standing?.rank ?? "SR"} - {teamLabel(item.suggestedTeam)}</p>
                  <p className="truncate font-semibold text-white">
                    {item.row.name}
                    {isArq ? (
                      <span className="ml-1 inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-500 uppercase tracking-wider gap-0.5" title="Arquero">
                        🧤 ARQ
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs font-semibold text-(--gold)">{item.standing?.points ?? 0} pts</p>
                </div>
              );
            })}
            {pair.length === 2 ? <span className="hidden rounded-full bg-white/[0.1] px-2 py-1 text-center text-[10px] font-black text-(--muted) sm:block">VS</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

type RoyalTeamDraft = { id: string; name: string; color: MatchTeamColor };

function NewMatchRoyalTeamSuggestion<T extends RoyalAssignableRow>({
  rows,
  players,
  standings,
  teams,
  onRenameTeam,
  onRecolorTeam,
}: {
  rows: T[];
  players: Player[];
  standings: Map<string, PlayerStanding>;
  teams: [RoyalTeamDraft, RoyalTeamDraft, RoyalTeamDraft];
  onRenameTeam: (index: 0 | 1 | 2, name: string) => void;
  onRecolorTeam: (index: 0 | 1 | 2, color: MatchTeamColor) => void;
}) {
  const teamIds = teams.map((team) => team.id) as [string, string, string];
  const rankedRows = buildRankedRoyalTeamRows(rows, players, standings);

  if (rankedRows.length === 0) {
    return (
      <div className="rounded-md border border-(--border) bg-white/[0.04] p-3">
        <p className="text-sm font-semibold text-white">Sin jugadores confirmados para sugerir equipos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-(--border) bg-white/[0.04] p-3">
      <div>
        <p className="text-sm font-black uppercase tracking-wide text-white">Sugerencia automatica · 3 equipos</p>
        <p className="mt-1 text-xs text-(--muted)">Reparto serpentina por ranking en grupos de 3. Los arqueros refuerzan siempre al equipo con menos puntos.</p>
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {teamIds.map((teamId, teamIndex) => {
          const teamRows = rankedRows.filter((item) => teamId === teamIds[item.suggestedTeamIndex]);
          const points = teamRows.reduce((sum, item) => sum + (item.standing?.points ?? 0), 0);
          const colorClasses = MATCH_TEAM_COLOR_CLASSES[teams[teamIndex].color];
          return (
            <div key={teamId} className={`space-y-2 rounded-md border p-2 ${colorClasses.border} ${colorClasses.bg}`}>
              <div className="flex items-center gap-2">
                <input
                  value={teams[teamIndex].name}
                  onChange={(event) => onRenameTeam(teamIndex as 0 | 1 | 2, event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs font-black uppercase tracking-wide text-white outline-none"
                />
                <select
                  value={teams[teamIndex].color}
                  onChange={(event) => onRecolorTeam(teamIndex as 0 | 1 | 2, event.target.value as MatchTeamColor)}
                  className="rounded-md border border-white/10 bg-black/20 px-1 py-1 text-[10px] font-bold text-white outline-none"
                >
                  {(Object.keys(MATCH_TEAM_COLOR_LABEL) as MatchTeamColor[]).map((color) => (
                    <option key={color} value={color}>{MATCH_TEAM_COLOR_LABEL[color]}</option>
                  ))}
                </select>
              </div>
              <p className={`text-xs font-black uppercase ${colorClasses.text}`}>{teamRows.length} jug · {points} pts</p>
              <div className="space-y-1">
                {teamRows.map((item) => {
                  const isArq = playerForMatchRow(item.row, players)?.isGoalkeeper === true;
                  return (
                    <div key={`${item.index}-${item.row.name}`} className="rounded border border-white/10 bg-black/10 px-2 py-1">
                      <p className="truncate text-xs font-semibold text-white">
                        #{item.standing?.rank ?? "SR"} {item.row.name}
                        {isArq ? <span className="ml-1 text-[8px] font-black text-amber-500 uppercase">ARQ</span> : null}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NewMatchPage({ initialData }: InitialDataProps) {
  const router = useRouter();
  const { data, commit } = useSifupData(initialData);
  const [isPending, startTransition] = useTransition();
  const [raw, setRaw] = useState(sampleInput);
  const [match, setMatch] = useState({ date: "", time: "21:00", location: "", totalCost: COURT_COST, notes: "" });
  const [rows, setRows] = useState<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [matchFormat, setMatchFormat] = useState<MatchFormat>("clasico");
  const [royalTeams, setRoyalTeams] = useState<[RoyalTeamDraft, RoyalTeamDraft, RoyalTeamDraft]>(
    () => [0, 1, 2].map((index) => ({ id: newId("team"), name: `Equipo ${index + 1}`, color: MATCH_TEAM_DEFAULT_COLORS[index] })) as [RoyalTeamDraft, RoyalTeamDraft, RoyalTeamDraft],
  );
  const standings = useMemo(() => buildPlayerStandings(data), [data]);
  const royalTeamIds = useMemo(() => royalTeams.map((team) => team.id) as [string, string, string], [royalTeams]);

  function balanceRows<T extends RoyalAssignableRow & TeamAssignableRow>(source: T[]): T[] {
    return matchFormat === "rey_de_la_cancha"
      ? applyBalancedRoyalTeams(source, data.players, standings, royalTeamIds)
      : applyBalancedTeams(source, data.players, standings);
  }

  function parse() {
    const parsed = parseWhatsAppList(raw, PER_MATCH_AMOUNT);
    setMatch({ ...parsed.match, totalCost: COURT_COST });
    setRows(balanceRows(parsed.players));
    setErrors(parsed.errors);
  }

  function updateRow(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((current) => {
      const nextRows = current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
      return balanceRows(nextRows);
    });
  }

  function renameRoyalTeam(index: 0 | 1 | 2, name: string) {
    setRoyalTeams((current) => current.map((team, teamIndex) => (teamIndex === index ? { ...team, name } : team)) as [RoyalTeamDraft, RoyalTeamDraft, RoyalTeamDraft]);
  }

  function recolorRoyalTeam(index: 0 | 1 | 2, color: MatchTeamColor) {
    setRoyalTeams((current) => current.map((team, teamIndex) => (teamIndex === index ? { ...team, color } : team)) as [RoyalTeamDraft, RoyalTeamDraft, RoyalTeamDraft]);
  }

  function save() {
    if (!match.date || !match.time || rows.length === 0) {
      setErrors(["Completa fecha, hora y al menos un jugador antes de guardar."]);
      return;
    }
    const now = new Date().toISOString();
    const matchId = newMatchId(match.date, data.matches.map((item) => item.id));
    const nextMatch: Match = {
      id: matchId,
      date: match.date,
      time: match.time,
      location: match.location || "Por definir",
      status: "open",
      totalCost: Number(match.totalCost) || COURT_COST,
      weekLabel: weekLabel(match.date),
      monthKey: monthKey(match.date),
      courtCost: COURT_COST,
      courtPrepaid: true,
      notes: match.notes,
      matchFormat,
      createdAt: now,
      updatedAt: now,
    };
    const balancedRows = balanceRows(rows);
    const nextRows: MatchPlayer[] = balancedRows.map((row) => {
      const player = findKnownPlayer(data.players, row.name);
      const monthly = player ? isPlayerMonthlyForMonth(player.id, nextMatch.monthKey, data.players, data.monthlyPayments) : false;
      return {
        ...row,
        id: newId("mp"),
        matchId,
        playerId: player?.id,
        paymentStatus: monthly ? "paid" : row.paymentStatus,
        amountDue: monthly ? 0 : row.amountDue,
        amountPaid: monthly ? 0 : row.amountPaid,
        note: monthly && !row.note ? "mensualidad" : row.note,
        createdAt: now,
        updatedAt: now,
      };
    });
    const nextTeams: MatchTeam[] | undefined = matchFormat === "rey_de_la_cancha"
      ? royalTeams.map((team, index) => ({
          id: team.id,
          matchId,
          name: team.name,
          color: team.color,
          seq: index + 1,
          createdAt: now,
          updatedAt: now,
        }))
      : undefined;
    startTransition(async () => {
      try {
        await createMatchAction(nextMatch, nextRows, nextTeams);
        commit({
          ...replaceMatchPlayers(upsertMatch(data, nextMatch), matchId, nextRows),
          matchTeams: nextTeams ? [...data.matchTeams, ...nextTeams] : data.matchTeams,
        });
        router.push(`/matches/${matchId}`);
      } catch (error) {
        setErrors([error instanceof Error ? error.message : "No se pudo guardar el partido."]);
      }
    });
  }

  return (
    <>
      <PageTitle title="Nuevo partido" description="Pega la lista WhatsApp, revisa la tabla editable y guarda en la base." />
      <div className="mb-4 inline-flex rounded-md border border-(--border) bg-white/[0.04] p-1 text-sm font-bold">
        <button
          type="button"
          onClick={() => setMatchFormat("clasico")}
          className={`rounded px-3 py-1.5 transition ${matchFormat === "clasico" ? "bg-(--green) text-black" : "text-(--muted) hover:text-white"}`}
        >
          Clasico (2 equipos)
        </button>
        <button
          type="button"
          onClick={() => setMatchFormat("rey_de_la_cancha")}
          className={`rounded px-3 py-1.5 transition ${matchFormat === "rey_de_la_cancha" ? "bg-(--green) text-black" : "text-(--muted) hover:text-white"}`}
        >
          Rey de la Cancha (3 equipos)
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="space-y-3">
          <textarea
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            className="min-h-72 w-full rounded-md border border-(--border) bg-(--panel-strong) p-3 text-sm text-white outline-none focus:border-(--green) focus:ring-4 focus:ring-(--green)/20"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={parse}><WalletCards size={16} />Pegar lista WhatsApp</Button>
            <Button onClick={save} variant="secondary" disabled={isPending}><Save size={16} />Guardar partido</Button>
          </div>
          {errors.map((error) => <p key={error} className="rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p>)}
        </Card>
        <div className="space-y-4">
          {matchFormat === "rey_de_la_cancha" ? (
            <NewMatchRoyalTeamSuggestion rows={rows} players={data.players} standings={standings} teams={royalTeams} onRenameTeam={renameRoyalTeam} onRecolorTeam={recolorRoyalTeam} />
          ) : (
            <NewMatchTeamSuggestion rows={rows} players={data.players} standings={standings} />
          )}
          <MatchEditor match={match} setMatch={setMatch} rows={rows} updateRow={updateRow} knownLocations={data.matches.map((item) => item.location)} lastLocation={data.matches[0]?.location ?? ""} showTeamColumn={matchFormat === "clasico"} />
        </div>
      </div>
    </>
  );
}

export function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="space-y-1 text-sm font-medium text-(--muted)">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white outline-none focus:border-(--green) focus:ring-4 focus:ring-(--green)/20"
      />
    </label>
  );
}

function MatchEditor({
  match,
  setMatch,
  rows,
  updateRow,
  knownLocations,
  lastLocation,
  showTeamColumn = true,
}: {
  match: { date: string; time: string; location: string; totalCost: number; notes: string };
  setMatch: (value: { date: string; time: string; location: string; totalCost: number; notes: string }) => void;
  rows: Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[];
  updateRow: (index: number, patch: Partial<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">>) => void;
  knownLocations: string[];
  lastLocation: string;
  showTeamColumn?: boolean;
}) {
  const locations = Array.from(new Set(knownLocations.filter(Boolean)));
  return (
    <Card className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Fecha" type="date" value={match.date} onChange={(date) => setMatch({ ...match, date })} />
        <Input label="Hora" type="time" value={match.time} onChange={(time) => setMatch({ ...match, time })} />
        <div className="space-y-1 sm:col-span-2">
          <label className="space-y-1 text-sm font-medium text-(--muted)">
            <span>Ubicacion</span>
            <div className="flex flex-wrap gap-2">
              <input
                list="known-locations"
                value={match.location}
                onChange={(event) => setMatch({ ...match, location: event.target.value })}
                className="h-10 min-w-0 flex-1 rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white outline-none focus:border-(--green) focus:ring-4 focus:ring-(--green)/20"
              />
              <datalist id="known-locations">
                {locations.map((location) => <option key={location} value={location} />)}
              </datalist>
              {lastLocation ? (
                <Button variant="secondary" onClick={() => setMatch({ ...match, location: lastLocation })}>
                  Repetir semana pasada
                </Button>
              ) : null}
            </div>
          </label>
        </div>
        <Input label="Costo total" type="number" value={String(match.totalCost)} onChange={(totalCost) => setMatch({ ...match, totalCost: Number(totalCost) })} />
      </div>
      <EditableRows rows={rows} updateRow={updateRow} showTeamColumn={showTeamColumn} />
    </Card>
  );
}

function EditableRows({
  rows,
  updateRow,
  showTeamColumn = true,
}: {
  rows: Array<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt"> | MatchPlayer>;
  updateRow: (index: number, patch: Partial<MatchPlayer>) => void;
  showTeamColumn?: boolean;
}) {
  return (
    <>
      <div className="space-y-3 md:hidden">
        {rows.map((row, index) => (
          <div key={`${row.name}-${index}-card`} className="rounded-md border border-(--border) bg-white/[0.04] p-3">
            <div className="grid gap-3">
              <Input label="# WhatsApp" type="number" value={String(row.whatsappOrder || index + 1)} onChange={(value) => updateRow(index, { whatsappOrder: Number(value) })} />
              <Input label="Jugador" value={row.name} onChange={(value) => updateRow(index, { name: value })} />
              <label className="space-y-1 text-sm font-medium text-(--muted)">
                <span>Pago</span>
                <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={row.paymentStatus} onChange={(event) => updateRow(index, { paymentStatus: event.target.value as PaymentStatus })}>
                  <option value="paid">Pagado</option><option value="unpaid">No pagado</option><option value="promised">Prometido</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Debe" type="number" value={String(row.amountDue)} onChange={(value) => updateRow(index, { amountDue: Number(value) })} />
                <Input label="Pagado" type="number" value={String(row.amountPaid)} onChange={(value) => updateRow(index, { amountPaid: Number(value) })} />
              </div>
              {showTeamColumn ? (
                <label className="space-y-1 text-sm font-medium text-(--muted)">
                  <span>Equipo</span>
                  <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}>
                    <option value="none">Sin equipo</option><option value="A">Rojo</option><option value="B">Amarillo</option>
                  </select>
                </label>
              ) : null}
              <Input label="Nota" value={row.note} onChange={(value) => updateRow(index, { note: value })} />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="border-b border-(--border) text-xs uppercase text-(--muted)">
            <tr><th className="py-2 pr-2">#</th><th className="py-2 pr-2">Jugador</th><th className="py-2 pr-2">Pago</th><th className="py-2 pr-2">Debe</th><th className="py-2 pr-2">Pagado</th>{showTeamColumn ? <th className="py-2 pr-2">Equipo</th> : null}<th className="py-2 pr-2">Nota</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td className="py-2 pr-2"><input className="h-9 w-16 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" type="number" value={row.whatsappOrder || index + 1} onChange={(event) => updateRow(index, { whatsappOrder: Number(event.target.value) })} /></td>
                <td className="py-2 pr-2"><input className="h-9 w-44 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} /></td>
                <td className="py-2 pr-2"><select className="h-9 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.paymentStatus} onChange={(event) => updateRow(index, { paymentStatus: event.target.value as PaymentStatus })}><option value="paid">Pagado</option><option value="unpaid">No pagado</option><option value="promised">Prometido</option></select></td>
                <td className="py-2 pr-2"><input className="h-9 w-24 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" type="number" value={row.amountDue} onChange={(event) => updateRow(index, { amountDue: Number(event.target.value) })} /></td>
                <td className="py-2 pr-2"><input className="h-9 w-24 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" type="number" value={row.amountPaid} onChange={(event) => updateRow(index, { amountPaid: Number(event.target.value) })} /></td>
                {showTeamColumn ? <td className="py-2 pr-2"><select className="h-9 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}><option value="none">Sin equipo</option><option value="A">Rojo</option><option value="B">Amarillo</option></select></td> : null}
                <td className="py-2 pr-2"><input className="h-9 w-44 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.note} onChange={(event) => updateRow(index, { note: event.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type MatchPlayerSortKey = "order" | "name" | "rank" | "points" | "played" | "wins" | "draws" | "losses" | "team";
type FilterTab = "all" | "confirmed" | "unanswered" | "out";

type UnansweredPlayerItem = {
  player: Player;
  existingRow?: MatchPlayer;
  totalPlayed: number;
  standing?: PlayerStanding;
  isMonthly: boolean;
  priorityScore: number;
};

function UnifiedMatchRoster({
  rows,
  players,
  allMatchPlayers,
  standings,
  match,
  monthlyPayments,
  isAdmin,
  onOpenDetails,
  onMarkOut,
  onRejoin,
  onRemove,
  onAssociate,
  onAddPlayer,
  onQuickConfirmPlayer,
  onQuickMarkPlayerOut,
}: {
  rows: MatchPlayer[];
  players: Player[];
  allMatchPlayers: MatchPlayer[];
  standings: Map<string, PlayerStanding>;
  match: Match;
  monthlyPayments: MonthlyPayment[];
  isAdmin: boolean;
  onOpenDetails?: (rowId: string) => void;
  onMarkOut?: (rowId: string) => void;
  onRejoin?: (rowId: string) => void;
  onRemove?: (rowId: string) => void;
  onAssociate?: (rowId: string) => void;
  onAddPlayer?: () => void;
  onQuickConfirmPlayer?: (player: Player) => void;
  onQuickMarkPlayerOut?: (player: Player) => void;
}) {
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [showAllUnanswered, setShowAllUnanswered] = useState(false);
  const [sort, setSort] = useState<{ key: MatchPlayerSortKey; direction: "asc" | "desc" }>({ key: "order", direction: "asc" });

  const isRoyal = match.matchFormat === "rey_de_la_cancha";
  const squadTarget = isRoyal ? ROYAL_SQUAD_TARGET : SQUAD_TARGET;
  const teamsAssigned = hasTeamsAssigned(rows);

  const confirmedRows = useMemo(() => {
    return rows.filter((row) => row.attendanceStatus === "confirmed");
  }, [rows]);

  const confirmedOrderMap = useMemo(() => {
    const ordered = sortByWhatsappOrder(confirmedRows);
    const map = new Map<string, number>();
    ordered.forEach((row, idx) => {
      map.set(row.id, idx + 1);
    });
    return map;
  }, [confirmedRows]);

  const outRows = useMemo(() => {
    return sortRowsWithMonthlyLast(rows.filter((row) => row.attendanceStatus === "out"), players, match.monthKey, monthlyPayments);
  }, [rows, players, match.monthKey, monthlyPayments]);

  const unansweredItems = useMemo(() => {
    return players
      .filter((player) => {
        if (!player.active) return false;
        const row = rows.find((r) => matchRowBelongsToPlayer(r, player, players));
        if (row && (row.attendanceStatus === "confirmed" || row.attendanceStatus === "out")) {
          return false;
        }
        return true;
      })
      .map((player): UnansweredPlayerItem => {
        const existingRow = rows.find((r) => matchRowBelongsToPlayer(r, player, players));
        const totalPlayed = allMatchPlayers.filter((r) => matchRowBelongsToPlayer(r, player, players) && r.attendanceStatus === "confirmed").length;
        const standing = standingForMatchRow({ playerId: player.id, name: player.name }, players, standings);
        const isMonthly = isPlayerMonthlyForMonth(player.id, match.monthKey, players, monthlyPayments);
        const priorityScore = (isMonthly ? 100 : 0) + (totalPlayed * 10) + (standing?.points ?? 0);
        return {
          player,
          existingRow,
          totalPlayed,
          standing,
          isMonthly,
          priorityScore,
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore || b.totalPlayed - a.totalPlayed || a.player.name.localeCompare(b.player.name));
  }, [players, rows, allMatchPlayers, standings, match.monthKey, monthlyPayments]);

  const confirmedCount = confirmedRows.length;
  const missing = Math.max(squadTarget - confirmedCount, 0);

  const sortedConfirmed = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = confirmedRows.filter((r) => {
      if (!query) return true;
      const p = playerForMatchRow(r, players);
      return r.name.toLowerCase().includes(query) || (p?.nickname?.toLowerCase().includes(query) ?? false);
    });

    if (sort.key === "order") {
      return [...list].sort((a, b) => {
        const monthlyA = isMonthlyMatchRow(a, players, match.monthKey, monthlyPayments) ? 0 : 1;
        const monthlyB = isMonthlyMatchRow(b, players, match.monthKey, monthlyPayments) ? 0 : 1;
        if (monthlyA !== monthlyB) return (sort.direction === "asc" ? 1 : -1) * (monthlyA - monthlyB);
        const orderA = confirmedOrderMap.get(a.id) ?? 999;
        const orderB = confirmedOrderMap.get(b.id) ?? 999;
        return (sort.direction === "asc" ? 1 : -1) * (orderA - orderB || a.name.localeCompare(b.name));
      });
    }

    return [...list].sort((left, right) => {
      const leftPlayer = playerForMatchRow(left, players);
      const rightPlayer = playerForMatchRow(right, players);
      const leftStanding = standingForMatchRow(left, players, standings);
      const rightStanding = standingForMatchRow(right, players, standings);

      const value = (row: MatchPlayer, player: Player | undefined, standing: PlayerStanding | undefined) => {
        if (sort.key === "name") return player?.name ?? row.name;
        if (sort.key === "team") return row.team;
        if (sort.key === "rank") return standing?.rank ?? Number.POSITIVE_INFINITY;
        return standing?.[sort.key as "points" | "played" | "wins" | "draws" | "losses"] ?? -1;
      };

      const leftVal = value(left, leftPlayer, leftStanding);
      const rightVal = value(right, rightPlayer, rightStanding);
      const comparison = typeof leftVal === "string" && typeof rightVal === "string"
        ? leftVal.localeCompare(rightVal, "es")
        : Number(leftVal) - Number(rightVal);

      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
      return (leftStanding?.rank ?? Number.POSITIVE_INFINITY) - (rightStanding?.rank ?? Number.POSITIVE_INFINITY);
    });
  }, [confirmedRows, confirmedOrderMap, players, standings, sort, search, match.monthKey, monthlyPayments]);

  const sortedUnanswered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = unansweredItems.filter((item) => {
      if (!query) return true;
      return item.player.name.toLowerCase().includes(query) || (item.player.nickname?.toLowerCase().includes(query) ?? false);
    });

    if (sort.key === "order") {
      return [...list].sort((a, b) => (sort.direction === "asc" ? 1 : -1) * (b.priorityScore - a.priorityScore || b.totalPlayed - a.totalPlayed));
    }

    return [...list].sort((left, right) => {
      const value = (item: UnansweredPlayerItem) => {
        if (sort.key === "name") return item.player.name;
        if (sort.key === "team") return "";
        if (sort.key === "rank") return item.standing?.rank ?? Number.POSITIVE_INFINITY;
        if (sort.key === "played") return item.totalPlayed;
        return item.standing?.[sort.key as "points" | "wins" | "draws" | "losses"] ?? -1;
      };

      const leftVal = value(left);
      const rightVal = value(right);
      const comparison = typeof leftVal === "string" && typeof rightVal === "string"
        ? leftVal.localeCompare(rightVal, "es")
        : Number(leftVal) - Number(rightVal);

      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
      return right.priorityScore - left.priorityScore;
    });
  }, [unansweredItems, sort, search]);

  const visibleUnanswered = useMemo(() => {
    const hasQuery = Boolean(search.trim());
    if (tab === "unanswered" || showAllUnanswered || hasQuery) {
      return sortedUnanswered;
    }
    return sortedUnanswered.filter((item) => item.isMonthly || item.totalPlayed > 0);
  }, [sortedUnanswered, tab, showAllUnanswered, search]);

  const occasionalCount = sortedUnanswered.filter((item) => !item.isMonthly && item.totalPlayed === 0).length;

  const sortedOut = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = outRows.filter((r) => {
      if (!query) return true;
      const p = playerForMatchRow(r, players);
      return r.name.toLowerCase().includes(query) || (p?.nickname?.toLowerCase().includes(query) ?? false);
    });

    if (sort.key === "order") {
      return [...list].sort((a, b) => (sort.direction === "asc" ? 1 : -1) * (whatsappOrderFor(a) - whatsappOrderFor(b) || a.name.localeCompare(b.name)));
    }

    return [...list].sort((left, right) => {
      const leftPlayer = playerForMatchRow(left, players);
      const rightPlayer = playerForMatchRow(right, players);
      const leftStanding = standingForMatchRow(left, players, standings);
      const rightStanding = standingForMatchRow(right, players, standings);

      const value = (row: MatchPlayer, player: Player | undefined, standing: PlayerStanding | undefined) => {
        if (sort.key === "name") return player?.name ?? row.name;
        if (sort.key === "team") return "";
        if (sort.key === "rank") return standing?.rank ?? Number.POSITIVE_INFINITY;
        return standing?.[sort.key as "points" | "played" | "wins" | "draws" | "losses"] ?? -1;
      };

      const leftVal = value(left, leftPlayer, leftStanding);
      const rightVal = value(right, rightPlayer, rightStanding);
      const comparison = typeof leftVal === "string" && typeof rightVal === "string"
        ? leftVal.localeCompare(rightVal, "es")
        : Number(leftVal) - Number(rightVal);

      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
      return (leftStanding?.rank ?? Number.POSITIVE_INFINITY) - (rightStanding?.rank ?? Number.POSITIVE_INFINITY);
    });
  }, [outRows, players, standings, sort, search]);

  const toggleSort = (key: MatchPlayerSortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const tabs: { key: FilterTab; label: string; count: number; colorClass: string }[] = [
    { key: "all", label: "Todos", count: confirmedCount + unansweredItems.length + outRows.length, colorClass: "bg-white/10 text-white" },
    { key: "confirmed", label: "Confirmados", count: confirmedCount, colorClass: "bg-(--green)/20 text-(--green)" },
    { key: "unanswered", label: "Sin respuesta", count: unansweredItems.length, colorClass: "bg-amber-500/20 text-amber-300" },
    { key: "out", label: "No van", count: outRows.length, colorClass: "bg-(--red)/20 text-(--red)" },
  ];

  const columns: { key: MatchPlayerSortKey; label: string; className?: string; hideOnMobile?: boolean }[] = [
    { key: "order", label: "#", className: "w-12 text-center" },
    { key: "name", label: "Jugador", className: "text-left" },
    { key: "rank", label: "Ranking", className: "text-center" },
    { key: "points", label: "Pts", className: "text-center text-(--gold)" },
    { key: "played", label: "PJ", className: "text-center" },
    { key: "wins", label: "G", className: "text-center text-(--green)", hideOnMobile: true },
    { key: "draws", label: "E", className: "text-center text-(--muted)", hideOnMobile: true },
    { key: "losses", label: "P", className: "text-center text-(--red)", hideOnMobile: true },
  ];

  const showConfirmed = tab === "all" || tab === "confirmed";
  const showUnanswered = tab === "all" || tab === "unanswered";
  const showOut = tab === "all" || tab === "out";

  const totalCols = columns.length + (teamsAssigned ? 1 : 0) + (isAdmin ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Barra superior de filtros, busqueda y contador */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className={`rounded-md border px-3 py-1.5 ${missing > 0 ? "border-(--gold)/40 bg-(--gold)/10" : "border-(--green)/40 bg-(--green)/10"}`}>
            <p className="text-[10px] font-black uppercase tracking-wide text-(--muted)">Plantel</p>
            <p className={`text-lg font-black leading-none ${missing > 0 ? "text-(--gold)" : "text-(--green)"}`}>
              {confirmedCount}/{squadTarget} · {missing > 0 ? `faltan ${missing}` : "completo"}
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-(--border) bg-white/[0.03] p-1 text-xs font-bold">
            {tabs.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${
                    active ? "bg-white/[0.14] text-white shadow-sm" : "text-(--muted) hover:text-white hover:bg-white/[0.05]"
                  }`}
                >
                  <span>{t.label}</span>
                  <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${t.colorClass}`}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--muted)" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar jugador..."
              className="w-full rounded-md border border-(--border) bg-black/20 py-1.5 pl-8 pr-2.5 text-xs text-white placeholder-(--muted) focus:border-(--green) focus:outline-none"
            />
          </div>
          {isAdmin && onAddPlayer ? (
            <Button variant="secondary" onClick={onAddPlayer}>
              <UserPlus size={16} />
              Agregar jugador
            </Button>
          ) : null}
        </div>
      </div>

      {/* Tabla Unificada */}
      <div className="overflow-x-auto rounded-lg border border-(--border)">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-(--border) bg-white/[0.04] text-[10px] font-black uppercase tracking-wide text-(--muted)">
            <tr>
              {columns.map((column) => {
                const active = sort.key === column.key;
                return (
                  <th
                    key={column.key}
                    aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    className={`px-3 py-2 ${column.className ?? ""} ${column.hideOnMobile ? "hidden md:table-cell" : ""}`}
                  >
                    <button type="button" onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-1 hover:text-white">
                      {column.label}
                      <span aria-hidden="true" className={active ? "text-white" : "text-(--muted)/60"}>
                        {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
              {teamsAssigned ? (
                <th className="px-3 py-2 text-center">
                  <button type="button" onClick={() => toggleSort("team")} className="inline-flex items-center gap-1 hover:text-white">
                    Equipo
                    <span aria-hidden="true" className={sort.key === "team" ? "text-white" : "text-(--muted)/60"}>
                      {sort.key === "team" ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
              ) : null}
              {isAdmin ? <th className="px-3 py-2 text-center">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {/* 1. SECCION: CONFIRMADOS */}
            {showConfirmed ? (
              <>
                {tab === "all" ? (
                  <tr className="border-b border-(--border) bg-(--green)/10">
                    <td colSpan={totalCols} className="px-3 py-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-(--green)">
                          <span>🟢 Confirmados ({sortedConfirmed.length} / {squadTarget})</span>
                          {missing > 0 ? (
                            <span className="text-[11px] font-semibold text-(--muted)">· faltan {missing} para completar cupo</span>
                          ) : (
                            <span className="text-[11px] font-semibold text-(--green)">· plantel completo</span>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {sortedConfirmed.length === 0 ? (
                  <tr className="border-b border-(--border)">
                    <td colSpan={totalCols} className="py-4 text-center text-xs text-(--muted)">
                      No hay jugadores confirmados {search ? "que coincidan con la busqueda" : "aun"}.
                    </td>
                  </tr>
                ) : (
                  sortedConfirmed.map((row, index) => {
                    const player = playerForMatchRow(row, players);
                    const standing = standingForMatchRow(row, players, standings);
                    const playerName = player?.name ?? row.name;
                    const isMonthly = isMonthlyMatchRow(row, players, match.monthKey, monthlyPayments);
                    const isArq = player?.isGoalkeeper === true;
                    const whatsapp = whatsappHref(row.phone || player?.phone || "");

                    return (
                      <tr key={row.id} className="border-b border-(--border) last:border-0 hover:bg-white/[0.04] transition">
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-(--muted)">
                          #{confirmedOrderMap.get(row.id) ?? index + 1}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-white">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {player ? (
                              <Link href={`/players/${player.id}`} className="hover:underline">
                                {playerName}
                              </Link>
                            ) : (
                              <span>{playerName}</span>
                            )}
                            {isArq ? (
                              <span className="inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-400 uppercase tracking-wider">
                                🧤 ARQ
                              </span>
                            ) : null}
                            {isMonthly ? (
                              <span className="inline-flex items-center rounded bg-(--cyan)/15 px-1 py-0.5 text-[8px] font-black text-(--cyan) uppercase tracking-wider">
                                Mensual
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-(--muted)">
                          {standing ? `#${standing.rank} · ${standing.played} PJ` : "Sin ranking"}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-(--gold)">
                          {standing?.points ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-white">
                          {standing?.played ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--green)">
                          {standing?.wins ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--muted)">
                          {standing?.draws ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--red)">
                          {standing?.losses ?? "—"}
                        </td>
                        {teamsAssigned ? (
                          <td className={`px-3 py-2.5 text-center text-xs font-bold ${row.team === "A" ? "text-(--red)" : row.team === "B" ? "text-(--gold)" : "text-(--muted)"}`}>
                            {row.team === "A" ? "Rojo" : row.team === "B" ? "Amarillo" : "Sin asignar"}
                          </td>
                        ) : null}
                        {isAdmin ? (
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {whatsapp ? (
                                <a href={whatsapp} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-(--green) hover:bg-(--green)/15 transition" title={`WhatsApp ${playerName}`}>
                                  <MessageCircle size={15} />
                                </a>
                              ) : null}
                              {onOpenDetails ? (
                                <button type="button" onClick={() => onOpenDetails(row.id)} className="rounded-md p-1.5 text-(--muted) hover:bg-white/[0.14] transition" title={`Editar ${playerName}`}>
                                  <Pencil size={15} />
                                </button>
                              ) : null}
                              {onMarkOut ? (
                                <button type="button" onClick={() => onMarkOut(row.id)} className="rounded-md p-1.5 text-(--red) hover:bg-(--red)/15 transition" title={`Marcar que ${playerName} no puede jugar`}>
                                  <X size={15} />
                                </button>
                              ) : null}
                              {!player && onAssociate ? (
                                <button type="button" onClick={() => onAssociate(row.id)} className="rounded-md p-1.5 text-(--cyan) hover:bg-(--cyan)/15 transition" title="Asociar a jugador existente">
                                  <UserPlus size={15} />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </>
            ) : null}

            {/* 2. SECCION: SIN RESPUESTA TODAVIA */}
            {showUnanswered ? (
              <>
                {tab === "all" ? (
                  <tr className="border-b border-(--border) bg-amber-500/10">
                    <td colSpan={totalCols} className="px-3 py-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-amber-400">
                          <span>⏳ Sin respuesta ({sortedUnanswered.length})</span>
                          <span className="text-[11px] font-semibold text-(--muted)">· habituales priorizados por frecuencia de asistencia</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {visibleUnanswered.length === 0 ? (
                  <tr className="border-b border-(--border)">
                    <td colSpan={totalCols} className="py-4 text-center text-xs text-(--muted)">
                      No hay jugadores pendientes {search ? "que coincidan con la busqueda" : ""}.
                    </td>
                  </tr>
                ) : (
                  visibleUnanswered.map((item) => {
                    const standing = item.standing;
                    const isArq = item.player.isGoalkeeper;
                    const pingText = `Hola ${item.player.nickname || item.player.name.split(" ")[0]}! ¿Juegas este martes en el SIFUP? Avisame para anotarte en la lista.`;
                    const whatsapp = whatsappHref(item.player.phone, pingText);

                    return (
                      <tr key={item.player.id} className="border-b border-(--border) last:border-0 hover:bg-white/[0.04] transition">
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-(--muted)/60">
                          —
                        </td>
                        <td className="px-3 py-2.5 font-bold text-white">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Link href={`/players/${item.player.id}`} className="hover:underline">
                              {item.player.name}
                            </Link>
                            {isArq ? (
                              <span className="inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-400 uppercase tracking-wider">
                                🧤 ARQ
                              </span>
                            ) : null}
                            {item.isMonthly ? (
                              <span className="inline-flex items-center rounded bg-(--cyan)/15 px-1 py-0.5 text-[8px] font-black text-(--cyan) uppercase tracking-wider">
                                Mensual
                              </span>
                            ) : null}
                            {item.totalPlayed >= 2 ? (
                              <span className="inline-flex items-center rounded bg-white/[0.08] px-1 py-0.5 text-[9px] font-semibold text-(--muted)">
                                {item.totalPlayed} PJ hist.
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-(--muted)">
                          {standing ? `#${standing.rank} · ${standing.played} PJ` : "Sin ranking"}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-(--gold)">
                          {standing?.points ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-white">
                          {item.totalPlayed}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--green)">
                          {standing?.wins ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--muted)">
                          {standing?.draws ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--red)">
                          {standing?.losses ?? "—"}
                        </td>
                        {teamsAssigned ? (
                          <td className="px-3 py-2.5 text-center text-xs text-(--muted)">
                            —
                          </td>
                        ) : null}
                        {isAdmin ? (
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {whatsapp ? (
                                <a href={whatsapp} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-(--green) hover:bg-(--green)/15 transition" title={`Consultar a ${item.player.name} por WhatsApp`}>
                                  <MessageCircle size={15} />
                                </a>
                              ) : null}
                              {onQuickConfirmPlayer ? (
                                <button
                                  type="button"
                                  onClick={() => onQuickConfirmPlayer(item.player)}
                                  className="inline-flex items-center gap-1 rounded bg-(--green)/15 px-2 py-1 text-xs font-bold text-(--green) hover:bg-(--green)/25 transition"
                                  title={`Confirmar a ${item.player.name}`}
                                >
                                  <Check size={14} />
                                  <span className="hidden xl:inline">Voy</span>
                                </button>
                              ) : null}
                              {onQuickMarkPlayerOut ? (
                                <button
                                  type="button"
                                  onClick={() => onQuickMarkPlayerOut(item.player)}
                                  className="inline-flex items-center gap-1 rounded bg-(--red)/15 px-2 py-1 text-xs font-bold text-(--red) hover:bg-(--red)/25 transition"
                                  title={`Marcar que ${item.player.name} no va`}
                                >
                                  <X size={14} />
                                  <span className="hidden xl:inline">No va</span>
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
                {tab === "all" && !showAllUnanswered && occasionalCount > 0 && !search.trim() ? (
                  <tr className="border-b border-(--border) bg-white/[0.02]">
                    <td colSpan={totalCols} className="py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => setShowAllUnanswered(true)}
                        className="text-xs font-bold text-(--muted) hover:text-white transition inline-flex items-center gap-1"
                      >
                        + Mostrar {occasionalCount} jugadores ocasionales sin asistencia previa...
                      </button>
                    </td>
                  </tr>
                ) : tab === "all" && showAllUnanswered && occasionalCount > 0 && !search.trim() ? (
                  <tr className="border-b border-(--border) bg-white/[0.02]">
                    <td colSpan={totalCols} className="py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => setShowAllUnanswered(false)}
                        className="text-xs font-bold text-(--muted) hover:text-white transition inline-flex items-center gap-1"
                      >
                        - Ocultar jugadores ocasionales
                      </button>
                    </td>
                  </tr>
                ) : null}
              </>
            ) : null}

            {/* 3. SECCION: NO VAN */}
            {showOut ? (
              <>
                {tab === "all" ? (
                  <tr className="border-b border-(--border) bg-(--red)/10">
                    <td colSpan={totalCols} className="px-3 py-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-(--red)">
                          <span>🔴 No van ({sortedOut.length})</span>
                          <span className="text-[11px] font-semibold text-(--muted)">· bajas confirmadas para este partido</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {sortedOut.length === 0 ? (
                  <tr className="border-b border-(--border)">
                    <td colSpan={totalCols} className="py-4 text-center text-xs text-(--muted)">
                      No hay bajas registradas {search ? "que coincidan con la busqueda" : ""}.
                    </td>
                  </tr>
                ) : (
                  sortedOut.map((row) => {
                    const player = playerForMatchRow(row, players);
                    const standing = standingForMatchRow(row, players, standings);
                    const playerName = player?.name ?? row.name;
                    const isMonthly = isMonthlyMatchRow(row, players, match.monthKey, monthlyPayments);
                    const isArq = player?.isGoalkeeper === true;
                    const whatsapp = whatsappHref(row.phone || player?.phone || "");

                    return (
                      <tr key={row.id} className="border-b border-(--border) last:border-0 hover:bg-white/[0.04] transition opacity-75">
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-(--muted)/60">
                          —
                        </td>
                        <td className="px-3 py-2.5 font-bold text-white">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {player ? (
                              <Link href={`/players/${player.id}`} className="hover:underline line-through text-(--muted)">
                                {playerName}
                              </Link>
                            ) : (
                              <span className="line-through text-(--muted)">{playerName}</span>
                            )}
                            {isArq ? (
                              <span className="inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-400 uppercase tracking-wider">
                                🧤 ARQ
                              </span>
                            ) : null}
                            {isMonthly ? (
                              <span className="inline-flex items-center rounded bg-(--cyan)/15 px-1 py-0.5 text-[8px] font-black text-(--cyan) uppercase tracking-wider">
                                Mensual
                              </span>
                            ) : null}
                            {row.note ? (
                              <span className="text-[10px] italic text-(--muted)">({row.note})</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-(--muted)">
                          {standing ? `#${standing.rank} · ${standing.played} PJ` : "Sin ranking"}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-(--muted)">
                          {standing?.points ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-(--muted)">
                          {standing?.played ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--muted)">
                          {standing?.wins ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--muted)">
                          {standing?.draws ?? "—"}
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-center font-bold text-(--muted)">
                          {standing?.losses ?? "—"}
                        </td>
                        {teamsAssigned ? (
                          <td className="px-3 py-2.5 text-center text-xs text-(--muted)">
                            —
                          </td>
                        ) : null}
                        {isAdmin ? (
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {whatsapp ? (
                                <a href={whatsapp} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-(--green) hover:bg-(--green)/15 transition" title={`WhatsApp ${playerName}`}>
                                  <MessageCircle size={15} />
                                </a>
                              ) : null}
                              {onRejoin ? (
                                <button
                                  type="button"
                                  onClick={() => onRejoin(row.id)}
                                  className="inline-flex items-center gap-1 rounded bg-(--green)/15 px-2 py-1 text-xs font-bold text-(--green) hover:bg-(--green)/25 transition"
                                  title={`Reincorporar a ${playerName} como confirmado`}
                                >
                                  <RotateCcw size={14} />
                                  <span className="hidden xl:inline">Reincorporar</span>
                                </button>
                              ) : null}
                              {onRemove ? (
                                <button
                                  type="button"
                                  onClick={() => onRemove(row.id)}
                                  className="rounded-md p-1.5 text-(--red) hover:bg-(--red)/15 transition"
                                  title={`Quitar a ${playerName} del partido`}
                                >
                                  <UserMinus size={15} />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamAssignmentBoard({
  rows,
  players,
  allMatchPlayers,
  standings,
  match,
  monthlyPayments,
  onOpenDetails,
  onMarkOut,
  onRejoin,
  onRemove,
  onAssociate,
  onAddPlayer,
  onQuickConfirmPlayer,
  onQuickMarkPlayerOut,
}: {
  rows: MatchPlayer[];
  players: Player[];
  allMatchPlayers: MatchPlayer[];
  standings: Map<string, PlayerStanding>;
  match: Match;
  monthlyPayments: MonthlyPayment[];
  onOpenDetails: (rowId: string) => void;
  onMarkOut: (rowId: string) => void;
  onRejoin: (rowId: string) => void;
  onRemove: (rowId: string) => void;
  onAssociate: (rowId: string) => void;
  onAddPlayer: () => void;
  onQuickConfirmPlayer: (player: Player) => void;
  onQuickMarkPlayerOut: (player: Player) => void;
}) {
  return (
    <UnifiedMatchRoster
      rows={rows}
      players={players}
      allMatchPlayers={allMatchPlayers}
      standings={standings}
      match={match}
      monthlyPayments={monthlyPayments}
      isAdmin={true}
      onOpenDetails={onOpenDetails}
      onMarkOut={onMarkOut}
      onRejoin={onRejoin}
      onRemove={onRemove}
      onAssociate={onAssociate}
      onAddPlayer={onAddPlayer}
      onQuickConfirmPlayer={onQuickConfirmPlayer}
      onQuickMarkPlayerOut={onQuickMarkPlayerOut}
    />
  );
}

function PublicMatchRows({
  rows,
  players,
  allMatchPlayers,
  standings,
  match,
  monthlyPayments,
}: {
  rows: MatchPlayer[];
  players: Player[];
  allMatchPlayers: MatchPlayer[];
  standings: Map<string, PlayerStanding>;
  match: Match;
  monthlyPayments: MonthlyPayment[];
}) {
  return (
    <UnifiedMatchRoster
      rows={rows}
      players={players}
      allMatchPlayers={allMatchPlayers}
      standings={standings}
      match={match}
      monthlyPayments={monthlyPayments}
      isAdmin={false}
    />
  );
}

function AddPlayerModal({
  candidates,
  onClose,
  onAddExisting,
  onCreateAndAdd,
}: {
  candidates: Player[];
  onClose: () => void;
  onAddExisting: (player: Player) => void;
  onCreateAndAdd: (name: string, phone: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("es-CL");
  const filteredCandidates = candidates.filter((player) => (
    !normalizedQuery || `${player.name} ${player.nickname}`.toLocaleLowerCase("es-CL").includes(normalizedQuery)
  ));
  return (
    <Modal title="Agregar jugador al partido" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-(--muted)">Jugadores existentes</p>
          <Input label="Buscar jugador" value={query} onChange={setQuery} />
          <div className="max-h-56 space-y-1 overflow-auto">
            {candidates.length === 0 ? <p className="text-sm text-(--muted)">Todos los jugadores activos ya estan en este partido.</p> : null}
            {filteredCandidates.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => onAddExisting(player)}
                className="flex w-full items-center justify-between rounded-md border border-(--border) px-3 py-2 text-left text-sm hover:bg-white/[0.04]"
              >
                <span className="font-medium text-white">{player.name}</span>
                <Plus size={16} className="text-(--muted)" />
              </button>
            ))}
            {candidates.length > 0 && filteredCandidates.length === 0 ? <p className="py-4 text-center text-sm text-(--muted)">No hay jugadores que coincidan.</p> : null}
          </div>
        </div>
        <div className="space-y-2 border-t border-(--border) pt-3">
          <p className="text-sm font-medium text-(--muted)">Jugador nuevo</p>
          <Input label="Nombre" value={name} onChange={setName} />
          <Input label="Telefono (opcional)" value={phone} onChange={setPhone} />
          <Button onClick={() => onCreateAndAdd(name, phone)} disabled={!name.trim()}>
            <UserPlus size={16} />
            Crear y agregar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AssociatePlayerModal({
  row,
  candidates,
  matchPlayers,
  onClose,
  onAssociate,
}: {
  row?: MatchPlayer;
  candidates: Player[];
  matchPlayers: MatchPlayer[];
  onClose: () => void;
  onAssociate: (player: Player) => void;
}) {
  const [query, setQuery] = useState("");
  if (!row) return null;
  const normalizedQuery = query.trim().toLocaleLowerCase("es-CL");
  const filtered = candidates.filter((player) => !normalizedQuery || `${player.name} ${player.nickname}`.toLocaleLowerCase("es-CL").includes(normalizedQuery));
  const playedMatches = (player: Player) => matchPlayers.filter((item) =>
    item.attendanceStatus === "confirmed" &&
    (item.playerId === player.id || findKnownPlayer(candidates, item.name)?.id === player.id),
  ).length;

  return (
    <Modal title={`Asociar ${row.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-(--muted)">Elige el jugador correspondiente. El nombre de WhatsApp se agregará a su lista de apodos, separada por comas, para reconocerlo automáticamente después.</p>
        <Input label="Buscar jugador" value={query} onChange={setQuery} />
        <div className="max-h-[45vh] space-y-1 overflow-auto overscroll-contain rounded-md">
          {filtered.map((player) => (
            <button key={player.id} type="button" onClick={() => onAssociate(player)} className="flex w-full items-center justify-between gap-3 rounded-md border border-(--border) px-3 py-3 text-left transition active:bg-white/[0.10] hover:bg-white/[0.06]">
              <span className="min-w-0"><span className="block truncate font-bold text-white">{player.name}</span><span className="block truncate text-xs text-(--muted)">{player.nickname || "Sin apodo"} · {playedMatches(player)} PJ</span></span>
              <span className="shrink-0 text-xs font-bold text-(--cyan)">Asociar</span>
            </button>
          ))}
          {filtered.length === 0 ? <p className="py-4 text-center text-sm text-(--muted)">No hay jugadores que coincidan.</p> : null}
        </div>
      </div>
    </Modal>
  );
}

function PlayerDetailModal({
  row,
  onClose,
  onSave,
  onAssociate,
}: {
  row: MatchPlayer;
  onClose: () => void;
  onSave: (patch: Partial<MatchPlayer>) => void;
  onAssociate?: () => void;
}) {
  const [draft, setDraft] = useState(row);
  return (
    <Modal title={`Editar ${row.name}`} onClose={onClose}>
      <div className="space-y-3 pb-2">
        <Input label="Nombre" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
        <Input label="Telefono" value={draft.phone} onChange={(value) => setDraft({ ...draft, phone: value })} />
        <label className="space-y-1 text-sm font-medium text-(--muted)">
          <span>Asistencia</span>
          <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={draft.attendanceStatus} onChange={(event) => setDraft({ ...draft, attendanceStatus: event.target.value as MatchPlayer["attendanceStatus"] })}>
            <option value="confirmed">Confirmado</option>
            <option value="maybe">Tal vez</option>
            <option value="out">No puede</option>
            <option value="waitlist">En espera</option>
          </select>
        </label>
        <Input label="# WhatsApp" type="number" value={String(draft.whatsappOrder)} onChange={(value) => setDraft({ ...draft, whatsappOrder: Number(value) })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Debe" type="number" value={String(draft.amountDue)} onChange={(value) => setDraft({ ...draft, amountDue: Number(value) })} />
          <Input label="Pagado" type="number" value={String(draft.amountPaid)} onChange={(value) => setDraft({ ...draft, amountPaid: Number(value) })} />
        </div>
        <Input label="Goles en este partido" type="number" value={String(draft.goals ?? 0)} onChange={(value) => setDraft({ ...draft, goals: Math.max(0, Number(value)) })} />
        <Input label="Nota" value={draft.note} onChange={(value) => setDraft({ ...draft, note: value })} />
        <div className="flex gap-2">
          {onAssociate ? (
            <Button variant="secondary" onClick={onAssociate}>
              <UserPlus size={16} />
              Asociar jugador
            </Button>
          ) : null}
          <Button onClick={() => onSave(draft)}><Save size={16} />Guardar</Button>
        </div>
      </div>
    </Modal>
  );
}

function matchDateTime(match: Match) {
  return new Date(`${match.date}T${match.time || "00:00"}`);
}

function matchIsUpcoming(match: Match) {
  return matchDateTime(match) >= new Date();
}

function matchCountdownLabel(match: Match) {
  const hours = (matchDateTime(match).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hours < 1) return "Es en menos de 1 hora";
  if (hours < 48) return `${Math.round(hours)} horas para el partido`;
  return `${Math.round(hours / 24)} dias para el partido`;
}

function hasTeamsAssigned(rows: MatchPlayer[]) {
  return rows.some((row) => row.team === "A" || row.team === "B");
}


function teamRankingTotal(rows: MatchPlayer[], players: Player[], standings: Map<string, PlayerStanding>, team: "A" | "B") {
  return rows
    .filter((row) => row.team === team && row.attendanceStatus === "confirmed")
    .reduce((sum, row) => sum + (standingForMatchRow(row, players, standings)?.points ?? 0), 0);
}

function royalTeamRankingTotal(rows: MatchPlayer[], players: Player[], standings: Map<string, PlayerStanding>, teamId: string) {
  return rows
    .filter((row) => row.teamId === teamId && row.attendanceStatus === "confirmed")
    .reduce((sum, row) => sum + (standingForMatchRow(row, players, standings)?.points ?? 0), 0);
}

function RoyalHeroTeams({ teams, rows, players, standings }: { teams: MatchTeam[]; rows: MatchPlayer[]; players: Player[]; standings: Map<string, PlayerStanding> }) {
  if (teams.length === 0) return null;
  const sorted = [...teams].sort((a, b) => a.seq - b.seq);
  const closed = sorted.length === 3 && sorted.every((team) => team.finalRank);
  const ordered = closed ? [...sorted].sort((a, b) => (a.finalRank ?? 0) - (b.finalRank ?? 0)) : sorted;

  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      {ordered.map((team) => {
        const colorClasses = MATCH_TEAM_COLOR_CLASSES[team.color];
        const teamRows = rows.filter((row) => row.teamId === team.id && row.attendanceStatus === "confirmed");
        const points = royalTeamRankingTotal(rows, players, standings, team.id);
        const rankLabel = team.finalRank === 1 ? "1° · Campeon" : team.finalRank === 2 ? "2° lugar" : team.finalRank === 3 ? "3° lugar" : null;
        const awardedPoints = team.finalRank === 1 ? WIN_POINTS : team.finalRank ? LOSS_POINTS : null;
        return (
          <div key={team.id} className={`rounded-lg border p-4 ${colorClasses.border} ${colorClasses.bg}`}>
            <p className={`text-sm font-black uppercase tracking-wide ${colorClasses.text}`}>{team.name}</p>
            {rankLabel ? (
              <>
                <p className="mt-2 text-xl font-black leading-none text-white">{rankLabel}</p>
                <p className="mt-1 text-xs font-bold uppercase text-(--muted)">{awardedPoints} pts por jugador</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-2xl font-black leading-none text-white">{teamRows.length}</p>
                <p className="mt-1 text-xs font-bold uppercase text-(--muted)">jugadores · {points} pts</p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MatchHero({
  match,
  rows,
  result,
  matchTeams,
  players,
  standings,
  isAdmin,
  onSave,
  onEdit,
  isPending,
  previous,
  next,
}: {
  match: Match;
  rows: MatchPlayer[];
  result?: MatchResult;
  matchTeams: MatchTeam[];
  players: Player[];
  standings: Map<string, PlayerStanding>;
  isAdmin: boolean;
  onSave: () => void;
  onEdit: () => void;
  isPending: boolean;
  previous?: Match;
  next?: Match;
}) {
  const summary = summarizeMatch(rows);
  const upcoming = matchIsUpcoming(match);
  const isRoyal = match.matchFormat === "rey_de_la_cancha";
  const showResult = Boolean(result && !upcoming);
  const teamA = rows.filter((row) => row.team === "A" && row.attendanceStatus === "confirmed");
  const teamB = rows.filter((row) => row.team === "B" && row.attendanceStatus === "confirmed");
  const pointsA = teamRankingTotal(rows, players, standings, "A");
  const pointsB = teamRankingTotal(rows, players, standings, "B");
  const confirmed = summary.confirmedCount;
  const missing = Math.max((isRoyal ? ROYAL_SQUAD_TARGET : SQUAD_TARGET) - confirmed, 0);

  return (
    <section className="overflow-hidden rounded-xl border border-(--border) bg-(--panel) shadow-(--shadow)">
      <div className="relative overflow-hidden border-b border-(--border) p-5 sm:p-6">
        <div className="absolute inset-0 bg-[url('/brand/sifup-keyvisual-v1.png')] bg-cover bg-center opacity-20" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-r from-(--bg-deep) via-(--bg-deep)/90 to-(--bg-deep)/55" aria-hidden="true" />
        <div className="relative">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="label-row mb-3">
                <span>SIFUP</span>
                <strong>{upcoming ? "Partido por jugar" : showResult ? "Resultado cerrado" : "Partido"}</strong>
              </div>
              <h1 className="max-w-3xl text-4xl font-black uppercase leading-none text-white sm:text-6xl">{upcoming ? matchCountdownLabel(match) : (match.weekLabel || match.date)}</h1>
              <div className="mt-4 flex flex-wrap gap-3 text-sm font-bold">
                <p className="flex items-center gap-2 text-white">
                  <CalendarDays size={16} className="text-(--cyan)" />
                  <span>{match.date} · {match.time}</span>
                </p>
                <a
                  href={googleMapsHref(match.location)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-2 text-(--muted) hover:text-white hover:underline"
                >
                  <MapPin size={16} className="mt-0.5 text-(--gold)" />
                  <span>{match.location}</span>
                </a>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {previous ? (
                <Link href={`/matches/${previous.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
                  <ChevronLeft size={16} />
                  Anterior
                </Link>
              ) : null}
              {next ? (
                <Link href={`/matches/${next.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
                  Proximo
                  <ChevronRight size={16} />
                </Link>
              ) : null}
              <Link href={`/matches/${match.id}/teams`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
                <Users size={16} />
                Equipos
              </Link>
              {isAdmin ? <Button variant="secondary" onClick={onEdit}><Pencil size={16} />Editar partido</Button> : null}
              {isAdmin ? <Button onClick={onSave} disabled={isPending}><Save size={16} />Guardar</Button> : null}
            </div>
          </div>

          <div className="mt-6">
            <div className={`rounded-lg border p-4 ${missing > 0 ? "border-(--gold)/45 bg-(--gold)/12" : "border-(--green)/45 bg-(--green)/12"}`}>
              <p className="text-[11px] font-black uppercase tracking-wide text-(--muted)">Jugadores confirmados</p>
              <p className={`mt-2 text-5xl font-black leading-none ${missing > 0 ? "text-(--gold)" : "text-(--green)"}`}>{confirmed}/{SQUAD_TARGET}</p>
              <p className="mt-1 text-sm font-bold text-(--muted)">{missing > 0 ? `faltan ${missing} jugadores` : "plantel completo"}</p>
            </div>
          </div>

          {isRoyal ? (
            <RoyalHeroTeams teams={matchTeams} rows={rows} players={players} standings={standings} />
          ) : hasTeamsAssigned(rows) || showResult ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
            <div className="rounded-lg border border-(--red)/35 bg-(--red)/10 p-4">
              <p className="text-sm font-black uppercase tracking-wide text-(--red)">Equipo Rojo</p>
              <p className={`mt-2 text-2xl font-black leading-none ${showResult && result?.winner === "A" ? "text-(--red)" : "text-white"}`}>{showResult ? (result?.winner === "A" ? "Ganador" : result?.winner === "draw" ? "Empate" : "") : teamA.length}</p>
              <p className="mt-1 text-xs font-bold uppercase text-(--muted)">{showResult ? "resultado final" : `jugadores · ${pointsA} pts`}</p>
            </div>
            <div className="grid place-items-center">
              <span className="rounded-full border border-white/15 bg-white/[0.08] px-4 py-2 text-sm font-black text-white">VS</span>
            </div>
            <div className="rounded-lg border border-(--gold)/45 bg-(--gold)/10 p-4 lg:text-right">
              <p className="text-sm font-black uppercase tracking-wide text-(--gold)">Equipo Amarillo</p>
              <p className={`mt-2 text-2xl font-black leading-none ${showResult && result?.winner === "B" ? "text-(--gold)" : "text-white"}`}>{showResult ? (result?.winner === "B" ? "Ganador" : result?.winner === "draw" ? "Empate" : "") : teamB.length}</p>
              <p className="mt-1 text-xs font-bold uppercase text-(--muted)">{showResult ? "resultado final" : `jugadores · ${pointsB} pts`}</p>
            </div>
          </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedMs = now - new Date(startedAt).getTime();
  const limitMs = ROYAL_GAME_TIME_LIMIT_MIN * 60_000;
  const color = elapsedMs >= limitMs ? "text-(--red)" : elapsedMs >= limitMs - 2 * 60_000 ? "text-(--gold)" : "text-white";

  return <span className={`font-black tabular-nums ${color}`}>{formatElapsed(elapsedMs)}</span>;
}

function GameWinnerHint({ game, teamsById }: { game: MatchGame; teamsById: Map<string, MatchTeam> }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedMs = now - new Date(game.startedAt).getTime();
  const suggestedTeamId = suggestGameWinner(game, elapsedMs, game.homeTeamId, game.awayTeamId);
  return (
    <p className="text-center text-xs text-(--muted)">
      Sugerido: gana {teamsById.get(suggestedTeamId)?.name} (dif. 2 goles o 10 min, empate se lo queda quien defiende la cancha)
    </p>
  );
}

function suggestGameWinner(game: { scoreHome: number; scoreAway: number }, elapsedMs: number, homeTeamId: string, awayTeamId: string) {
  const diff = game.scoreHome - game.scoreAway;
  if (Math.abs(diff) >= ROYAL_GOAL_DIFF_TO_WIN) return diff > 0 ? homeTeamId : awayTeamId;
  if (elapsedMs >= ROYAL_GAME_TIME_LIMIT_MIN * 60_000) {
    if (diff !== 0) return diff > 0 ? homeTeamId : awayTeamId;
    return homeTeamId;
  }
  return diff >= 0 ? homeTeamId : awayTeamId;
}

function suggestEndReason(game: { scoreHome: number; scoreAway: number }): GameEndReason {
  return Math.abs(game.scoreHome - game.scoreAway) >= ROYAL_GOAL_DIFF_TO_WIN ? "goal_diff" : "time_limit";
}

function suggestFinalOrder(teams: MatchTeam[], games: MatchGame[]): string[] {
  const winsByTeam = new Map(teams.map((team) => [team.id, 0]));
  games.forEach((game) => {
    if (game.status === "finished" && game.winnerTeamId) {
      winsByTeam.set(game.winnerTeamId, (winsByTeam.get(game.winnerTeamId) ?? 0) + 1);
    }
  });
  return [...teams].sort((a, b) => (winsByTeam.get(b.id) ?? 0) - (winsByTeam.get(a.id) ?? 0)).map((team) => team.id);
}

function RoyalTeamRoster({
  teams,
  rows,
  players,
  standings,
  isAdmin,
  onRenameTeam,
  onAssignTeam,
}: {
  teams: MatchTeam[];
  rows: MatchPlayer[];
  players: Player[];
  standings: Map<string, PlayerStanding>;
  isAdmin: boolean;
  onRenameTeam: (teamId: string, patch: Partial<Pick<MatchTeam, "name" | "color">>) => void;
  onAssignTeam: (rowId: string, teamId: string) => void;
}) {
  const confirmedRows = rows.filter((row) => row.attendanceStatus === "confirmed");
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {teams.map((team) => {
        const colorClasses = MATCH_TEAM_COLOR_CLASSES[team.color];
        const teamRows = confirmedRows.filter((row) => row.teamId === team.id);
        const points = royalTeamRankingTotal(rows, players, standings, team.id);
        return (
          <div key={team.id} className={`space-y-2 rounded-md border p-3 ${colorClasses.border} ${colorClasses.bg}`}>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <input
                  value={team.name}
                  onChange={(event) => onRenameTeam(team.id, { name: event.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs font-black uppercase tracking-wide text-white outline-none"
                />
                <select
                  value={team.color}
                  onChange={(event) => onRenameTeam(team.id, { color: event.target.value as MatchTeamColor })}
                  className="rounded-md border border-white/10 bg-black/20 px-1 py-1 text-[10px] font-bold text-white outline-none"
                >
                  {(Object.keys(MATCH_TEAM_COLOR_LABEL) as MatchTeamColor[]).map((color) => (
                    <option key={color} value={color}>{MATCH_TEAM_COLOR_LABEL[color]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className={`text-sm font-black uppercase tracking-wide ${colorClasses.text}`}>{team.name}</p>
            )}
            <p className={`text-xs font-black uppercase ${colorClasses.text}`}>{teamRows.length} jug · {points} pts</p>
            <ul className="space-y-1">
              {teamRows.map((row) => {
                const isArq = playerForMatchRow(row, players)?.isGoalkeeper === true;
                return (
                  <li key={row.id} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/10 px-2 py-1">
                    <span className="truncate text-xs font-semibold text-white">
                      {row.name}
                      {isArq ? <span className="ml-1 text-[8px] font-black text-amber-500 uppercase">ARQ</span> : null}
                    </span>
                    {isAdmin ? (
                      <select
                        value={team.id}
                        onChange={(event) => onAssignTeam(row.id, event.target.value)}
                        className="rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[10px] font-bold text-white outline-none"
                      >
                        {teams.map((option) => (
                          <option key={option.id} value={option.id}>{option.name}</option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function RoyalGameHistory({ games, teamsById }: { games: MatchGame[]; teamsById: Map<string, MatchTeam> }) {
  const finished = [...games].filter((game) => game.status === "finished").sort((a, b) => a.seq - b.seq);
  if (finished.length === 0) {
    return <p className="text-sm text-(--muted)">Todavia no hay juegos cerrados esta noche.</p>;
  }
  return (
    <div className="space-y-2">
      {finished.map((game) => {
        const home = teamsById.get(game.homeTeamId);
        const away = teamsById.get(game.awayTeamId);
        const winner = teamsById.get(game.winnerTeamId ?? "");
        const durationMs = game.endedAt ? new Date(game.endedAt).getTime() - new Date(game.startedAt).getTime() : 0;
        return (
          <div key={game.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-sm">
            <span className="font-bold text-white">
              #{game.seq} {home?.name ?? "?"} {game.scoreHome} - {game.scoreAway} {away?.name ?? "?"}
            </span>
            <span className="text-xs font-bold uppercase text-(--muted)">
              gana {winner?.name ?? "?"} · {game.endReason === "goal_diff" ? "dif. de gol" : "tiempo"} · {formatElapsed(durationMs)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RoyalNightPanel({
  matchId,
  teams,
  games,
  rows,
  players,
  standings,
  isAdmin,
  commit,
  data,
}: {
  matchId: string;
  teams: MatchTeam[];
  games: MatchGame[];
  rows: MatchPlayer[];
  players: Player[];
  standings: Map<string, PlayerStanding>;
  isAdmin: boolean;
  commit: (data: SifupData) => void;
  data: SifupData;
}) {
  const [error, setError] = useState("");
  const [finalRanks, setFinalRanks] = useState<Record<string, "" | 1 | 2 | 3>>(() => {
    if (teams.length !== 3) return {};
    const suggested = suggestFinalOrder(teams, games);
    return { [suggested[0]]: 1, [suggested[1]]: 2, [suggested[2]]: 3 };
  });
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const inProgress = games.find((game) => game.status === "in_progress");
  const closed = teams.length === 3 && teams.every((team) => team.finalRank);

  function startGame(homeTeamId: string, awayTeamId: string, waitingTeamId?: string) {
    const now = new Date().toISOString();
    const game: MatchGame = {
      id: newId("game"),
      matchId,
      seq: games.length + 1,
      homeTeamId,
      awayTeamId,
      waitingTeamId,
      scoreHome: 0,
      scoreAway: 0,
      status: "in_progress",
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    commit({ ...data, matchGames: [...data.matchGames, game] });
    startMatchGameAction(matchId, game).catch((err) => setError(err instanceof Error ? err.message : "No se pudo iniciar el juego."));
  }

  function updateScore(gameId: string, scoreHome: number, scoreAway: number) {
    const nextGames = data.matchGames.map((game) => (game.id === gameId ? { ...game, scoreHome, scoreAway } : game));
    commit({ ...data, matchGames: nextGames });
    updateMatchGameScoreAction(matchId, gameId, scoreHome, scoreAway).catch((err) => setError(err instanceof Error ? err.message : "No se pudo actualizar el marcador."));
  }

  function finishGame(game: MatchGame, winnerTeamId: string) {
    const now = new Date().toISOString();
    const endReason = suggestEndReason(game);
    const loserTeamId = winnerTeamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
    const nextGames = data.matchGames.map((item) => (item.id === game.id ? { ...item, status: "finished" as const, endedAt: now, endReason, winnerTeamId, updatedAt: now } : item));
    commit({ ...data, matchGames: nextGames });
    finishMatchGameAction(matchId, game.id, { scoreHome: game.scoreHome, scoreAway: game.scoreAway, endReason, winnerTeamId, endedAt: now })
      .then(() => {
        const waitingTeamId = game.waitingTeamId;
        if (waitingTeamId) startGame(winnerTeamId, waitingTeamId, loserTeamId);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cerrar el juego."));
  }

  function reopenNight() {
    if (!confirm("¿Eliminar el resultado de la noche? Los puntos otorgados a los 3 equipos se quitan del ranking historico.")) return;
    const now = new Date().toISOString();
    const nextTeams = data.matchTeams.map((team) => (team.matchId === matchId ? { ...team, finalRank: undefined, updatedAt: now } : team));
    commit({ ...data, matchTeams: nextTeams });
    setFinalRanks({});
    clearMatchFinalStandingAction(matchId)
      .then(() => setError(""))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo eliminar el resultado."));
  }

  function closeNight() {
    const ranks = Object.entries(finalRanks).filter(([, rank]) => rank !== "") as [string, 1 | 2 | 3][];
    const values = ranks.map(([, rank]) => rank);
    if (ranks.length !== 3 || new Set(values).size !== 3) {
      setError("Asigna 1°, 2° y 3° lugar sin repetir equipo.");
      return;
    }
    const now = new Date().toISOString();
    const nextTeams = data.matchTeams.map((team) => {
      const rank = ranks.find(([teamId]) => teamId === team.id)?.[1];
      return rank ? { ...team, finalRank: rank, updatedAt: now } : team;
    });
    commit({ ...data, matchTeams: nextTeams });
    setMatchFinalStandingAction(matchId, ranks.map(([teamId, finalRank]) => ({ teamId, finalRank })))
      .then(() => setError(""))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cerrar la noche."));
  }

  return (
    <Card className="mt-4 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Rey de la Cancha</p>
          <h2 className="mt-1 text-xl font-black text-white">Equipos</h2>
        </div>
        {isAdmin ? (
          <Link href={`/matches/${matchId}/teams`} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
            <Users size={16} />
            Administrar equipos
          </Link>
        ) : null}
      </div>
      <RoyalTeamRoster teams={teams} rows={rows} players={players} standings={standings} isAdmin={false} onRenameTeam={() => {}} onAssignTeam={() => {}} />

      {error ? <p className="rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}

      {closed ? null : isAdmin && inProgress ? (
        <div className="space-y-3 rounded-md border border-(--green)/40 bg-(--green)/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black uppercase text-white">Juego #{inProgress.seq} en curso</p>
            <LiveTimer startedAt={inProgress.startedAt} />
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="text-center">
              <p className="text-xs font-black uppercase text-(--muted)">{teamsById.get(inProgress.homeTeamId)?.name}</p>
              <div className="mt-1 flex items-center justify-center gap-2">
                <Button variant="secondary" onClick={() => updateScore(inProgress.id, Math.max(0, inProgress.scoreHome - 1), inProgress.scoreAway)}>-</Button>
                <span className="w-8 text-center text-2xl font-black text-white">{inProgress.scoreHome}</span>
                <Button variant="secondary" onClick={() => updateScore(inProgress.id, inProgress.scoreHome + 1, inProgress.scoreAway)}>+</Button>
              </div>
            </div>
            <span className="text-sm font-black text-(--muted)">VS</span>
            <div className="text-center">
              <p className="text-xs font-black uppercase text-(--muted)">{teamsById.get(inProgress.awayTeamId)?.name}</p>
              <div className="mt-1 flex items-center justify-center gap-2">
                <Button variant="secondary" onClick={() => updateScore(inProgress.id, inProgress.scoreHome, Math.max(0, inProgress.scoreAway - 1))}>-</Button>
                <span className="w-8 text-center text-2xl font-black text-white">{inProgress.scoreAway}</span>
                <Button variant="secondary" onClick={() => updateScore(inProgress.id, inProgress.scoreHome, inProgress.scoreAway + 1)}>+</Button>
              </div>
            </div>
          </div>
          <div className="flex justify-center gap-2">
            {([inProgress.homeTeamId, inProgress.awayTeamId] as const).map((teamId) => (
              <Button
                key={teamId}
                onClick={() => finishGame(inProgress, teamId)}
              >
                <Trophy size={16} />
                Gana {teamsById.get(teamId)?.name}
              </Button>
            ))}
          </div>
          <GameWinnerHint game={inProgress} teamsById={teamsById} />
        </div>
      ) : isAdmin && teams.length === 3 ? (
        <div className="space-y-2 rounded-md border border-(--border) bg-white/[0.04] p-4">
          <p className="text-sm font-black uppercase text-white">Iniciar juego</p>
          <div className="flex flex-wrap gap-2">
            {teams.map((waiting) => {
              const [home, away] = teams.filter((team) => team.id !== waiting.id);
              return (
                <Button key={waiting.id} variant="secondary" onClick={() => startGame(home.id, away.id, waiting.id)}>
                  {home.name} vs {away.name} · espera {waiting.name}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-black uppercase tracking-wide text-(--muted)">Historial de juegos</p>
        <RoyalGameHistory games={games} teamsById={teamsById} />
      </div>

      {closed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-(--green)/40 bg-(--green)/10 p-4">
          <div>
            <p className="text-sm font-black uppercase text-white">Noche cerrada</p>
            <p className="mt-1 text-xs text-(--muted)">Los puntos ya se sumaron al ranking historico.</p>
          </div>
          {isAdmin ? (
            <Button variant="secondary" onClick={reopenNight}>
              <X size={16} />
              Eliminar resultado
            </Button>
          ) : null}
        </div>
      ) : isAdmin && !inProgress && teams.length === 3 ? (
        <div className="space-y-2 rounded-md border border-(--border) bg-white/[0.04] p-4">
          <p className="text-sm font-black uppercase text-white">Cerrar la noche</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {teams.map((team) => (
              <label key={team.id} className="space-y-1 text-xs font-bold text-(--muted)">
                <span>{team.name}</span>
                <select
                  value={finalRanks[team.id] ?? ""}
                  onChange={(event) => setFinalRanks((current) => ({ ...current, [team.id]: event.target.value ? (Number(event.target.value) as 1 | 2 | 3) : "" }))}
                  className="h-9 w-full rounded-md border border-(--border) bg-(--panel-strong) px-2 text-sm text-white outline-none"
                >
                  <option value="">Sin definir</option>
                  <option value={1}>1° · Campeon</option>
                  <option value={2}>2° lugar</option>
                  <option value={3}>3° lugar</option>
                </select>
              </label>
            ))}
          </div>
          <Button onClick={closeNight}><Trophy size={16} />Cerrar noche y otorgar puntos</Button>
        </div>
      ) : null}
    </Card>
  );
}

export function MatchDetailPage({ id, initialData }: { id: string } & InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [isPending, startTransition] = useTransition();
  const match = data.matches.find((item) => item.id === id);
  const result = data.results.find((item) => item.matchId === id);
  const [rows, setRows] = useState(() => data.matchPlayers.filter((row) => row.matchId === id));
  const [winner, setWinner] = useState<MatchResult["winner"]>(result?.winner ?? "draw");
  const [resultNotes, setResultNotes] = useState(result?.notes ?? "");
  const [editingMatch, setEditingMatch] = useState<Pick<Match, "date" | "time" | "location" | "matchFormat"> | null>(null);
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [associatingRowId, setAssociatingRowId] = useState<string | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const standings = useMemo(() => buildPlayerStandings(data), [data]);

  if (!match) return <PageTitle title="Partido no encontrado" description="No existe en la base de datos." />;
  const currentMatch = match;
  const isRoyal = currentMatch.matchFormat === "rey_de_la_cancha";
  const { previous, next } = adjacentMatches(data.matches, currentMatch.id);
  const matchTeams = data.matchTeams.filter((team) => team.matchId === currentMatch.id).sort((a, b) => a.seq - b.seq);
  const matchGames = data.matchGames.filter((game) => game.matchId === currentMatch.id);

  function persistRows(nextRows: MatchPlayer[]) {
    setRows(nextRows);
    startTransition(async () => {
      try {
        await saveMatchDetailAction(currentMatch.id, nextRows);
        commit(replaceMatchPlayers(data, currentMatch.id, nextRows));
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo actualizar el partido.");
      }
    });
  }

  function updateRow(index: number, patch: Partial<MatchPlayer>) {
    const nextRows = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row));
    persistRows(nextRows);
  }

  function removeRow(rowId: string) {
    const nextRows = rows.filter((row) => row.id !== rowId);
    persistRows(nextRows);
  }

  function markRowAsOut(rowId: string) {
    const nextRows = rows.map((row) => (
      row.id === rowId
        ? { ...row, attendanceStatus: "out" as AttendanceStatus, team: "none" as Team, updatedAt: new Date().toISOString() }
        : row
    ));
    persistRows(nextRows);
  }

  function rejoinPlayer(rowId: string) {
    const nextOrder = Math.max(0, ...rows.map((row) => row.whatsappOrder || 0)) + 1;
    const nextRows = rows.map((row) => (
      row.id === rowId
        ? { ...row, attendanceStatus: "confirmed" as AttendanceStatus, whatsappOrder: row.whatsappOrder || nextOrder, updatedAt: new Date().toISOString() }
        : row
    ));
    persistRows(nextRows);
  }

  function buildMatchPlayerRow(player: Player): MatchPlayer {
    const now = new Date().toISOString();
    const monthly = isPlayerMonthlyForMonth(player.id, currentMatch.monthKey, data.players, data.monthlyPayments);
    return {
      id: newId("mp"),
      matchId: currentMatch.id,
      playerId: player.id,
      name: player.name,
      phone: player.phone,
      attendanceStatus: "confirmed",
      paymentStatus: monthly ? "paid" : "unpaid",
      amountDue: monthly ? 0 : PER_MATCH_AMOUNT,
      amountPaid: 0,
      note: monthly ? "mensualidad" : "",
      team: "none",
      whatsappOrder: Math.max(0, ...rows.map((row) => row.whatsappOrder || 0)) + 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  function quickConfirmPlayer(player: Player) {
    const existing = rows.find((r) => matchRowBelongsToPlayer(r, player, data.players));
    let nextRows: MatchPlayer[];
    if (existing) {
      nextRows = rows.map((row) => (
        row.id === existing.id
          ? { ...row, attendanceStatus: "confirmed" as AttendanceStatus, updatedAt: new Date().toISOString() }
          : row
      ));
    } else {
      nextRows = [...rows, buildMatchPlayerRow(player)];
    }
    persistRows(nextRows);
  }

  function quickMarkPlayerOut(player: Player) {
    const existing = rows.find((r) => matchRowBelongsToPlayer(r, player, data.players));
    const now = new Date().toISOString();
    let nextRows: MatchPlayer[];
    if (existing) {
      nextRows = rows.map((row) => (
        row.id === existing.id
          ? { ...row, attendanceStatus: "out" as AttendanceStatus, team: "none" as Team, updatedAt: now }
          : row
      ));
    } else {
      const outRow: MatchPlayer = {
        id: newId("mp"),
        matchId: currentMatch.id,
        playerId: player.id,
        name: player.name,
        phone: player.phone,
        attendanceStatus: "out",
        paymentStatus: "paid",
        amountDue: 0,
        amountPaid: 0,
        note: "",
        team: "none",
        whatsappOrder: 0,
        createdAt: now,
        updatedAt: now,
      };
      nextRows = [...rows, outRow];
    }
    persistRows(nextRows);
  }

  function addExistingPlayer(player: Player) {
    persistRows([...rows, buildMatchPlayerRow(player)]);
    setShowAddPlayer(false);
  }

  function createAndAddPlayer(name: string, phone: string) {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const player: Player = { id: newPlayerId(name.trim(), data.players.map((item) => item.id)), name: name.trim(), nickname: name.trim().split(" ")[0], phone: phone.trim(), paymentPlan: "perMatch", skillLevel: 3, active: true, shortName: name.trim().slice(0, 3).toUpperCase(), isGoalkeeper: name.toLowerCase().includes("arquero"), createdAt: now, updatedAt: now };
    savePlayerAction(player)
      .then(() => {
        commit(upsertPlayer(data, player));
        setRows((current) => [...current, buildMatchPlayerRow(player)]);
        setShowAddPlayer(false);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo crear el jugador."));
  }

  function associatePlayer(player: Player) {
    const row = rows.find((item) => item.id === associatingRowId);
    if (!row) return;
    const updatedPlayer = addPlayerAlias(player, row.name);
    const nextRows = rows.map((item) => item.id === row.id ? { ...item, playerId: player.id, name: player.name, updatedAt: new Date().toISOString() } : item);
    Promise.all([savePlayerAction(updatedPlayer), saveMatchDetailAction(currentMatch.id, nextRows)])
      .then(() => {
        commit(replaceMatchPlayers(upsertPlayer(data, updatedPlayer), currentMatch.id, nextRows));
        setRows(nextRows);
        setAssociatingRowId(null);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo asociar el jugador."));
  }

  function save() {
    startTransition(async () => {
      try {
        await saveMatchDetailAction(currentMatch.id, rows);
        commit(replaceMatchPlayers(data, currentMatch.id, rows));
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el partido.");
      }
    });
  }

  function saveResult() {
    const nextResult: MatchResult = {
      id: result?.id ?? newId("result"),
      matchId: currentMatch.id,
      scoreA: winner === "A" ? 1 : 0,
      scoreB: winner === "B" ? 1 : 0,
      winner,
      notes: resultNotes,
    };
    startTransition(async () => {
      try {
        await saveMatchDetailAction(currentMatch.id, rows, nextResult);
        const nextData = replaceMatchPlayers(data, currentMatch.id, rows);
        commit(upsertResult(nextData, nextResult));
        setShowResultModal(false);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el resultado.");
      }
    });
  }

  function saveMatchInfo() {
    if (!editingMatch) return;
    const nextMatch: Match = {
      ...currentMatch,
      ...editingMatch,
      weekLabel: weekLabel(editingMatch.date),
      monthKey: monthKey(editingMatch.date),
      updatedAt: new Date().toISOString(),
    };
    const switchingToRoyal = editingMatch.matchFormat === "rey_de_la_cancha" && matchTeams.length === 0;
    const now = nextMatch.updatedAt;
    const newTeams: MatchTeam[] = switchingToRoyal
      ? [0, 1, 2].map((index) => ({
          id: newId("team"),
          matchId: currentMatch.id,
          name: `Equipo ${index + 1}`,
          color: MATCH_TEAM_DEFAULT_COLORS[index],
          seq: index + 1,
          createdAt: now,
          updatedAt: now,
        }))
      : [];
    const nextRows = switchingToRoyal
      ? applyBalancedRoyalTeams(rows, data.players, standings, newTeams.map((team) => team.id) as [string, string, string])
      : rows;
    startTransition(async () => {
      try {
        await saveMatchAction(nextMatch, nextRows, switchingToRoyal ? newTeams : undefined);
        commit({
          ...replaceMatchPlayers(upsertMatch(data, nextMatch), currentMatch.id, nextRows),
          matchTeams: switchingToRoyal ? [...data.matchTeams, ...newTeams] : data.matchTeams,
        });
        if (switchingToRoyal) setRows(nextRows);
        setEditingMatch(null);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo actualizar el partido.");
      }
    });
  }

  return (
    <>
      <MatchHero
        match={currentMatch}
        rows={rows}
        result={result}
        matchTeams={matchTeams}
        players={data.players}
        standings={standings}
        isAdmin={isAdmin}
        onSave={save}
        onEdit={() => setEditingMatch({ date: currentMatch.date, time: currentMatch.time, location: currentMatch.location, matchFormat: currentMatch.matchFormat })}
        isPending={isPending}
        previous={previous}
        next={next}
      />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: equipos y resultado son solo lectura." /> : null}
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}

      {isRoyal ? (
        <RoyalNightPanel
          matchId={currentMatch.id}
          teams={matchTeams}
          games={matchGames}
          rows={rows}
          players={data.players}
          standings={standings}
          isAdmin={isAdmin}
          commit={commit}
          data={data}
        />
      ) : null}

      {editingMatch ? (
        <Modal title="Editar partido" onClose={() => setEditingMatch(null)}>
          <div className="space-y-4">
            <p className="text-sm text-(--muted)">Actualiza la fecha, hora, ubicacion o formato del partido.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Fecha" type="date" value={editingMatch.date} onChange={(date) => setEditingMatch({ ...editingMatch, date })} />
              <Input label="Hora" type="time" value={editingMatch.time} onChange={(time) => setEditingMatch({ ...editingMatch, time })} />
            </div>
            <Input label="Ubicacion" value={editingMatch.location} onChange={(location) => setEditingMatch({ ...editingMatch, location })} />
            <div className="space-y-1">
              <p className="text-sm font-medium text-(--muted)">Formato</p>
              <div className="inline-flex rounded-md border border-(--border) bg-white/[0.04] p-1 text-sm font-bold">
                <button
                  type="button"
                  onClick={() => setEditingMatch({ ...editingMatch, matchFormat: "clasico" })}
                  className={`rounded px-3 py-1.5 transition ${editingMatch.matchFormat === "clasico" ? "bg-(--green) text-black" : "text-(--muted) hover:text-white"}`}
                >
                  Clasico (2 equipos)
                </button>
                <button
                  type="button"
                  onClick={() => setEditingMatch({ ...editingMatch, matchFormat: "rey_de_la_cancha" })}
                  className={`rounded px-3 py-1.5 transition ${editingMatch.matchFormat === "rey_de_la_cancha" ? "bg-(--green) text-black" : "text-(--muted) hover:text-white"}`}
                >
                  Rey de la Cancha (3 equipos)
                </button>
              </div>
              {editingMatch.matchFormat === "rey_de_la_cancha" && currentMatch.matchFormat !== "rey_de_la_cancha" ? (
                <p className="text-xs text-(--gold)">Se van a crear 3 equipos nuevos y se va a repartir a los jugadores confirmados por ranking. Podras renombrar los equipos y mover jugadores despues de guardar.</p>
              ) : null}
              {editingMatch.matchFormat === "clasico" && currentMatch.matchFormat === "rey_de_la_cancha" ? (
                <p className="text-xs text-(--gold)">Los equipos y juegos de Rey de la Cancha ya registrados quedan guardados pero dejan de mostrarse; el partido vuelve a usar equipos Rojo/Amarillo.</p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditingMatch(null)}>Cancelar</Button>
              <Button onClick={saveMatchInfo} disabled={isPending}><Save size={16} />Guardar cambios</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Resultado */}
      {!isRoyal && !matchIsUpcoming(currentMatch) ? (
        <div className="mt-4">
          {result ? (
            <Card className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Resultado final</p>
                <p className={`mt-1 text-xl font-black ${result.winner === "A" ? "text-(--red)" : result.winner === "B" ? "text-(--gold)" : "text-white"}`}>
                  {result.winner === "draw" ? "Empate" : `Ganó el equipo ${teamLabel(result.winner)}`}
                </p>
              </div>
              {isAdmin ? (
                <Button variant="secondary" onClick={() => setShowResultModal(true)}>
                  <Pencil size={16} />
                  Editar
                </Button>
              ) : null}
            </Card>
          ) : isAdmin ? (
            <Button onClick={() => setShowResultModal(true)}>
              <Trophy size={16} />
              Registrar resultado
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card className="mt-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Plantel</p>
            <h2 className="mt-1 text-xl font-black text-white">{isAdmin ? "Jugadores y asistencia" : "Plantel y asistencia"}</h2>
          </div>
        </div>
        {isAdmin ? (
          <TeamAssignmentBoard
            rows={rows}
            players={data.players}
            allMatchPlayers={data.matchPlayers}
            standings={standings}
            match={currentMatch}
            monthlyPayments={data.monthlyPayments}
            onOpenDetails={(rowId) => setEditingIndex(rows.findIndex((row) => row.id === rowId))}
            onMarkOut={markRowAsOut}
            onRejoin={rejoinPlayer}
            onRemove={removeRow}
            onAddPlayer={() => setShowAddPlayer(true)}
            onAssociate={setAssociatingRowId}
            onQuickConfirmPlayer={quickConfirmPlayer}
            onQuickMarkPlayerOut={quickMarkPlayerOut}
          />
        ) : (
          <PublicMatchRows
            rows={rows}
            players={data.players}
            allMatchPlayers={data.matchPlayers}
            standings={standings}
            match={currentMatch}
            monthlyPayments={data.monthlyPayments}
          />
        )}
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <CopyBlock title="Resumen de equipos" text={isRoyal ? royalTeamsMessage(currentMatch, matchTeams, rows) : teamsMessage(currentMatch, rows)} />
        <CopyBlock title="Resumen del partido" text={matchSummaryMessage(currentMatch, rows, data.players, data.monthlyPayments)} />
      </div>

      {/* Equipos informativos al final */}
      {!isRoyal && hasTeamsAssigned(rows) ? (
        <Card className="mt-4 space-y-3">
          <h2 className="font-bold text-white text-lg">Equipos Definidos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-md border border-(--red)/35 bg-(--red)/5 p-3">
              <p className="text-sm font-bold text-(--red)">Equipo Rojo ({rows.filter(r => r.team === "A" && r.attendanceStatus === "confirmed").length}) - {rows.filter(r => r.team === "A" && r.attendanceStatus === "confirmed").reduce((sum, r) => sum + (standingForMatchRow(r, data.players, standings)?.points ?? 0), 0)} pts</p>
              <ul className="space-y-1.5">
                {rows.filter(r => r.team === "A" && r.attendanceStatus === "confirmed").map((r) => {
                  const isArq = playerForMatchRow(r, data.players)?.isGoalkeeper === true;
                  return (
                    <li key={r.id} className="text-sm text-white flex items-center gap-1.5">
                      • {r.name}
                      {isArq ? (
                        <span className="inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-500 uppercase tracking-wider gap-0.5" title="Arquero">
                          🧤 ARQ
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="space-y-2 rounded-md border border-(--gold)/35 bg-(--gold)/5 p-3">
              <p className="text-sm font-bold text-(--gold)">Equipo Amarillo ({rows.filter(r => r.team === "B" && r.attendanceStatus === "confirmed").length}) - {rows.filter(r => r.team === "B" && r.attendanceStatus === "confirmed").reduce((sum, r) => sum + (standingForMatchRow(r, data.players, standings)?.points ?? 0), 0)} pts</p>
              <ul className="space-y-1.5">
                {rows.filter(r => r.team === "B" && r.attendanceStatus === "confirmed").map((r) => {
                  const isArq = playerForMatchRow(r, data.players)?.isGoalkeeper === true;
                  return (
                    <li key={r.id} className="text-sm text-white flex items-center gap-1.5">
                      • {r.name}
                      {isArq ? (
                        <span className="inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-500 uppercase tracking-wider gap-0.5" title="Arquero">
                          🧤 ARQ
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      {editingIndex !== null ? (
        <PlayerDetailModal
          row={rows[editingIndex]}
          onClose={() => setEditingIndex(null)}
          onSave={(patch) => {
            updateRow(editingIndex, patch);
            setEditingIndex(null);
          }}
          onAssociate={() => {
            const rowId = rows[editingIndex].id;
            setEditingIndex(null);
            setAssociatingRowId(rowId);
          }}
        />
      ) : null}

      {showAddPlayer ? (
        <AddPlayerModal
          candidates={data.players.filter((player) => player.active && !rows.some((row) => row.playerId === player.id))}
          onClose={() => setShowAddPlayer(false)}
          onAddExisting={addExistingPlayer}
          onCreateAndAdd={createAndAddPlayer}
        />
      ) : null}
      {associatingRowId ? (
        <AssociatePlayerModal
          row={rows.find((item) => item.id === associatingRowId)}
          candidates={data.players}
          matchPlayers={data.matchPlayers}
          onClose={() => setAssociatingRowId(null)}
          onAssociate={associatePlayer}
        />
      ) : null}

      {showResultModal ? (
        <ResultModal
          winner={winner}
          onWinnerChange={setWinner}
          notes={resultNotes}
          onNotesChange={setResultNotes}
          onSave={saveResult}
          onClose={() => setShowResultModal(false)}
          isPending={isPending}
        />
      ) : null}
    </>
  );
}

function ResultModal({
  winner,
  onWinnerChange,
  notes,
  onNotesChange,
  onSave,
  onClose,
  isPending,
}: {
  winner: MatchResult["winner"];
  onWinnerChange: (w: MatchResult["winner"]) => void;
  notes: string;
  onNotesChange: (n: string) => void;
  onSave: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  return (
    <Modal title="Resultado final" onClose={onClose}>
      <div className="space-y-4 pb-2">
        <p className="text-sm text-(--muted)">Elige el equipo ganador o empate. No se registran goles.</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onWinnerChange("A")}
            className={`flex flex-col items-center gap-1 rounded-xl border p-4 transition active:scale-95 ${winner === "A" ? "border-(--red) bg-(--red)/25" : "border-(--red)/40 bg-(--red)/10 hover:bg-(--red)/20"}`}
          >
            <span className="text-xs font-black uppercase tracking-wide text-(--red)">Rojo</span>
            <span className={`mt-1 text-sm font-black ${winner === "A" ? "text-(--red)" : "text-white"}`}>Gana</span>
          </button>
          <button
            type="button"
            onClick={() => onWinnerChange("draw")}
            className={`flex flex-col items-center gap-1 rounded-xl border p-4 transition active:scale-95 ${winner === "draw" ? "border-white bg-white/15" : "border-white/20 bg-white/[0.05] hover:bg-white/[0.10]"}`}
          >
            <span className="text-xs font-black uppercase tracking-wide text-(--muted)">VS</span>
            <span className={`mt-1 text-sm font-black ${winner === "draw" ? "text-white" : "text-(--muted)"}`}>Empate</span>
          </button>
          <button
            type="button"
            onClick={() => onWinnerChange("B")}
            className={`flex flex-col items-center gap-1 rounded-xl border p-4 transition active:scale-95 ${winner === "B" ? "border-(--gold) bg-(--gold)/25" : "border-(--gold)/40 bg-(--gold)/10 hover:bg-(--gold)/20"}`}
          >
            <span className="text-xs font-black uppercase tracking-wide text-(--gold)">Amarillo</span>
            <span className={`mt-1 text-sm font-black ${winner === "B" ? "text-(--gold)" : "text-white"}`}>Gana</span>
          </button>
        </div>
        <textarea
          className="min-h-16 w-full rounded-md border border-(--border) bg-(--panel-strong) p-3 text-sm text-white placeholder:text-(--muted)"
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="Notas del resultado (opcional)"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSave} disabled={isPending}><Save size={16} />Guardar resultado</Button>
        </div>
      </div>
    </Modal>
  );
}

export function PaymentsPage({ initialData }: InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [error, setError] = useState("");
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [editingGuestName, setEditingGuestName] = useState<string | null>(null);
  const month = currentMonthKey();
  const [planYear, setPlanYear] = useState(() => Number(month.slice(0, 4)));
  const [rosterMonth, setRosterMonth] = useState(month);
  const monthlyPlayers = data.players
    .filter((player) => player.active && (player.paymentPlan === "monthly" || data.monthlyPayments.some((payment) => payment.playerId === player.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const allMonthlyPayments = data.monthlyPayments;
  const rosterHasExplicitData = data.monthlyPayments.some((payment) => payment.monthKey === rosterMonth);
  const currentMonthlyPayments = allMonthlyPayments
    .filter((payment) => payment.monthKey === month)
    .sort((a, b) => {
      const playerA = data.players.find((player) => player.id === a.playerId)?.name ?? "";
      const playerB = data.players.find((player) => player.id === b.playerId)?.name ?? "";
      return playerA.localeCompare(playerB);
    });
  const perMatchPending = data.matchPlayers.filter((row) => row.amountDue > row.amountPaid);
  const courtBalance = data.clubFinance.prepaidTotal - data.matches.filter((match) => match.courtPrepaid).reduce((sum, match) => sum + match.courtCost, 0);
  const collected = totalPayments(allMonthlyPayments, data.matchPlayers);
  const pending = pendingPayments(currentMonthlyPayments, perMatchPending);
  const expenseTotal = data.clubExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const balance = collected - expenseTotal;
  const projectedBalance = balance + pending;
  const expenses = [...data.clubExpenses].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || a.label.localeCompare(b.label));
  const financeSummary = monthlyFinanceSummary(planYear, data);

  function markPaid(row: MatchPlayer) {
    const updated = { ...row, paymentStatus: "paid" as const, amountPaid: row.amountDue, updatedAt: new Date().toISOString() };
    markMatchPlayerPaidAction(row.id)
      .then(() => commit({ ...data, matchPlayers: data.matchPlayers.map((item) => (item.id === row.id ? updated : item)) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo marcar como pagado."));
  }

  function toggleMonthly(player: Player, monthKey: string, paid: boolean) {
    const existing = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey);
    const base = monthlyPaymentFor(player, monthKey, existing);
    const now = new Date().toISOString();
    const updated: MonthlyPayment = paid
      ? { ...base, paymentStatus: "unpaid", amountPaid: 0, paidAt: undefined, updatedAt: now }
      : { ...base, paymentStatus: "paid", amountPaid: base.expectedAmount, paidAt: now, updatedAt: now };
    saveMonthlyPaymentAction(updated)
      .then(() => commit({ ...data, monthlyPayments: upsertMonthlyPayment(data.monthlyPayments, updated) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo registrar el pago."));
  }

  function toggleRosterMembership(player: Player, monthKey: string, shouldBeMonthly: boolean) {
    if (shouldBeMonthly) {
      const payment = monthlyPaymentFor(player, monthKey, data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey));
      saveMonthlyPaymentAction(payment)
        .then(() => commit({ ...data, monthlyPayments: upsertMonthlyPayment(data.monthlyPayments, payment) }))
        .catch((err) => setError(err instanceof Error ? err.message : "No se pudo agregar al roster de fijos."));
      return;
    }
    removeMonthlyPaymentAction(player.id, monthKey)
      .then(() => commit({ ...data, monthlyPayments: data.monthlyPayments.filter((item) => !(item.playerId === player.id && item.monthKey === monthKey)) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo quitar del roster de fijos."));
  }

  function initRosterFromSuggested(monthKey: string) {
    const suggested = data.players.filter((player) => player.active && isPlayerMonthlyForMonth(player.id, monthKey, data.players, data.monthlyPayments));
    Promise.all(suggested.map((player) => {
      const payment = monthlyPaymentFor(player, monthKey, data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey));
      return saveMonthlyPaymentAction(payment).then(() => payment);
    }))
      .then((payments) => {
        commit({ ...data, monthlyPayments: payments.reduce((acc, payment) => upsertMonthlyPayment(acc, payment), data.monthlyPayments) });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el roster sugerido."));
  }

  function startEditMonthly(player: Player) {
    setEditingPlayer(player);
    setEditingGuestName(null);
  }

  function startEditGalleta(name: string, key: string) {
    const isGuest = key.startsWith("name:");
    const existing = isGuest ? null : data.players.find((p) => p.id === key);
    if (existing) {
      setEditingPlayer(existing);
      setEditingGuestName(null);
    } else {
      const now = new Date().toISOString();
      setEditingPlayer({
        id: newPlayerId(name, data.players.map((item) => item.id)),
        name: name,
        nickname: name.split(" ")[0],
        phone: "",
        paymentPlan: "perMatch",
        skillLevel: 3,
        active: true,
        shortName: name.slice(0, 3).toUpperCase(),
        isGoalkeeper: name.toLowerCase().includes("arquero"),
        createdAt: now,
        updatedAt: now,
      });
      setEditingGuestName(name);
    }
  }

  function savePlayer(patch: Partial<Player>) {
    if (!editingPlayer) return;
    const updated = { ...editingPlayer, ...patch, updatedAt: new Date().toISOString() };
    savePlayerAction(updated, editingGuestName || undefined)
      .then(() => {
        let nextData = upsertPlayer(data, updated);
        if (editingGuestName) {
          nextData = {
            ...nextData,
            matchPlayers: nextData.matchPlayers.map((mp) => {
              if (mp.playerId === null || mp.playerId === undefined) {
                if (mp.name.toLowerCase() === editingGuestName.toLowerCase()) {
                  return { ...mp, playerId: updated.id, name: updated.name, updatedAt: updated.updatedAt };
                }
              }
              return mp;
            }),
          };
        } else {
          nextData = {
            ...nextData,
            matchPlayers: nextData.matchPlayers.map((mp) => {
              if (mp.playerId === updated.id) {
                return { ...mp, name: updated.name, updatedAt: updated.updatedAt };
              }
              return mp;
            }),
          };
        }
        commit(nextData);
        setEditingPlayer(null);
        setEditingGuestName(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el jugador."));
  }

  return (
    <>
      <PageTitle
        title="Pagos"
        description={`Mensualidades con vencimiento los dias 10, pagos por partido y balance del club.`}
        action={<CtaLink href={`/payments/resumen?date=${month}`}><WalletCards size={16} />Resumen mensual</CtaLink>}
      />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: el marcado de pagos queda reservado para admin." /> : null}
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Cobrado" value={formatCurrency(collected)} />
        <Stat label="Gastado" value={formatCurrency(expenseTotal)} />
        <Stat label="Balance" value={formatCurrency(balance)} />
        <Stat label="Proyectado" value={formatCurrency(projectedBalance)} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_0.7fr]">
        <PaymentAccountCard data={data} />
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-(--muted)">Cancha</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(data.clubFinance.prepaidTotal)}</p>
          <p className="mt-1 text-sm text-(--muted)">Pagado para {data.clubFinance.prepaidCourts} fechas. Saldo referencial: {formatCurrency(courtBalance)}.</p>
          <p className="mt-3 rounded-md bg-(--cyan)/15 px-3 py-2 text-sm font-bold text-(--cyan)">Por cobrar ahora: {formatCurrency(pending)}.</p>
        </Card>
      </div>
      {isAdmin ? (
        <div className="mb-4">
          <MonthlyRosterEditor
            players={data.players}
            monthlyPayments={data.monthlyPayments}
            monthKey={rosterMonth}
            onMonthChange={setRosterMonth}
            hasExplicitRoster={rosterHasExplicitData}
            onInit={() => initRosterFromSuggested(rosterMonth)}
            onToggle={(player, shouldBeMonthly) => toggleRosterMembership(player, rosterMonth, shouldBeMonthly)}
          />
        </div>
      ) : null}
      <div className="mb-4">
        <MonthlyPaymentPlan
          players={monthlyPlayers}
          payments={data.monthlyPayments}
          year={planYear}
          currentMonthKey={month}
          isAdmin={isAdmin}
          onToggle={toggleMonthly}
          onYear={setPlanYear}
          financeSummary={financeSummary}
          onEdit={startEditMonthly}
        />
      </div>
      <div className="mb-4">
        <GalletaMatchBreakdown data={data} isAdmin={isAdmin} onMarkPaid={markPaid} onEdit={startEditGalleta} />
      </div>
      {editingPlayer ? (
        <Modal title={editingGuestName ? `Registrar ${editingGuestName}` : `Editar ${editingPlayer.name}`} onClose={() => { setEditingPlayer(null); setEditingGuestName(null); }}>
          <PlayerEditorForm player={editingPlayer} onSave={savePlayer} players={data.players} />
        </Modal>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-3 xl:col-span-2">
          <div>
            <h2 className="font-semibold">Gastos registrados</h2>
            <p className="text-sm text-(--muted)">Incluye cancha, pelota nueva y petos para que el balance vaya fluyendo con lo cobrado.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {expenses.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function MonthlyRosterEditor({
  players,
  monthlyPayments,
  monthKey,
  onMonthChange,
  hasExplicitRoster,
  onInit,
  onToggle,
}: {
  players: Player[];
  monthlyPayments: MonthlyPayment[];
  monthKey: string;
  onMonthChange: (monthKey: string) => void;
  hasExplicitRoster: boolean;
  onInit: () => void;
  onToggle: (player: Player, shouldBeMonthly: boolean) => void;
}) {
  const activePlayers = [...players].filter((player) => player.active).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Card className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-(--cyan)">Renovacion mensual</p>
          <h2 className="mt-1 text-xl font-black text-white">Roster fijo de {monthLabel(monthKey)}</h2>
          <p className="mt-1 text-sm text-(--muted)">Marca quien va como fijo este mes. El resto queda como galleta (paga por partido).</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMonthChange(shiftMonthKey(monthKey, -1))} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] text-white transition hover:bg-white/[0.12]" aria-label="Mes anterior">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-24 rounded-md border border-(--border) bg-white/[0.04] px-3 py-1.5 text-center text-sm font-black text-white">{monthKey}</span>
          <button type="button" onClick={() => onMonthChange(shiftMonthKey(monthKey, 1))} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] text-white transition hover:bg-white/[0.12]" aria-label="Mes siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {!hasExplicitRoster ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-(--gold)/40 bg-(--gold)/10 px-3 py-2">
          <p className="text-sm text-(--gold)">Este mes aun no tiene roster propio: se muestra el plan por defecto de cada jugador.</p>
          <Button variant="secondary" onClick={onInit}>Guardar roster sugerido</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {activePlayers.map((player) => {
          const checked = isPlayerMonthlyForMonth(player.id, monthKey, players, monthlyPayments);
          return (
            <label
              key={player.id}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition ${
                checked ? "border-(--cyan)/50 bg-(--cyan)/15 text-(--cyan)" : "border-(--border) bg-white/[0.03] text-(--muted)"
              }`}
            >
              <input type="checkbox" className="accent-(--cyan)" checked={checked} onChange={(event) => onToggle(player, event.target.checked)} />
              {player.name}
            </label>
          );
        })}
      </div>
    </Card>
  );
}

function MonthlyPaymentPlan({
  players,
  payments,
  year,
  currentMonthKey,
  isAdmin,
  onToggle,
  onYear,
  financeSummary,
  onEdit,
}: {
  players: Player[];
  payments: MonthlyPayment[];
  year: number;
  currentMonthKey: string;
  isAdmin: boolean;
  onToggle: (player: Player, monthKey: string, paid: boolean) => void;
  onYear: (year: number) => void;
  financeSummary: MonthlyFinanceRow[];
  onEdit?: (player: Player) => void;
}) {
  const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
  return (
    <Card className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-(--cyan)">Plan de pagos mensual</p>
          <h2 className="mt-1 text-xl font-black text-white">Calendario {year}</h2>
          <p className="mt-1 text-sm text-(--muted)">Cuota de {formatCurrency(MONTHLY_AMOUNT)}, vence el 10 de cada mes. {isAdmin ? "Marca cada mes cuando el jugador paga: queda registrada la fecha." : "Verde pagado, rojo pendiente."}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onYear(year - 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] text-white transition hover:bg-white/[0.12]" aria-label="Ano anterior">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-16 rounded-md border border-(--border) bg-white/[0.04] px-3 py-1.5 text-center text-sm font-black text-white">{year}</span>
          <button type="button" onClick={() => onYear(year + 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--border) bg-white/[0.06] text-white transition hover:bg-white/[0.12]" aria-label="Ano siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="pr-2 text-left text-[11px] font-black uppercase tracking-wide text-(--muted)">Jugador</th>
              {MONTH_ABBR.map((label) => (
                <th key={label} className="text-center text-[11px] font-bold uppercase text-(--muted)">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={player.id}>
                <td className="whitespace-nowrap pr-2 font-semibold text-white">
                  <div className="flex items-center gap-1.5">
                    <span>{player.name}</span>
                    {isAdmin && onEdit ? (
                      <button
                        type="button"
                        onClick={() => onEdit(player)}
                        className="text-(--muted) hover:text-white transition"
                        title="Editar jugador"
                      >
                        <Pencil size={12} />
                      </button>
                    ) : null}
                  </div>
                </td>
                {months.map((mm) => {
                  const key = `${year}-${mm}`;
                  const payment = payments.find((item) => item.playerId === player.id && item.monthKey === key);
                  const paid = payment?.paymentStatus === "paid";
                  const future = key > currentMonthKey;
                  const title = paid
                    ? `Pagado${payment?.paidAt ? ` el ${payment.paidAt.slice(0, 10)}` : ""}`
                    : future
                      ? "Mes futuro"
                      : "Pendiente";
                  const cls = paid
                    ? "border-(--green) bg-(--green)/20 text-(--green)"
                    : future
                      ? "border-(--border) bg-white/[0.02] text-(--muted)"
                      : "border-(--red)/35 bg-(--red)/10 text-(--red)";
                  return (
                    <td key={mm} className="text-center">
                      <button
                        type="button"
                        disabled={!isAdmin || future}
                        title={title}
                        onClick={() => onToggle(player, key, paid)}
                        className={`h-8 w-full min-w-9 rounded-md border text-xs font-black transition disabled:cursor-not-allowed ${cls} ${isAdmin && !future ? "hover:opacity-80" : ""}`}
                      >
                        {paid ? "✓" : future ? "·" : "✗"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {players.length === 0 ? (
              <tr>
                <td colSpan={13} className="py-2 text-sm text-(--muted)">No hay jugadores mensuales activos.</td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={13} className="pt-3 pb-1 text-[11px] font-black uppercase tracking-wide text-(--muted)">Flujo del club</td>
            </tr>
            <FinanceRow label="Ingresos galletas" values={financeSummary.map((row) => row.galletas)} tone="green" />
            <FinanceRow label="Ingresos mensuales" values={financeSummary.map((row) => row.mensual)} tone="green" />
            <FinanceRow label="Gastos cancha" values={financeSummary.map((row) => -row.gastosCancha)} tone="red" />
            <FinanceRow label="Otros gastos" values={financeSummary.map((row) => -row.otrosGastos)} tone="red" />
            <FinanceRow label="Total acumulado" values={financeSummary.map((row) => row.running)} tone="auto" bold />
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FinanceRow({
  label,
  values,
  tone,
  bold,
}: {
  label: string;
  values: number[];
  tone: "green" | "red" | "auto";
  bold?: boolean;
}) {
  return (
    <tr>
      <td className={`whitespace-nowrap pr-2 text-xs ${bold ? "font-black text-white" : "font-semibold text-(--muted)"}`}>{label}</td>
      {values.map((value, index) => {
        const color = tone === "auto" ? (value >= 0 ? "text-(--green)" : "text-(--red)") : tone === "green" ? "text-(--green)" : "text-(--red)";
        return (
          <td key={index} className={`whitespace-nowrap text-center text-[11px] ${bold ? "font-black" : "font-bold"} ${color}`}>
            {value === 0 && !bold ? "-" : formatCurrency(value)}
          </td>
        );
      })}
    </tr>
  );
}

function isGalletaRow(row: MatchPlayer, players: Player[], monthKey: string, monthlyPayments: MonthlyPayment[]) {
  return !isMonthlyMatchRow(row, players, monthKey, monthlyPayments);
}

function recentMonthKeys(count: number) {
  const now = new Date();
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchDateLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return `${parsed.getDate()} ${MONTH_ABBR[parsed.getMonth()].toLowerCase()}`;
}

type GalletaPlayerRow = {
  key: string;
  name: string;
  byMatch: Map<string, MatchPlayer>;
  pending: number;
};

function GalletaMatchBreakdown({
  data,
  isAdmin,
  onMarkPaid,
  onEdit,
}: {
  data: SifupData;
  isAdmin: boolean;
  onMarkPaid: (row: MatchPlayer) => void;
  onEdit?: (name: string, key: string) => void;
}) {
  const allowedMonths = new Set(recentMonthKeys(4));
  const matches = [...data.matches].filter((match) => allowedMonths.has(match.monthKey)).sort((a, b) => a.date.localeCompare(b.date));

  const playersByKey = new Map<string, GalletaPlayerRow>();
  for (const match of matches) {
    const rows = data.matchPlayers.filter((row) => row.matchId === match.id && isGalletaRow(row, data.players, match.monthKey, data.monthlyPayments));
    for (const row of rows) {
      const key = row.playerId ?? `name:${normalizeName(row.name)}`;
      const entry = playersByKey.get(key) ?? { key, name: row.name, byMatch: new Map(), pending: 0 };
      entry.byMatch.set(match.id, row);
      if (row.attendanceStatus !== "out") entry.pending += Math.max(row.amountDue - row.amountPaid, 0);
      playersByKey.set(key, entry);
    }
  }
  const players = [...playersByKey.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">Galletas por partido</h2>
        <p className="text-sm text-(--muted)">Cobro por partido de los ultimos meses. {isAdmin ? "Toca una celda pendiente para marcarla pagada." : ""}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-x-1 border-spacing-y-1.5 text-sm">
          <thead>
            <tr>
              <th className="pr-2 text-left text-[11px] font-black uppercase tracking-wide text-(--muted)">Jugador</th>
              {matches.map((match) => (
                <th key={match.id} title={match.weekLabel} className="text-center text-[11px] font-bold uppercase text-(--muted)">
                  <Link href={`/matches/${match.id}`} className="hover:text-(--cyan)">{matchDateLabel(match.date)}</Link>
                </th>
              ))}
              <th className="text-center text-[11px] font-black uppercase tracking-wide text-(--muted)">Total</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={player.key}>
                <td className="whitespace-nowrap pr-2">
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <span>{player.name}</span>
                    {player.pending > 0 ? <span className="font-bold text-(--red)">({formatCurrency(player.pending)})</span> : null}
                    {isAdmin && onEdit ? (
                      <button
                        type="button"
                        onClick={() => onEdit(player.name, player.key)}
                        className="text-(--muted) hover:text-white transition"
                        title="Editar o registrar jugador"
                      >
                        <Pencil size={12} />
                      </button>
                    ) : null}
                  </div>
                </td>
                {matches.map((match) => {
                  const row = player.byMatch.get(match.id);
                  const played = row && row.attendanceStatus !== "out";
                  const paid = played && row.paymentStatus === "paid";
                  const pending = played ? Math.max(row.amountDue - row.amountPaid, 0) : 0;
                  const title = !played
                    ? "No jugo este partido"
                    : paid
                      ? `Pagado ${formatCurrency(row.amountPaid)}`
                      : `Pendiente ${formatCurrency(pending)}${isAdmin ? " - toca para marcar pagado" : ""}`;
                  const cls = !played
                    ? "border-(--border) bg-white/[0.02] text-(--muted)"
                    : paid
                      ? "border-(--green)/35 bg-(--green)/15 text-(--green)"
                      : "border-(--red)/35 bg-(--red)/10 text-(--red)";
                  return (
                    <td key={match.id} className="text-center">
                      <button
                        type="button"
                        disabled={!played || paid || !isAdmin}
                        title={title}
                        onClick={() => row && onMarkPaid(row)}
                        className={`h-8 w-9 rounded-md border text-xs font-black transition disabled:cursor-not-allowed ${cls} ${isAdmin && played && !paid ? "hover:opacity-80" : ""}`}
                      >
                        {!played ? "-" : paid ? "✓" : "✗"}
                      </button>
                    </td>
                  );
                })}
                <td className={`text-center text-sm font-black ${player.pending > 0 ? "text-(--red)" : "text-(--green)"}`}>
                  {player.pending > 0 ? formatCurrency(player.pending) : "-"}
                </td>
              </tr>
            ))}
            {players.length === 0 ? (
              <tr>
                <td colSpan={matches.length + 2} className="py-2 text-sm text-(--muted)">No hay galletas registradas en los ultimos meses.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-(--muted)">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-(--green)" />Jugo y pago</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-(--red)" />Jugo, debe{isAdmin ? " (toca para marcar pagado)" : ""}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-white/15" />No jugo ese partido</span>
      </div>
    </Card>
  );
}

function ExpenseRow({ expense }: { expense: ClubExpense }) {
  const category = {
    court: "Cancha",
    equipment: "Equipamiento",
    other: "Otro",
  }[expense.category];
  return (
    <div className="rounded-md border border-(--border) bg-white/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-white">{expense.label}</p>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-(--muted)">{category} - {expense.expenseDate}</p>
        </div>
        <p className="font-black text-white">{formatCurrency(expense.amount)}</p>
      </div>
      {expense.note ? <p className="mt-2 text-sm text-(--muted)">{expense.note}</p> : null}
    </div>
  );
}

export function PlayersPage({ initialData }: InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);

  function addPlayer() {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const player: Player = { id: newPlayerId(name.trim(), data.players.map((item) => item.id)), name: name.trim(), nickname: name.trim().split(" ")[0], phone: "", paymentPlan: "perMatch", skillLevel: 3, active: true, shortName: name.trim().slice(0, 3).toUpperCase(), isGoalkeeper: name.toLowerCase().includes("arquero"), createdAt: now, updatedAt: now };
    savePlayerAction(player)
      .then(() => {
        commit(upsertPlayer(data, player));
        setName("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el jugador."));
  }

  function savePlayer(patch: Partial<Player>) {
    if (!editingPlayer) return;
    const updated = { ...editingPlayer, ...patch, updatedAt: new Date().toISOString() };
    savePlayerAction(updated)
      .then(() => {
        const nextData = {
          ...upsertPlayer(data, updated),
          matchPlayers: data.matchPlayers.map((mp) => {
            if (mp.playerId === updated.id) {
              return { ...mp, name: updated.name, updatedAt: updated.updatedAt };
            }
            return mp;
          }),
        };
        commit(nextData);
        setEditingPlayer(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el jugador."));
  }

  const visiblePlayers = isAdmin ? data.players : data.players.filter((player) => player.active);
  const month = currentMonthKey();

  return (
    <>
      <PageTitle title="Jugadores" description={isAdmin ? "Oficiales: mensualidad del mes actual e historico de pagos. Galletas: deuda acumulada por partido." : "Lista publica de jugadores activos."} />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: telefonos, WhatsApp y edicion quedan ocultos." /> : null}
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      {isAdmin ? <Card className="mb-4 flex gap-2"><input className="h-10 min-w-0 flex-1 rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre del jugador nuevo" /><Button onClick={addPlayer}><Plus size={16} />Agregar</Button></Card> : null}
      <Card className="space-y-3">
        <div>
          <h2 className="font-semibold">Jugadores</h2>
          <p className="text-xs text-(--muted)">Oficiales y galletas en una sola tabla; ordena por cualquier columna.</p>
        </div>
        <PlayerDirectoryTable players={visiblePlayers} data={data} month={month} isAdmin={isAdmin} onEdit={setEditingPlayer} />
      </Card>
      {editingPlayer ? (
        <Modal title={`Editar ${editingPlayer.name}`} onClose={() => setEditingPlayer(null)}>
          <PlayerEditorForm player={editingPlayer} onSave={savePlayer} players={data.players} />
        </Modal>
      ) : null}
    </>
  );
}

function PaymentHistory({ payments }: { payments: MonthlyPayment[] }) {
  const recent = [...payments].sort((a, b) => a.monthKey.localeCompare(b.monthKey)).slice(-6);
  if (recent.length === 0) return null;
  const styles = {
    paid: "bg-(--green)/15 text-(--green)",
    unpaid: "bg-(--red)/15 text-(--red)",
    promised: "bg-(--gold)/15 text-(--gold)",
  };
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {recent.map((payment) => (
        <span
          key={payment.id}
          title={`${payment.monthKey}: ${payment.paymentStatus}`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${styles[payment.paymentStatus]}`}
        >
          {payment.monthKey.slice(5)}
        </span>
      ))}
    </div>
  );
}

type PlayerDirectorySortKey = "position" | "name" | "plan" | "nickname" | "played" | "points" | "status" | "debt";

function PlayerDirectoryTable({ players, data, month, isAdmin, onEdit }: { players: Player[]; data: SifupData; month: string; isAdmin: boolean; onEdit: (player: Player) => void }) {
  const [sort, setSort] = useState<{ key: PlayerDirectorySortKey; direction: "asc" | "desc" }>({ key: "name", direction: "asc" });
  const rows = players.map((player) => {
    const isMonthly = isPlayerMonthlyForMonth(player.id, month, data.players, data.monthlyPayments);
    const payment = isMonthly ? monthlyPaymentFor(player, month, data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === month)) : undefined;
    const debt = isMonthly
      ? data.monthlyPayments.filter((item) => item.playerId === player.id).reduce((sum, item) => sum + Math.max(item.expectedAmount - item.amountPaid, 0), 0)
      : data.matchPlayers.filter((item) => item.playerId === player.id).reduce((sum, item) => sum + Math.max(item.amountDue - item.amountPaid, 0), 0);
    const history = payment ? upsertMonthlyPayment(data.monthlyPayments.filter((item) => item.playerId === player.id), payment) : [];
    const stats = computePlayerStats(player, data);
    return { player, isMonthly, payment, debt, history, played: stats.played, points: stats.points };
  });
  const sortedRows = [...rows].sort((left, right) => {
    const value = (row: typeof rows[number]) => {
      if (sort.key === "position") return row.player.isGoalkeeper ? "Arquero" : "Jugador de campo";
      if (sort.key === "name") return row.player.name;
      if (sort.key === "plan") return row.isMonthly ? "monthly" : "perMatch";
      if (sort.key === "nickname") return row.player.nickname;
      if (sort.key === "played") return row.played;
      if (sort.key === "points") return row.points;
      if (sort.key === "status") return row.payment?.paymentStatus ?? "";
      return row.debt;
    };
    const leftValue = value(left);
    const rightValue = value(right);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue), "es");
    return sort.direction === "asc" ? comparison : -comparison;
  });
  const toggleSort = (key: PlayerDirectorySortKey) => setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const columns: { key: PlayerDirectorySortKey; label: string; className?: string }[] = [
    { key: "position", label: "Posición", className: "text-left" },
    { key: "name", label: "Jugador", className: "text-left" },
    { key: "plan", label: "Tipo" },
    { key: "nickname", label: "Apodo", className: "text-left" },
    { key: "played", label: "PJ" },
    { key: "points", label: "Pts", className: "text-(--gold)" },
    { key: "status", label: "Pago" },
    { key: "debt", label: "Deuda" },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-(--border)">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b border-(--border) bg-white/[0.04] text-[10px] font-black uppercase tracking-wide text-(--muted)">
          <tr>
            {columns.map((column) => {
              const active = sort.key === column.key;
              return <th key={column.key} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 text-center ${column.className ?? ""}`}><button type="button" onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-1 hover:text-white">{column.label}<span aria-hidden="true" className={active ? "text-white" : "text-(--muted)/60"}>{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
            })}
            <th className="px-3 py-2 text-center">Historial</th>
            {isAdmin ? <th className="px-3 py-2 text-center">Acciones</th> : null}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(({ player, isMonthly, payment, debt, history, played, points }) => {
            const whatsapp = whatsappHref(player.phone);
            return <tr key={player.id} className="border-b border-(--border) last:border-0 hover:bg-white/[0.04]">
              <td className="px-3 py-2 text-center"><span aria-label={player.isGoalkeeper ? "Arquero" : "Jugador de campo"} title={player.isGoalkeeper ? "Arquero" : "Jugador de campo"} className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-xl ring-2 ${player.isGoalkeeper ? "bg-amber-400 text-(--bg-deep) ring-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.65)]" : "bg-emerald-950 ring-(--green)/70 shadow-[0_0_12px_rgba(18,214,154,0.35)]"}`}>{player.isGoalkeeper ? "🧤" : "⚽"}</span></td>
              <td className="px-3 py-3 font-bold text-white"><Link href={`/players/${player.id}`} className="hover:underline">{player.name}</Link></td>
              <td className="px-3 py-3 text-center text-xs font-bold text-(--muted)">{isMonthly ? "Oficial" : "Galleta"}</td>
              <td className="px-3 py-3 text-(--muted)">{player.nickname || "Sin pseudónimo"}</td>
              <td className="px-3 py-3 text-center font-bold text-white">{played}</td>
              <td className="px-3 py-3 text-center font-black text-(--gold)">{points}</td>
              <td className="px-3 py-3 text-center">{isMonthly ? <PaymentBadge status={payment?.paymentStatus ?? "unpaid"} /> : <span className="text-xs font-bold text-(--muted)">Por partido</span>}</td>
              <td className={`px-3 py-3 text-center font-bold ${debt > 0 ? "text-(--red)" : "text-(--green)"}`}>{formatCurrency(debt)}</td>
              <td className="px-3 py-3">{isMonthly ? <PaymentHistory payments={history} /> : <span className="text-xs text-(--muted)">—</span>}</td>
              {isAdmin ? <td className="px-3 py-2"><div className="flex justify-center gap-1">{whatsapp ? <a href={whatsapp} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-(--green) hover:bg-(--green)/15" aria-label={`WhatsApp ${player.name}`} title="WhatsApp"><MessageCircle size={16} /></a> : null}<button type="button" onClick={() => onEdit(player)} className="rounded-md p-1.5 text-(--muted) hover:bg-white/[0.14]" aria-label={`Editar ${player.name}`} title="Editar"><Pencil size={16} /></button></div></td> : null}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlayerEditorForm({ player, onSave, players = [], allowMerge = true }: { player: Player; onSave: (patch: Partial<Player>) => void; players?: Player[]; allowMerge?: boolean }) {
  const [draft, setDraft] = useState(draftPlayerWithIsGoalkeeper(player));
  const whatsapp = whatsappHref(draft.phone);

  const [mergeTargetId, setMergeTargetId] = useState("");
  const [isMerging, startMergeTransition] = useTransition();
  const [mergeError, setMergeError] = useState("");

  function draftPlayerWithIsGoalkeeper(p: Player): Player {
    return {
      ...p,
      isGoalkeeper: p.isGoalkeeper || false,
    };
  }

  const otherPlayers = useMemo(() => {
    return players
      .filter((p) => p.id !== player.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [players, player.id]);

  function handleMerge() {
    if (!mergeTargetId) return;
    const target = otherPlayers.find((p) => p.id === mergeTargetId);
    if (!target) return;
    if (!confirm(`¿Estás seguro de fusionar a ${player.name} dentro de ${target.name}? Esta acción es irreversible, moverá todos sus registros y eliminará a ${player.name}.`)) {
      return;
    }

    startMergeTransition(async () => {
      try {
        await mergePlayersAction(player.id, mergeTargetId);
        window.location.reload();
      } catch (err) {
        setMergeError(err instanceof Error ? err.message : "Error al fusionar jugadores.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <Input label="Nombre" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
      <Input label="Pseudonimo" value={draft.nickname} onChange={(value) => setDraft({ ...draft, nickname: value })} />
      <Input label="Sigla (3 caracteres)" value={draft.shortName} onChange={(value) => setDraft({ ...draft, shortName: value.slice(0, 3).toUpperCase() })} />
      <Input label="Telefono" value={draft.phone} onChange={(value) => setDraft({ ...draft, phone: value })} />
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm font-medium text-(--muted)">
          <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
          <span>Activo</span>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-(--muted)">
          <input type="checkbox" checked={draft.isGoalkeeper} onChange={(event) => setDraft({ ...draft, isGoalkeeper: event.target.checked })} />
          <span>Arquero</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => onSave(draft)}><Save size={16} />Guardar</Button>
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--green) bg-(--green) px-3 text-sm font-bold text-(--bg-deep) hover:bg-(--green-dark) hover:text-white"><MessageCircle size={16} />WhatsApp</a>
        ) : null}
      </div>

      {allowMerge && otherPlayers.length > 0 ? (
        <div className="border-t border-white/10 pt-4 mt-4 space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-amber-500">Fusionar Jugador (Irreversible)</h3>
          <p className="text-xs text-(--muted)">
            Transfiere todos los partidos y pagos de <b>{player.name}</b> a otro jugador, y luego elimina la cuenta de <b>{player.name}</b>.
          </p>
          <div className="flex gap-2">
            <select
              value={mergeTargetId}
              onChange={(e) => setMergeTargetId(e.target.value)}
              className="h-10 flex-1 rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white"
              disabled={isMerging}
            >
              <option value="">-- Seleccionar jugador de destino --</option>
              {otherPlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.paymentPlan === "monthly" ? "mensual" : "galleta"})
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              onClick={handleMerge}
              disabled={!mergeTargetId || isMerging}
              className="border-amber-500/40 text-amber-500 hover:bg-amber-500 hover:text-white"
            >
              Fusionar
            </Button>
          </div>
          {mergeError ? <p className="text-xs text-red-400 font-semibold">{mergeError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function PlayerMergeForm({ player, players, onMerged }: { player: Player; players: Player[]; onMerged: (targetId: string) => void }) {
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [error, setError] = useState("");
  const [isMerging, startMergeTransition] = useTransition();
  const otherPlayers = useMemo(() => players.filter((item) => item.id !== player.id).sort((a, b) => a.name.localeCompare(b.name)), [players, player.id]);
  const target = otherPlayers.find((item) => item.id === mergeTargetId);

  function merge() {
    if (!target) return;
    if (!confirm(`¿Estás seguro de fusionar a ${player.name} dentro de ${target.name}? Esta acción es irreversible, moverá todos sus registros y eliminará a ${player.name}.`)) return;
    startMergeTransition(async () => {
      try {
        await mergePlayersAction(player.id, target.id);
        onMerged(target.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo fusionar el jugador.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-(--muted)">Los partidos y pagos de <b className="text-white">{player.name}</b> pasarán al jugador destino. Esta acción no se puede deshacer.</p>
      <label className="space-y-1 text-sm font-medium text-(--muted)"><span>Jugador destino</span><select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} disabled={isMerging} className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white"><option value="">-- Seleccionar jugador --</option>{otherPlayers.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.paymentPlan === "monthly" ? "mensual" : "galleta"})</option>)}</select></label>
      {error ? <p className="text-sm font-semibold text-(--red)">{error}</p> : null}
      <div className="flex justify-end"><Button variant="secondary" onClick={merge} disabled={!target || isMerging} className="border-amber-500/40 text-amber-500 hover:bg-amber-500 hover:text-white">{isMerging ? "Fusionando..." : "Fusionar jugador"}</Button></div>
    </div>
  );
}

function PlayerLoginForm({
  playerId,
  login,
  onClose,
  onSaved,
}: {
  playerId: string;
  login: PlayerLogin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(login?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">(login?.role ?? "member");
  const [active, setActive] = useState(login?.active ?? true);
  const [error, setError] = useState("");
  const [isSaving, startSaving] = useTransition();

  function save() {
    const input: PlayerLoginInput = { email, password: password || undefined, role, active };
    startSaving(async () => {
      try {
        await savePlayerLoginAction(playerId, input);
        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el acceso.");
      }
    });
  }

  function remove() {
    if (!confirm("¿Quitar el acceso de este jugador? Ya no va a poder iniciar sesion.")) return;
    startSaving(async () => {
      try {
        await removePlayerLoginAction(playerId);
        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo quitar el acceso.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <Input label="Email" value={email} onChange={setEmail} type="email" />
      <Input label={login ? "Nuevo password (dejar vacio para no cambiarlo)" : "Password"} value={password} onChange={setPassword} type="password" />
      <label className="flex items-center gap-2 text-sm font-medium text-(--muted)">
        <input type="checkbox" checked={role === "admin"} onChange={(event) => setRole(event.target.checked ? "admin" : "member")} disabled={isSaving} />
        <span>Administrador (acceso total)</span>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-(--muted)">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={isSaving} />
        <span>Cuenta activa</span>
      </label>
      {error ? <p className="text-sm font-semibold text-(--red)">{error}</p> : null}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={save} disabled={isSaving}><Save size={16} />Guardar acceso</Button>
        {login ? (
          <Button variant="secondary" onClick={remove} disabled={isSaving} className="border-(--red)/40 text-(--red) hover:bg-(--red) hover:text-white">
            Quitar acceso
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type PlayerHistoryItem = { row: MatchPlayer | undefined; match: Match; result: MatchResult | undefined };

function playerHistoryDetails(item: PlayerHistoryItem, today: string) {
  const result = item.result;
  const row = item.row;
  const isFutureMatch = item.match.date > today;
  const isConfirmed = row?.attendanceStatus === "confirmed";
  const didNotAttend = !isFutureMatch && (!row || row.attendanceStatus === "out");
  const isPending = !didNotAttend && (!isConfirmed || !result || row?.team === "none");
  const isDraw = isConfirmed && result?.winner === "draw" && row?.team !== "none";
  const isWin = Boolean(isConfirmed && result && !isDraw && row?.team !== "none" && result.winner === row?.team);
  const attendance = isFutureMatch
    ? "Pendiente"
    : !row || row.attendanceStatus === "out"
    ? "No estuvo"
    : row.attendanceStatus === "confirmed"
      ? "Confirmado"
      : row.attendanceStatus === "maybe"
        ? "Tal vez"
        : "En espera";
  const outcome = didNotAttend ? "No estuvo" : isPending ? (isConfirmed ? "Pendiente" : attendance) : isDraw ? "Empate" : isWin ? "Victoria" : "Derrota";
  const points = row && isConfirmed ? pointsForMatchRow(row, result) : 0;
  return { attendance, didNotAttend, isPending, isDraw, isWin, outcome, points, debt: row ? pendingForMatchRow(row) : 0 };
}

function PlayerHistoryTable({ items, today }: { items: PlayerHistoryItem[]; today: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-(--border)">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="border-b border-(--border) bg-white/[0.04] text-[10px] font-black uppercase tracking-wide text-(--muted)">
          <tr>
            <th className="px-3 py-2 text-left">Fecha</th>
            <th className="px-3 py-2 text-center">Pts</th>
            <th className="px-3 py-2 text-center">Estado</th>
            <th className="px-3 py-2 text-center">Deuda</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const details = playerHistoryDetails(item, today);
            const iconClass = details.didNotAttend
              ? "border border-(--red)/45 bg-(--red)/12 text-(--red)"
              : details.isPending
                ? "border border-white/20 bg-white/[0.03] text-(--muted)"
                : details.isDraw
                  ? "border border-(--gold)/45 bg-(--gold)/15 text-(--gold)"
                  : details.isWin
                    ? "bg-(--green) text-(--bg-deep)"
                    : "bg-(--red)/90 text-white";
            return (
            <tr key={item.match.id} className={`border-b border-(--border) last:border-0 hover:bg-white/[0.04] ${details.didNotAttend ? "bg-(--red)/5" : ""}`}>
                <td className="px-3 py-3 font-bold text-white"><Link href={`/matches/${item.match.id}`} className="hover:underline">{item.match.date}</Link></td>
                <td className={`px-3 py-3 text-center font-black ${details.isPending || details.didNotAttend ? "text-(--muted)" : "text-(--gold)"}`}>{details.isPending || details.didNotAttend ? "—" : `+${details.points}`}</td>
                <td className="px-3 py-3"><span className="flex items-center justify-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-full ${iconClass}`} title={details.outcome}>{details.didNotAttend ? <X size={14} strokeWidth={3} /> : details.isPending ? null : details.isDraw ? <strong>−</strong> : details.isWin ? <Check size={15} strokeWidth={4} /> : <X size={14} strokeWidth={3} />}</span><span className={`text-xs font-bold ${details.didNotAttend ? "text-(--red)" : details.isDraw ? "text-(--gold)" : "text-(--muted)"}`}>{details.outcome}</span></span></td>
                <td className={`px-3 py-3 text-center font-bold ${details.debt > 0 ? "text-(--red)" : "text-(--green)"}`}>{formatCurrency(details.debt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlayerMonthlyHistory({
  player,
  history,
  players,
  monthlyPayments,
  isAdmin,
  onToggleRoster,
  onTogglePaid,
}: {
  player: Player;
  history: PlayerHistoryItem[];
  players: Player[];
  monthlyPayments: MonthlyPayment[];
  isAdmin: boolean;
  onToggleRoster: (monthKey: string, shouldBeMonthly: boolean) => void;
  onTogglePaid: (monthKey: string, paid: boolean) => void;
}) {
  const todayParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${todayParts.find((part) => part.type === "year")?.value}-${todayParts.find((part) => part.type === "month")?.value}-${todayParts.find((part) => part.type === "day")?.value}`;
  const nowMonthKey = currentMonthKey();
  const playerMonthlyPayments = monthlyPayments.filter((payment) => payment.playerId === player.id);

  const groups = new Map<string, PlayerHistoryItem[]>();
  for (const item of history) {
    const key = item.match.date.slice(0, 7);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  for (const payment of playerMonthlyPayments) {
    if (!groups.has(payment.monthKey)) groups.set(payment.monthKey, []);
  }
  const monthKeys = [...groups.keys()].sort((a, b) => b.localeCompare(a));

  if (monthKeys.length === 0) return <p className="text-sm text-(--muted)">Todavia no jugo ningun partido.</p>;

  return (
    <div className="space-y-4">
      {monthKeys.map((monthKey) => {
        const items = [...(groups.get(monthKey) ?? [])].sort((a, b) => `${b.match.date} ${b.match.time}`.localeCompare(`${a.match.date} ${a.match.time}`));
        const isMonthly = isPlayerMonthlyForMonth(player.id, monthKey, players, monthlyPayments);
        const isFutureMonth = monthKey > nowMonthKey;
        const payment = isMonthly ? monthlyPaymentFor(player, monthKey, playerMonthlyPayments.find((item) => item.monthKey === monthKey)) : undefined;
        const paid = payment?.paymentStatus === "paid";
        const galletaDebt = items.reduce((sum, item) => sum + playerHistoryDetails(item, today).debt, 0);
        const paidBadgeClass = paid
          ? "border-(--green) bg-(--green)/15 text-(--green)"
          : isFutureMonth
            ? "border-(--border) bg-white/[0.03] text-(--muted)"
            : "border-(--red)/40 bg-(--red)/10 text-(--red)";
        const paidBadgeTitle = paid
          ? `Pagado${payment?.paidAt ? ` el ${payment.paidAt.slice(0, 10)}` : ""}`
          : isFutureMonth
            ? "Mes futuro"
            : "Pendiente";

        return (
          <div key={monthKey} className="rounded-lg border border-(--border) bg-white/[0.02] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black uppercase tracking-wide text-white">{monthLabel(monthKey)}</h3>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin ? (
                  <label className="inline-flex items-center gap-1.5 rounded-md border border-(--border) bg-white/[0.03] px-2 py-1 text-[11px] font-bold text-(--muted)">
                    <input type="checkbox" className="accent-(--cyan)" checked={isMonthly} onChange={(event) => onToggleRoster(monthKey, event.target.checked)} />
                    Mensual este mes
                  </label>
                ) : null}
                {isMonthly ? (
                  <button
                    type="button"
                    disabled={!isAdmin || isFutureMonth}
                    title={paidBadgeTitle}
                    onClick={() => onTogglePaid(monthKey, paid)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-black transition disabled:cursor-not-allowed ${paidBadgeClass} ${isAdmin && !isFutureMonth ? "hover:opacity-80" : ""}`}
                  >
                    {paid ? "Mensualidad pagada" : isFutureMonth ? "Mes futuro" : "Mensualidad pendiente"}
                  </button>
                ) : (
                  <span className={`rounded-md border px-2.5 py-1 text-[11px] font-black ${galletaDebt > 0 ? "border-(--red)/40 bg-(--red)/10 text-(--red)" : "border-(--green)/40 bg-(--green)/10 text-(--green)"}`}>
                    {galletaDebt > 0 ? `Galleta: ${formatCurrency(galletaDebt)} pendiente` : "Galleta: al dia"}
                  </span>
                )}
              </div>
            </div>
            {items.length > 0 ? <PlayerHistoryTable items={items} today={today} /> : <p className="px-1 text-sm text-(--muted)">Sin partidos registrados este mes.</p>}
          </div>
        );
      })}
    </div>
  );
}

const linkButtonClass = "inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-bold transition bg-white/[0.06] text-white hover:bg-white/[0.12] border-(--border)";

export function PlayerDetailPage({
  id,
  initialData,
  playerLogin = null,
  canManageLogins = false,
}: { id: string; playerLogin?: PlayerLogin | null; canManageLogins?: boolean } & InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [error, setError] = useState("");
  const player = data.players.find((item) => item.id === id);
  if (!player) return <PageTitle title="Jugador no encontrado" description="No existe en la base de datos." />;

  const stats = computePlayerStats(player, data);
  const standings = buildPlayerStandings(data);
  const standing = standings.get(player.id) ?? standings.get(player.name.toLowerCase());
  const history = data.matches.map((match) => ({
    match,
    row: data.matchPlayers.find((row) => row.matchId === match.id && matchRowBelongsToPlayer(row, player, data.players)),
    result: data.results.find((item) => item.matchId === match.id),
  }));
  const editHref = `/players/${player.id}/edit`;

  function toggleMonthlyRoster(monthKey: string, shouldBeMonthly: boolean) {
    if (!player) return;
    if (shouldBeMonthly) {
      const payment = monthlyPaymentFor(player, monthKey, data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey));
      saveMonthlyPaymentAction(payment)
        .then(() => commit({ ...data, monthlyPayments: upsertMonthlyPayment(data.monthlyPayments, payment) }))
        .catch((err) => setError(err instanceof Error ? err.message : "No se pudo agregar al roster de fijos."));
      return;
    }
    removeMonthlyPaymentAction(player.id, monthKey)
      .then(() => commit({ ...data, monthlyPayments: data.monthlyPayments.filter((item) => !(item.playerId === player.id && item.monthKey === monthKey)) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo quitar del roster de fijos."));
  }

  function toggleMonthlyPaid(monthKey: string, paid: boolean) {
    if (!player) return;
    const existing = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === monthKey);
    const base = monthlyPaymentFor(player, monthKey, existing);
    const now = new Date().toISOString();
    const updated: MonthlyPayment = paid
      ? { ...base, paymentStatus: "unpaid", amountPaid: 0, paidAt: undefined, updatedAt: now }
      : { ...base, paymentStatus: "paid", amountPaid: base.expectedAmount, paidAt: now, updatedAt: now };
    saveMonthlyPaymentAction(updated)
      .then(() => commit({ ...data, monthlyPayments: upsertMonthlyPayment(data.monthlyPayments, updated) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo registrar el pago."));
  }

  return (
    <>
      <PageTitle title={player.name} description={`${isPlayerMonthlyForMonth(player.id, currentMonthKey(), data.players, data.monthlyPayments) ? "Oficial" : "Galleta"} · ${player.nickname || "Sin pseudonimo"}`} />
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      {isAdmin ? <div className="mb-4 flex flex-wrap gap-2"><Link href={editHref} className={linkButtonClass}><Pencil size={16} />Editar jugador</Link></div> : null}
      <section className="relative overflow-hidden rounded-xl border border-(--gold)/30 bg-[linear-gradient(135deg,rgba(250,204,21,0.14),rgba(18,214,154,0.08)_48%,rgba(255,255,255,0.03))] p-5 shadow-(--shadow)">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-(--gold)/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-(--gold)/45 bg-(--gold)/15 text-2xl font-black text-(--gold) shadow-[0_0_30px_rgba(250,204,21,0.18)]">
              {standing ? `#${standing.rank}` : "—"}
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-(--gold)">Posición en el ranking</p>
              <h2 className="mt-1 text-2xl font-black text-white">{player.nickname || player.name}</h2>
              <p className="mt-1 text-sm font-semibold text-(--muted)">{stats.played} PJ · {stats.form} · {stats.winRate}% rendimiento</p>
            </div>
          </div>
          <div className="border-t border-white/10 pt-4 text-left sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-(--muted)">Puntos acumulados</p>
            <p className="mt-1 text-5xl font-black leading-none text-(--gold)">{stats.points}<span className="ml-1 text-base text-(--gold)/70">pts</span></p>
          </div>
        </div>
      </section>
      <Card className="mt-4">
        <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Deuda pendiente</p>
        <p className={`mt-1 text-2xl font-black ${stats.pendingDebt > 0 ? "text-(--red)" : "text-(--green)"}`}>{formatCurrency(stats.pendingDebt)}</p>
      </Card>
      <Card className="mt-4 space-y-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Trayectoria</p>
          <h2 className="mt-1 text-xl font-black text-white">Historial de pagos y partidos</h2>
        </div>
        <PlayerMonthlyHistory
          player={player}
          history={history}
          players={data.players}
          monthlyPayments={data.monthlyPayments}
          isAdmin={isAdmin}
          onToggleRoster={toggleMonthlyRoster}
          onTogglePaid={toggleMonthlyPaid}
        />
      </Card>
      {canManageLogins ? (
        <Card className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Acceso al sistema</p>
              <h2 className="mt-1 text-xl font-black text-white">Login</h2>
            </div>
            <Link href={editHref} className={linkButtonClass}>
              <Shield size={16} />
              {playerLogin ? "Editar acceso" : "Crear acceso"}
            </Link>
          </div>
          {playerLogin ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white">{playerLogin.email}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${playerLogin.role === "admin" ? "bg-(--gold)/15 text-(--gold)" : "bg-white/10 text-(--muted)"}`}>
                {playerLogin.role === "admin" ? "Administrador" : "Miembro"}
              </span>
              {!playerLogin.active ? <span className="rounded-full bg-(--red)/15 px-2 py-0.5 text-xs font-bold text-(--red)">Inactivo</span> : null}
            </div>
          ) : (
            <p className="text-sm text-(--muted)">Este jugador todavia no tiene una cuenta para iniciar sesion.</p>
          )}
        </Card>
      ) : null}
    </>
  );
}

export function PlayerEditPage({
  id,
  initialData,
  playerLogin = null,
  canManageLogins = false,
}: { id: string; playerLogin?: PlayerLogin | null; canManageLogins?: boolean } & InitialDataProps) {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const { data, commit } = useSifupData(initialData);
  const [editingLogin, setEditingLogin] = useState(false);
  const [error, setError] = useState("");
  const player = data.players.find((item) => item.id === id);

  if (!isAdmin) return <PageTitle title="Acceso restringido" description="Solo un administrador puede editar jugadores." />;
  if (!player) return <PageTitle title="Jugador no encontrado" description="No existe en la base de datos." />;

  const backHref = `/players/${player.id}`;

  function savePlayer(patch: Partial<Player>) {
    if (!player) return;
    const updated = { ...player, ...patch, updatedAt: new Date().toISOString() };
    savePlayerAction(updated)
      .then(() => {
        commit({ ...upsertPlayer(data, updated), matchPlayers: data.matchPlayers.map((row) => row.playerId === updated.id ? { ...row, name: updated.name, updatedAt: updated.updatedAt } : row) });
        setError("");
        router.push(backHref);
        router.refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el jugador."));
  }

  return (
    <>
      <PageTitle
        title={`Editar ${player.name}`}
        description="Datos del jugador, fusion y acceso al sistema."
        action={<Link href={backHref} className={linkButtonClass}><ChevronLeft size={16} />Volver a la ficha</Link>}
      />
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      <Card className="space-y-3">
        <h2 className="text-lg font-black text-white">Datos del jugador</h2>
        <PlayerEditorForm player={player} onSave={savePlayer} allowMerge={false} />
      </Card>
      <Card className="mt-4 space-y-3">
        <h2 className="text-lg font-black text-amber-500">Fusionar jugador</h2>
        <PlayerMergeForm player={player} players={data.players} onMerged={(targetId) => { router.replace(`/players/${targetId}`); router.refresh(); }} />
      </Card>
      {canManageLogins ? (
        <Card className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Acceso al sistema</p>
              <h2 className="mt-1 text-xl font-black text-white">Login</h2>
            </div>
            {!editingLogin ? (
              <Button variant="secondary" onClick={() => setEditingLogin(true)}>
                <Shield size={16} />
                {playerLogin ? "Editar acceso" : "Crear acceso"}
              </Button>
            ) : null}
          </div>
          {editingLogin ? (
            <PlayerLoginForm playerId={player.id} login={playerLogin} onClose={() => setEditingLogin(false)} onSaved={() => router.refresh()} />
          ) : playerLogin ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white">{playerLogin.email}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${playerLogin.role === "admin" ? "bg-(--gold)/15 text-(--gold)" : "bg-white/10 text-(--muted)"}`}>
                {playerLogin.role === "admin" ? "Administrador" : "Miembro"}
              </span>
              {!playerLogin.active ? <span className="rounded-full bg-(--red)/15 px-2 py-0.5 text-xs font-bold text-(--red)">Inactivo</span> : null}
            </div>
          ) : (
            <p className="text-sm text-(--muted)">Este jugador todavia no tiene una cuenta para iniciar sesion.</p>
          )}
        </Card>
      ) : null}
    </>
  );
}

export function StandingsPage({ initialData }: InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [error, setError] = useState("");

  const filteredStandings = useMemo(() => {
    const rankingMonth = currentMonthKey();
    const baseStandings = data.players.map((player) => {
      const stats = computePlayerStats(player, data);
      return {
        id: player.id,
        player: player.name,
        nickname: player.nickname,
        plan: (isPlayerMonthlyForMonth(player.id, rankingMonth, data.players, data.monthlyPayments) ? "monthly" : "perMatch") as PaymentPlan,
        shortName: player.shortName,
        isGoalkeeper: player.isGoalkeeper,
        ...stats,
      };
    }).sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played);

    let lastMonthlyIndex = -1;
    for (let i = baseStandings.length - 1; i >= 0; i--) {
      if (baseStandings[i].plan === "monthly") {
        lastMonthlyIndex = i;
        break;
      }
    }

    if (lastMonthlyIndex === -1) {
      return baseStandings;
    }

    return baseStandings.slice(0, lastMonthlyIndex + 1);
  }, [data]);

  const upcomingMatch = useMemo(() => nextMatch(data.matches), [data.matches]);

  const confirmedForNextMatch = useMemo(() => {
    if (!upcomingMatch) return new Set<string>();
    return new Set(
      data.matchPlayers
        .filter((mp) => mp.matchId === upcomingMatch.id && mp.attendanceStatus === "confirmed")
        .map((mp) => mp.playerId || mp.name.toLowerCase())
    );
  }, [upcomingMatch, data.matchPlayers]);

  const outForNextMatch = useMemo(() => {
    if (!upcomingMatch) return new Set<string>();
    return new Set(
      data.matchPlayers
        .filter((mp) => mp.matchId === upcomingMatch.id && mp.attendanceStatus === "out")
        .map((mp) => mp.playerId || mp.name.toLowerCase())
    );
  }, [upcomingMatch, data.matchPlayers]);

  const last5Matches = useMemo(() => rankingMatches(data.matches, data.results, data.matchTeams), [data]);

  const topThree = filteredStandings.slice(0, 3);
  const totalPlayed = data.results.length;
  const activePlayers = data.players.filter((player) => player.active).length;
  const recentResults = [...data.results]
    .map((result) => ({ result, match: data.matches.find((match) => match.id === result.matchId) }))
    .filter((item) => item.match)
    .sort((a, b) => (b.match?.date ?? "").localeCompare(a.match?.date ?? ""))
    .slice(0, 3);

  const rankClass = ["first", "second", "third"];

  function savePlayer(patch: Partial<Player>) {
    if (!editingPlayer) return;
    const updated = { ...editingPlayer, ...patch, updatedAt: new Date().toISOString() };
    savePlayerAction(updated)
      .then(() => {
        const nextData = {
          ...upsertPlayer(data, updated),
          matchPlayers: data.matchPlayers.map((mp) => {
            if (mp.playerId === updated.id) {
              return { ...mp, name: updated.name, updatedAt: updated.updatedAt };
            }
            return mp;
          }),
        };
        commit(nextData);
        setEditingPlayer(null);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el jugador."));
  }

  function handleShare() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rowHeight = 48;
    const headerHeight = 110;
    const footerHeight = 50;
    const canvasWidth = 600;
    const canvasHeight = headerHeight + (filteredStandings.length * rowHeight) + footerHeight;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Draw background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    grad.addColorStop(0, "#05110e");
    grad.addColorStop(1, "#0d2720");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw header branding
    ctx.fillStyle = "#12d69a";
    ctx.font = "black 28px sans-serif";
    ctx.fillText("SIFUP", 30, 48);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("Tabla Viva de los Martes", 30, 75);

    ctx.fillStyle = "#70a090";
    ctx.font = "600 12px sans-serif";
    ctx.fillText("RANKING OFICIAL", 30, 95);

    // Draw date
    const dateStr = new Date().toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
    ctx.textAlign = "right";
    ctx.fillText(dateStr, canvasWidth - 30, 95);
    ctx.textAlign = "left";

    // Table Headers
    let y = headerHeight;
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(0, y, canvasWidth, 32);

    ctx.fillStyle = "#70a090";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("#", 30, y + 20);
    ctx.fillText("JUGADOR", 65, y + 20);
    ctx.textAlign = "center";
    ctx.fillText("PTS", 370, y + 20);
    ctx.fillText("PJ", 430, y + 20);
    ctx.fillText("RACHA", 510, y + 20);
    ctx.textAlign = "left";

    y += 32;

    // Draw rows
    filteredStandings.forEach((row, index) => {
      // Row background
      if (index % 2 === 1) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
        ctx.fillRect(0, y, canvasWidth, rowHeight);
      }

      // Rank
      ctx.fillStyle = index < 3 ? "#eab308" : "#70a090";
      ctx.font = "black 14px sans-serif";
      ctx.fillText(String(index + 1), 30, y + 28);

      // Initials Bubble
      const isGalleta = row.plan !== "monthly";
      const bubbleColor = isGalleta ? "#64748b" : (index < 3 ? "#eab308" : "#12d69a");
      ctx.fillStyle = bubbleColor;
      ctx.beginPath();
      ctx.arc(80, y + 24, 16, 0, Math.PI * 2);
      ctx.fill();

      // Initials Text
      ctx.fillStyle = isGalleta ? "#ffffff" : "#05110e";
      ctx.font = "black 11px sans-serif";
      ctx.textAlign = "center";
      const initials = row.shortName ? row.shortName.toUpperCase() : row.player.slice(0, 2).toUpperCase();
      ctx.fillText(initials, 80, y + 28);
      ctx.textAlign = "left";

      // Player Name
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px sans-serif";
      const displayName = row.player + (row.isGoalkeeper ? " 🧤" : "");
      ctx.fillText(displayName, 110, y + 20);

      // Nickname / Plan
      ctx.fillStyle = "#70a090";
      ctx.font = "500 11px sans-serif";
      const subText = `${row.nickname || (row.plan === "monthly" ? "Oficial" : "Galleta")}`;
      ctx.fillText(subText, 110, y + 36);

      // Stats
      ctx.textAlign = "center";
      ctx.fillStyle = "#eab308";
      ctx.font = "black 16px sans-serif";
      ctx.fillText(String(row.points), 370, y + 28);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(String(row.played), 430, y + 28);

      // Draw form circles
      let cx = 510 - 28;
      last5Matches.forEach((match) => {
        const mp = data.matchPlayers.find(
          (rowMp) => rowMp.matchId === match.id &&
            (rowMp.playerId === row.id || rowMp.name === row.player) &&
            rowMp.attendanceStatus === "confirmed"
        );
        if (!mp || mp.team === "none") {
          // Hollow circle
          ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, y + 24, 5, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const result = data.results.find((r) => r.matchId === match.id);
          if (!result) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, y + 24, 5, 0, Math.PI * 2);
            ctx.stroke();
          } else if (result.winner === "draw") {
            // Gray circle
            ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
            ctx.beginPath();
            ctx.arc(cx, y + 24, 5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const win = result.winner === mp.team;
            ctx.fillStyle = win ? "#12d69a" : "#ef4444";
            ctx.beginPath();
            ctx.arc(cx, y + 24, 5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        cx += 14;
      });

      ctx.textAlign = "left";

      // Separator line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, y + rowHeight);
      ctx.lineTo(canvasWidth - 30, y + rowHeight);
      ctx.stroke();

      y += rowHeight;
    });

    // Draw footer
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.font = "500 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Generado en sifup.vercel.app", canvasWidth / 2, y + 30);

    // Share / Download
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "sifup-ranking.png", { type: "image/png" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: "Ranking SIFUP",
          text: `Tabla de los martes generada el ${dateStr}`,
        }).catch((err) => {
          console.error("Error al compartir:", err);
          triggerDownload(canvas);
        });
      } else {
        triggerDownload(canvas);
      }
    }, "image/png");
  }

  function triggerDownload(canvas: HTMLCanvasElement) {
    const link = document.createElement("a");
    link.download = `sifup-ranking-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="max-w-4xl mx-auto w-full px-4 pt-4 pb-12 space-y-6">
      <section className="hero">
        <div className="hero-bg" aria-hidden="true"></div>
        <div className="hero-copy">
          <div className="label-row">
            <span>SIFUP</span>
            <strong>Tabla viva de los martes</strong>
          </div>
          <h1>Rankings</h1>
          <p>Vision general, resultados y rendimiento acumulado por jugador, con deudas e invitados acotados.</p>
        </div>
        <div className="hero-metrics" aria-label="Vision general">
          <article className="metric cyan">
            <span>Partidos</span>
            <strong>{totalPlayed}</strong>
          </article>
          <article className="metric lime">
            <span>Jugadores</span>
            <strong>{activePlayers}</strong>
          </article>
        </div>
      </section>

      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}

      <section id="vision" className="vision-grid">
        <article id="top3" className="panel top-panel">
          <div className="panel-heading">
            <div>
              <h2>Top 3</h2>
              <p>Puntos primero, win rate despues.</p>
            </div>
            <span className="panel-icon gold"><Trophy size={16} /></span>
          </div>

          <div className="podium-grid">
            {topThree.map((row, index) => (
              <article key={row.player} className={`podium-card ${rankClass[index]}`} data-rank={index + 1}>
                <div className="podium-card-main-content">
                  <span className="medal"><Medal size={14} /></span>
                  <div className="podium-card-name-group">
                    <h3>{row.player}</h3>
                    <p>{row.nickname || (row.plan === "monthly" ? "Oficial" : "Galleta")}</p>
                  </div>
                </div>
                <div className="podium-footer">
                  <strong>{row.points} <span className="text-[10px] uppercase font-bold tracking-wider opacity-60">pts</span></strong>
                  <div className="flex items-center gap-1 shrink-0">
                    {last5Matches.map((match) => {
                      const mp = data.matchPlayers.find(
                        (rowMp) => rowMp.matchId === match.id &&
                          (rowMp.playerId === row.id || rowMp.name === row.player) &&
                          rowMp.attendanceStatus === "confirmed"
                      );
                      if (!mp || mp.team === "none") {
                        return <div key={match.id} className="h-3 w-3 rounded-full border border-current opacity-30" title={`${match.weekLabel}: No jugó`} />;
                      }
                      const result = data.results.find((r) => r.matchId === match.id);
                      if (!result) {
                        return <div key={match.id} className="h-3 w-3 rounded-full border border-current opacity-30" title={`${match.weekLabel}: No jugó`} />;
                      }
                      if (result.winner === "draw") {
                        return (
                          <div key={match.id} className="flex h-3 w-3 items-center justify-center rounded-full bg-current/25 text-[8px] font-black text-current" title={`${match.weekLabel}: Empate`}>
                            -
                          </div>
                        );
                      }
                      const win = result.winner === mp.team;
                      if (win) {
                        return (
                          <div key={match.id} className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-600 text-white" title={`${match.weekLabel}: Victoria`}>
                            <Check size={8} strokeWidth={4} />
                          </div>
                        );
                      } else {
                        return (
                          <div key={match.id} className="flex h-3 w-3 items-center justify-center rounded-full bg-red-600 text-white" title={`${match.weekLabel}: Derrota`}>
                            <X size={8} strokeWidth={3} />
                          </div>
                        );
                      }
                    })}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article id="resultados" className="panel results-panel">
          <div className="panel-heading">
            <div>
              <h2>Resultados</h2>
              <p>Ultimas fechas cerradas.</p>
            </div>
            <span className="panel-icon cyan"><Sparkles size={16} /></span>
          </div>

          <div className="result-list">
            {recentResults.map(({ result }, index) => {
              const winners = result.winner !== "draw"
                ? data.matchPlayers.filter((mp) => mp.matchId === result.matchId && mp.team === result.winner && mp.attendanceStatus === "confirmed")
                : [];
              return (
                <article
                  key={result.id}
                  style={{ background: "var(--row)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: "10px", padding: "12px" }}
                  className="flex flex-col gap-1.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <strong className="text-sm font-bold text-white">
                      {result.winner === "draw" ? "Empate" : `Ganó el equipo ${teamLabel(result.winner)}`}
                    </strong>
                    <span className="text-[11px] text-(--muted) font-medium">
                      {index === 0 ? "Semana pasada" : `Hace ${index + 1} semanas`}
                    </span>
                  </div>
                  {winners.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {winners.map((w) => (
                        <span key={w.id} className="inline-flex items-center rounded bg-(--green)/15 px-1.5 py-0.5 text-[9px] font-black text-(--green) uppercase tracking-wider">
                          {w.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] text-(--muted) italic mt-0.5">Empate</span>
                  )}
                </article>
              );
            })}
            {recentResults.length === 0 ? <p className="text-sm text-(--muted)">Aun no hay resultados cerrados.</p> : null}
          </div>
        </article>
      </section>

      <section id="ranking" className="panel ranking-panel">
        <div className="ranking-head">
          <div>
            <h2>Ranking general</h2>
            <p>Ordenado por puntos, rendimiento y PJ. Acotado hasta el ultimo oficial mensual.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleShare} variant="secondary" className="h-9 px-3 text-xs flex items-center gap-1.5">
              <Share size={14} /> Compartir
            </Button>
            <strong className="season-chip">Temporada actual</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Jugador</th>
                <th className="text-center font-bold" style={{ color: "var(--gold)" }}>Puntos</th>
                <th className="optional text-center">PJ</th>
                <th className="optional text-center">G</th>
                <th className="optional text-center">E</th>
                <th className="optional text-center">P</th>
                <th className="text-center">Racha</th>
                {upcomingMatch ? <th className="text-center">Próx.</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredStandings.map((row, index) => (
                <tr key={row.player}>
                  <td>{index + 1}</td>
                  <td>
                    <div className="player">
                      <span className={row.plan !== "monthly" ? "galleta-bubble" : undefined}>
                        {row.shortName ? row.shortName.toUpperCase() : row.player.slice(0, 2).toUpperCase()}
                      </span>
                      <strong>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/players/${row.id}`} className="hover:text-(--green) hover:underline transition">
                            <b>{row.player}</b>
                          </Link>
                          {row.isGoalkeeper ? (
                            <span className="inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-500 uppercase tracking-wider gap-0.5" title="Arquero">
                              🧤 ARQ
                            </span>
                          ) : null}
                          {isAdmin ? (
                            <button
                              type="button"
                              onClick={() => {
                                const p = data.players.find((item) => item.id === row.id);
                                if (p) setEditingPlayer(p);
                              }}
                              className="text-(--muted) hover:text-white transition inline-flex"
                              title="Editar jugador"
                            >
                              <Pencil size={12} />
                            </button>
                          ) : null}
                        </div>
                        <small>{row.plan === "monthly" ? "Oficial" : "Galleta"} · {row.form}</small>
                      </strong>
                    </div>
                  </td>
                  <td className="points-cell text-center" style={{ fontSize: "20px", color: "var(--gold)", fontWeight: "1000" }}>{row.points}</td>
                  <td className="optional text-center">{row.played}</td>
                  <td className="optional text-center">{row.wins}</td>
                  <td className="optional text-center">{row.draws}</td>
                  <td className="optional text-center">{row.losses}</td>
                  <td className="align-middle">
                    <div className="flex items-center gap-1.5 justify-center">
                      {last5Matches.map((match) => {
                        const mp = data.matchPlayers.find(
                          (rowMp) => rowMp.matchId === match.id &&
                            (rowMp.playerId === row.id || rowMp.name === row.player) &&
                            rowMp.attendanceStatus === "confirmed"
                        );
                        if (!mp || mp.team === "none") {
                          return <div key={match.id} className="h-5 w-5 rounded-full border border-white/[0.12] bg-transparent" title={`${match.weekLabel}: No jugó`} />;
                        }
                        const result = data.results.find((r) => r.matchId === match.id);
                        if (!result) {
                          return <div key={match.id} className="h-5 w-5 rounded-full border border-white/[0.12] bg-transparent" title={`${match.weekLabel}: No jugó`} />;
                        }
                        if (result.winner === "draw") {
                          return (
                            <div key={match.id} className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.12] text-[10px] font-black text-(--muted) border border-white/[0.08]" title={`${match.weekLabel}: Empate`}>
                              -
                            </div>
                          );
                        }
                        const win = result.winner === mp.team;
                        if (win) {
                          return (
                            <div key={match.id} className="flex h-5 w-5 items-center justify-center rounded-full bg-(--green) text-(--bg-deep)" title={`${match.weekLabel}: Victoria`}>
                              <Check size={11} strokeWidth={4} />
                            </div>
                          );
                        } else {
                          return (
                            <div key={match.id} className="flex h-5 w-5 items-center justify-center rounded-full bg-(--red)/85 text-white" title={`${match.weekLabel}: Derrota`}>
                              <X size={10} strokeWidth={3} />
                            </div>
                          );
                        }
                      })}
                    </div>
                  </td>
                  {upcomingMatch ? (
                    <td className="text-center align-middle">
                      {confirmedForNextMatch.has(row.id) || confirmedForNextMatch.has(row.player.toLowerCase()) ? (
                        <div className="inline-flex items-center justify-center text-(--green)" title="Confirmado para el próximo partido">
                          <Check size={16} strokeWidth={3} />
                        </div>
                      ) : outForNextMatch.has(row.id) || outForNextMatch.has(row.player.toLowerCase()) ? (
                        <div className="inline-flex items-center justify-center text-(--red)" title="No asiste al próximo partido">
                          <X size={14} strokeWidth={3} />
                        </div>
                      ) : (
                        <span className="text-(--muted) opacity-45" title="Pendiente de confirmación">
                          -
                        </span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingPlayer ? (
        <Modal title={`Editar ${editingPlayer.name}`} onClose={() => setEditingPlayer(null)}>
          <PlayerEditorForm player={editingPlayer} onSave={savePlayer} players={data.players} />
        </Modal>
      ) : null}
    </div>
  );
}

export function TeamsPage({ id, initialData }: { id: string } & InitialDataProps) {
  const { data, commit } = useSifupData(initialData);
  const match = data.matches.find((item) => item.id === id);
  const [rows, setRows] = useState(() => data.matchPlayers.filter((row) => row.matchId === id));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();

  if (!match) return <PageTitle title="Partido no encontrado" description="No existe en la base de datos." />;
  const currentMatch = match;

  const standings = buildPlayerStandings(data);

  if (currentMatch.matchFormat === "rey_de_la_cancha") {
    const matchTeams = data.matchTeams.filter((team) => team.matchId === currentMatch.id).sort((a, b) => a.seq - b.seq);

    function renameRoyalTeam(teamId: string, patch: Partial<Pick<MatchTeam, "name" | "color">>) {
      const now = new Date().toISOString();
      const nextTeams = data.matchTeams.map((team) => (team.id === teamId ? { ...team, ...patch, updatedAt: now } : team));
      commit({ ...data, matchTeams: nextTeams });
      const team = nextTeams.find((item) => item.id === teamId);
      if (team) saveMatchTeamsAction(currentMatch.id, [team]).catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar el equipo."));
    }

    function assignRoyalTeam(rowId: string, teamId: string) {
      setRows((current) => current.map((row) => (row.id === rowId ? { ...row, teamId, updatedAt: new Date().toISOString() } : row)));
    }

    function rebalanceRoyalTeams() {
      if (matchTeams.length !== 3) return;
      const teamIds = matchTeams.map((team) => team.id) as [string, string, string];
      setRows((current) => applyBalancedRoyalTeams(current, data.players, standings, teamIds));
    }

    const unassignedRows = rows.filter((row) => row.attendanceStatus === "confirmed" && !matchTeams.some((team) => team.id === row.teamId));

    function saveRoyalRoster() {
      setError("");
      startTransition(async () => {
        try {
          await saveMatchDetailAction(currentMatch.id, rows);
          commit({ ...data, matchPlayers: data.matchPlayers.map((item) => rows.find((r) => r.id === item.id) ?? item) });
          router.push(`/matches/${currentMatch.id}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error al guardar equipos.");
        }
      });
    }

    return (
      <>
        <PageTitle
          title={`Equipos - ${currentMatch.weekLabel || currentMatch.date}`}
          description={`${currentMatch.date} - ${currentMatch.location} - Rey de la Cancha`}
          action={
            <div className="flex gap-2">
              <Link href={`/matches/${currentMatch.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
                Volver al partido
              </Link>
              <Button onClick={saveRoyalRoster} disabled={isPending}>
                <Save size={16} />
                Guardar equipos
              </Button>
            </div>
          }
        />
        {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-(--border) bg-white/[0.04] px-3 py-2">
          <p className="text-xs font-bold text-(--muted)">{unassignedRows.length > 0 ? `${unassignedRows.length} jugador(es) sin equipo` : "Todos los confirmados tienen equipo"}</p>
          <Button variant="secondary" onClick={rebalanceRoyalTeams} disabled={isPending} className="h-8 px-2.5 text-xs">
            <Sparkles size={14} />
            Autoasignar por Ranking
          </Button>
        </div>
        {unassignedRows.length > 0 ? (
          <Card className="mb-4 space-y-2">
            <h2 className="text-sm font-bold text-white">Sin equipo ({unassignedRows.length})</h2>
            <ul className="space-y-1.5">
              {unassignedRows.map((row) => {
                const isArq = playerForMatchRow(row, data.players)?.isGoalkeeper === true;
                return (
                  <li key={row.id} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/10 px-2 py-1.5">
                    <span className="truncate text-sm font-semibold text-white">
                      {row.name}
                      {isArq ? <span className="ml-1 text-[8px] font-black text-amber-500 uppercase">ARQ</span> : null}
                    </span>
                    <select
                      value=""
                      onChange={(event) => assignRoyalTeam(row.id, event.target.value)}
                      className="rounded border border-white/10 bg-black/30 px-1 py-0.5 text-xs font-bold text-white outline-none"
                    >
                      <option value="" disabled>Asignar a...</option>
                      {matchTeams.map((team) => (
                        <option key={team.id} value={team.id}>{team.name}</option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
        <RoyalTeamRoster teams={matchTeams} rows={rows} players={data.players} standings={standings} isAdmin onRenameTeam={renameRoyalTeam} onAssignTeam={assignRoyalTeam} />
      </>
    );
  }

  const confirmedRows = rows.filter((r) => r.attendanceStatus === "confirmed");
  const teamA = confirmedRows.filter((row) => row.team === "A");
  const teamB = confirmedRows.filter((row) => row.team === "B");
  const unassigned = confirmedRows.filter((row) => row.team !== "A" && row.team !== "B");

  const pointsA = teamA.reduce((sum, row) => sum + (standingForMatchRow(row, data.players, standings)?.points ?? 0), 0);
  const pointsB = teamB.reduce((sum, row) => sum + (standingForMatchRow(row, data.players, standings)?.points ?? 0), 0);
  const pointsDifference = Math.abs(pointsA - pointsB);
  const sortByPoints = (teamRows: MatchPlayer[]) => [...teamRows].sort((left, right) => {
    const leftStanding = standingForMatchRow(left, data.players, standings);
    const rightStanding = standingForMatchRow(right, data.players, standings);
    const pointsOrder = (rightStanding?.points ?? -1) - (leftStanding?.points ?? -1);
    if (pointsOrder !== 0) return pointsOrder;
    const rankOrder = (leftStanding?.rank ?? Number.POSITIVE_INFINITY) - (rightStanding?.rank ?? Number.POSITIVE_INFINITY);
    return rankOrder !== 0 ? rankOrder : left.name.localeCompare(right.name, "es");
  });
  const sortedTeamA = sortByPoints(teamA);
  const sortedTeamB = sortByPoints(teamB);
  const sortedUnassigned = sortByPoints(unassigned);

  function handleTeamChange(rowId: string, team: Team) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, team, updatedAt: new Date().toISOString() } : row))
    );
  }

  function resetBalancedTeams() {
    setRows((current) => applyBalancedTeams(current, data.players, standings));
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        await saveMatchDetailAction(currentMatch.id, rows);
        commit({ ...data, matchPlayers: data.matchPlayers.map((item) => rows.find((r) => r.id === item.id) ?? item) });
        router.push(`/matches/${currentMatch.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al guardar equipos.");
      }
    });
  }

  return (
    <>
      <PageTitle
        title={`Equipos - ${currentMatch.weekLabel || currentMatch.date}`}
        description={`${currentMatch.date} - ${currentMatch.location}`}
        action={
          <div className="flex gap-2">
            <Link href={`/matches/${currentMatch.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
              Volver al partido
            </Link>
            <Button onClick={save} disabled={isPending}>
              <Save size={16} />
              Guardar equipos
            </Button>
          </div>
        }
      />

      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-(--border) bg-white/[0.04] px-3 py-2">
          <p className={`text-xs font-bold ${pointsDifference === 0 ? "text-(--green)" : "text-(--muted)"}`}>
            {pointsDifference === 0 ? "Equipos equilibrados" : `Diferencia: ${pointsDifference} pts`}
          </p>
          <Button variant="secondary" onClick={resetBalancedTeams} disabled={isPending} className="h-8 px-2.5 text-xs">
            <Sparkles size={14} />
            Equilibrar por Ranking
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Card className="space-y-2 border-t-2 border-t-(--red)/70 bg-(--red)/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-bold text-white"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-(--red)" />Equipo Rojo</h2>
              <div className="flex items-baseline gap-2"><span className="text-xs font-black text-(--muted)">{teamA.length} jug.</span><span className="text-lg font-black leading-none text-(--red)">{pointsA} pts</span></div>
            </div>
            <div className="space-y-1.5">
              {sortedTeamA.map((row) => (
                <TeamSelectorRow key={row.id} row={row} onChange={(team) => handleTeamChange(row.id, team)} players={data.players} standings={standings} />
              ))}
              {teamA.length === 0 ? <p className="text-sm text-(--muted) italic">Sin jugadores asignados</p> : null}
            </div>
          </Card>

          <Card className="space-y-2 border-t-2 border-t-(--gold)/70 bg-(--gold)/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-bold text-white"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-(--gold)" />Equipo Amarillo</h2>
              <div className="flex items-baseline gap-2"><span className="text-xs font-black text-(--muted)">{teamB.length} jug.</span><span className="text-lg font-black leading-none text-(--gold)">{pointsB} pts</span></div>
            </div>
            <div className="space-y-1.5">
              {sortedTeamB.map((row) => (
                <TeamSelectorRow key={row.id} row={row} onChange={(team) => handleTeamChange(row.id, team)} players={data.players} standings={standings} />
              ))}
              {teamB.length === 0 ? <p className="text-sm text-(--muted) italic">Sin jugadores asignados</p> : null}
            </div>
          </Card>

          <Card className="space-y-2 border-t-2 border-t-white/25 p-3 md:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-bold text-white"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/50" />Sin equipo</h2>
              <span className="text-xs font-black text-(--muted)">{unassigned.length} pendientes</span>
            </div>
            <div className="space-y-1.5">
              {sortedUnassigned.map((row) => (
                <TeamSelectorRow key={row.id} row={row} onChange={(team) => handleTeamChange(row.id, team)} players={data.players} standings={standings} />
              ))}
              {unassigned.length === 0 ? <p className="rounded-md border border-(--green)/25 bg-(--green)/10 px-3 py-2 text-sm font-semibold text-(--green)">Todos los jugadores están asignados.</p> : null}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function TeamSelectorRow({ row, onChange, players, standings }: { row: MatchPlayer; onChange: (team: Team) => void; players: Player[]; standings: Map<string, PlayerStanding> }) {
  const player = playerForMatchRow(row, players);
  const isArq = player?.isGoalkeeper === true;
  const standing = standingForMatchRow(row, players, standings);

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2">
      <div className="min-w-0">
        <p className="truncate font-semibold text-white">
          <span className="md:hidden">{row.name}</span>
          {player ? <Link href={`/players/${player.id}`} className="hidden hover:text-(--green) hover:underline md:inline">{row.name}</Link> : <span className="hidden md:inline">{row.name}</span>}
          {isArq ? (
            <span aria-label="Arquero" title="Arquero" className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.2)]">
              <span aria-hidden="true" className="text-sm leading-none">🧤</span> ARQ
            </span>
          ) : null}
        </p>
        <p className="text-xs text-(--muted)">{standing ? <><span>#{standing.rank} · </span><span className="text-sm font-black text-(--gold)">{standing.points} pts</span></> : "Sin ranking"}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Asignar equipo a ${row.name}`}>
        <button
          type="button"
          onClick={() => onChange("A")}
          aria-pressed={row.team === "A"}
          aria-label="Mover a Equipo Rojo"
          title="Mover a Equipo Rojo"
          className={`grid h-7 w-7 place-items-center rounded-full transition ${row.team === "A" ? "bg-(--red) ring-2 ring-(--red)/30 ring-offset-2 ring-offset-(--panel)" : "bg-(--red)/35 hover:bg-(--red)"}`}
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/90" />
        </button>
        <button
          type="button"
          onClick={() => onChange("B")}
          aria-pressed={row.team === "B"}
          aria-label="Mover a Equipo Amarillo"
          title="Mover a Equipo Amarillo"
          className={`grid h-7 w-7 place-items-center rounded-full transition ${row.team === "B" ? "bg-(--gold) ring-2 ring-(--gold)/30 ring-offset-2 ring-offset-(--panel)" : "bg-(--gold)/35 hover:bg-(--gold)"}`}
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/90" />
        </button>
        <button
          type="button"
          onClick={() => onChange("none")}
          aria-pressed={row.team === "none"}
          aria-label="Quitar del equipo"
          title="Quitar del equipo"
          className={`grid h-7 w-7 place-items-center rounded-full transition ${row.team === "none" ? "bg-white/35 ring-2 ring-white/20 ring-offset-2 ring-offset-(--panel)" : "bg-white/15 hover:bg-white/35"}`}
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/90" />
        </button>
      </div>
    </div>
  );
}
