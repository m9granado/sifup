"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Clipboard, MapPin, Medal, MessageCircle, Pencil, Plus, Save, Share, Shield, Sparkles, Trophy, UserMinus, UserPlus, Users, WalletCards, X } from "lucide-react";
import {
  createMatchAction,
  markMatchPlayerPaidAction,
  saveMatchDetailAction,
  saveMonthlyPaymentAction,
  savePlayerAction,
  mergePlayersAction,
} from "@/app/actions";
import { useIsAdmin } from "./AuthMode";
import { parseWhatsAppList } from "@/lib/parser";
import { adjacentMatches, formatCurrency, newId, nextMatch, replaceMatchPlayers, summarizeMatch, upsertMatch, upsertPlayer, upsertResult, whatsappOrderFor } from "@/lib/store";
import { matchSummaryMessage, teamsMessage } from "@/lib/whatsapp";
import { COURT_COST, DRAW_POINTS, MONTHLY_AMOUNT, PAYMENT_STATUS_LABEL, PER_MATCH_AMOUNT, SQUAD_TARGET, WIN_POINTS } from "@/lib/sifup-constants";
import type { ClubExpense, Match, MatchPlayer, MatchResult, MonthlyPayment, PaymentPlan, PaymentStatus, Player, SifupData, Team } from "@/lib/types";

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

  return players.find((player) => player.name.toLowerCase() === clean || player.nickname.toLowerCase() === clean);
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d]/g, "");
}

function whatsappHref(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  const withCountry = normalized.startsWith("56") ? normalized : `56${normalized}`;
  return `https://wa.me/${withCountry}`;
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

function isMonthlyMatchRow(row: MatchPlayer, players: Player[]) {
  return playerForMatchRow(row, players)?.paymentPlan === "monthly" || row.note.toLowerCase().includes("mensualidad");
}

function buildPlayerStandings(data: SifupData) {
  const ranked = data.players
    .map((player) => {
      const appearances = data.matchPlayers.filter((row) => (row.name === player.name || row.playerId === player.id) && row.attendanceStatus === "confirmed");
      let wins = 0;
      let draws = 0;
      appearances.forEach((row) => {
        const result = data.results.find((item) => item.matchId === row.matchId);
        if (!result || row.team === "none") return;
        if (result.winner === "draw") draws += 1;
        else if (result.winner === row.team) wins += 1;
      });
      const winRate = appearances.length ? Math.round((wins / appearances.length) * 100) : 0;
      return {
        id: player.id,
        name: player.name,
        played: appearances.length,
        winRate,
        points: wins * WIN_POINTS + draws * DRAW_POINTS,
      };
    })
    .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played);

  return new Map(ranked.flatMap((row, index) => {
    const standing = { rank: index + 1, points: row.points };
    return [[row.id, standing], [row.name.toLowerCase(), standing]] as const;
  }));
}

function computePlayerStats(player: Player, data: SifupData) {
  const appearances = data.matchPlayers.filter((row) => (row.name === player.name || row.playerId === player.id) && row.attendanceStatus === "confirmed");
  let wins = 0;
  let losses = 0;
  let draws = 0;
  appearances.forEach((row) => {
    const result = data.results.find((item) => item.matchId === row.matchId);
    if (!result || row.team === "none") return;
    if (result.winner === "draw") draws += 1;
    else if (result.winner === row.team) wins += 1;
    else losses += 1;
  });
  const matchDebt = appearances.reduce((sum, row) => sum + Math.max(row.amountDue - row.amountPaid, 0), 0);
  const monthlyDebt = data.monthlyPayments.filter((payment) => payment.playerId === player.id).reduce((sum, payment) => sum + Math.max(payment.expectedAmount - payment.amountPaid, 0), 0);
  const decided = wins + losses + draws;
  return {
    appearances,
    played: appearances.length,
    wins,
    losses,
    draws,
    winRate: appearances.length ? Math.round((wins / appearances.length) * 100) : 0,
    points: wins * WIN_POINTS + draws * DRAW_POINTS,
    form: decided ? `${wins}-${draws}-${losses}` : "0-0-0",
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


function pendingForMatchRow(row: MatchPlayer) {
  return Math.max(row.amountDue - row.amountPaid, 0);
}

function sortRowsWithMonthlyLast(rows: MatchPlayer[], players: Player[]) {
  return [...rows].sort((a, b) => {
    const monthlyA = isMonthlyMatchRow(a, players) ? 1 : 0;
    const monthlyB = isMonthlyMatchRow(b, players) ? 1 : 0;
    if (monthlyA !== monthlyB) return monthlyA - monthlyB;
    return whatsappOrderFor(a) - whatsappOrderFor(b) || a.name.localeCompare(b.name);
  });
}

function PageTitle({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
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

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel p-4 ${className}`}>{children}</section>;
}

function Button({
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

function PaymentBadge({ status }: { status: PaymentStatus }) {
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

function teamDot(team: Team) {
  if (team === "A") return "bg-(--red)";
  if (team === "B") return "bg-(--gold)";
  return "bg-white/30";
}

function TeamToggle({ value, onChange, disabled }: { value: Team; onChange: (team: Team) => void; disabled?: boolean }) {
  const options: { team: "A" | "B"; label: string; selected: string; idle: string }[] = [
    { team: "A", label: "Rojo", selected: "bg-(--red) text-white border-(--red)", idle: "border-(--red)/35 text-(--red) bg-(--red)/10 hover:bg-(--red)/20" },
    { team: "B", label: "Amarillo", selected: "bg-(--gold) text-(--bg-deep) border-(--gold)", idle: "border-(--gold)/35 text-(--gold) bg-(--gold)/10 hover:bg-(--gold)/20" },
  ];
  return (
    <div className="inline-flex gap-1.5">
      {options.map((option) => (
        <button
          key={option.team}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.team)}
          className={`h-7 rounded-full border px-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${value === option.team ? option.selected : option.idle}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="panel max-h-[90vh] w-full max-w-lg overflow-auto p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-(--muted) hover:bg-white/[0.08] hover:text-white" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(key: string) {
  const value = new Date(`${key}-10T12:00:00`);
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(value);
}

function paymentDueLabel(key: string) {
  return `10/${key.slice(5)}`;
}

const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function monthlyPaymentFor(player: Player, month: string, existing?: MonthlyPayment): MonthlyPayment {
  if (existing) return existing;
  const now = new Date().toISOString();
  return {
    id: `monthly-${month}-${player.id}`,
    playerId: player.id,
    monthKey: month,
    expectedAmount: MONTHLY_AMOUNT,
    amountPaid: 0,
    paymentStatus: "unpaid",
    note: `Mensualidad ${monthLabel(month)}, vencimiento ${paymentDueLabel(month)}`,
    createdAt: now,
    updatedAt: now,
  };
}

function paymentsWithCurrentMonth(data: SifupData, month: string) {
  const current = data.players
    .filter((player) => player.active && player.paymentPlan === "monthly")
    .map((player) => monthlyPaymentFor(player, month, data.monthlyPayments.find((payment) => payment.playerId === player.id && payment.monthKey === month)));
  const currentIds = new Set(current.map((payment) => payment.id));
  return [...data.monthlyPayments.filter((payment) => !currentIds.has(payment.id)), ...current];
}

function upsertMonthlyPayment(payments: MonthlyPayment[], payment: MonthlyPayment) {
  return payments.some((item) => item.id === payment.id || (item.playerId === payment.playerId && item.monthKey === payment.monthKey))
    ? payments.map((item) => (item.id === payment.id || (item.playerId === payment.playerId && item.monthKey === payment.monthKey) ? payment : item))
    : [...payments, payment];
}

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
        {match ? <CopyBlock title="Resumen del partido" text={matchSummaryMessage(match, rows)} /> : null}
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
            id: newId("match"),
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
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-bold text-white">
                            Rojo {result.scoreA} - {result.scoreB} Amarillo
                          </h2>
                          <p className="mt-1 text-sm font-medium text-(--muted)">
                            {match.weekLabel || match.date} · {result.winner === "draw" ? "Empate" : `Gana ${teamLabel(result.winner)}`}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <StatusBadge value={matchStatusLabel(match.status)} />
                        </div>
                      </div>
                      {winners.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {winners.map((w) => (
                            <span key={w.id} className="inline-flex items-center rounded bg-(--green)/15 px-1.5 py-0.5 text-[9px] font-black text-(--green) uppercase tracking-wider">
                              {w.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
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

function TeamSuggestionPreview<T extends TeamAssignableRow>({ rows, players, standings }: { rows: T[]; players: Player[]; standings: Map<string, PlayerStanding> }) {
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

export function NewMatchPage({ initialData }: InitialDataProps) {
  const router = useRouter();
  const { data, commit } = useSifupData(initialData);
  const [isPending, startTransition] = useTransition();
  const [raw, setRaw] = useState(sampleInput);
  const [match, setMatch] = useState({ date: "", time: "21:00", location: "", totalCost: COURT_COST, notes: "" });
  const [rows, setRows] = useState<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const standings = useMemo(() => buildPlayerStandings(data), [data]);

  function parse() {
    const parsed = parseWhatsAppList(raw, PER_MATCH_AMOUNT);
    setMatch({ ...parsed.match, totalCost: COURT_COST });
    setRows(applyBalancedTeams(parsed.players, data.players, standings));
    setErrors(parsed.errors);
  }

  function updateRow(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((current) => {
      const nextRows = current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
      return applyBalancedTeams(nextRows, data.players, standings);
    });
  }

  function save() {
    if (!match.date || !match.time || rows.length === 0) {
      setErrors(["Completa fecha, hora y al menos un jugador antes de guardar."]);
      return;
    }
    const now = new Date().toISOString();
    const matchId = newId("match");
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
      createdAt: now,
      updatedAt: now,
    };
    const balancedRows = applyBalancedTeams(rows, data.players, standings);
    const nextRows: MatchPlayer[] = balancedRows.map((row) => {
      const player = findKnownPlayer(data.players, row.name);
      const monthly = player?.paymentPlan === "monthly";
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
    startTransition(async () => {
      try {
        await createMatchAction(nextMatch, nextRows);
        commit(replaceMatchPlayers(upsertMatch(data, nextMatch), matchId, nextRows));
        router.push(`/matches/${matchId}`);
      } catch (error) {
        setErrors([error instanceof Error ? error.message : "No se pudo guardar el partido."]);
      }
    });
  }

  return (
    <>
      <PageTitle title="Nuevo partido" description="Pega la lista WhatsApp, revisa la tabla editable y guarda en la base." />
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
          <TeamSuggestionPreview rows={rows} players={data.players} standings={standings} />
          <MatchEditor match={match} setMatch={setMatch} rows={rows} updateRow={updateRow} knownLocations={data.matches.map((item) => item.location)} lastLocation={data.matches[0]?.location ?? ""} />
        </div>
      </div>
    </>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
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
}: {
  match: { date: string; time: string; location: string; totalCost: number; notes: string };
  setMatch: (value: { date: string; time: string; location: string; totalCost: number; notes: string }) => void;
  rows: Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[];
  updateRow: (index: number, patch: Partial<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">>) => void;
  knownLocations: string[];
  lastLocation: string;
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
      <EditableRows rows={rows} updateRow={updateRow} />
    </Card>
  );
}

function EditableRows({
  rows,
  updateRow,
}: {
  rows: Array<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt"> | MatchPlayer>;
  updateRow: (index: number, patch: Partial<MatchPlayer>) => void;
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
              <label className="space-y-1 text-sm font-medium text-(--muted)">
                <span>Equipo</span>
                <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}>
                  <option value="none">Sin equipo</option><option value="A">Rojo</option><option value="B">Amarillo</option>
                </select>
              </label>
              <Input label="Nota" value={row.note} onChange={(value) => updateRow(index, { note: value })} />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="border-b border-(--border) text-xs uppercase text-(--muted)">
            <tr><th className="py-2 pr-2">#</th><th className="py-2 pr-2">Jugador</th><th className="py-2 pr-2">Pago</th><th className="py-2 pr-2">Debe</th><th className="py-2 pr-2">Pagado</th><th className="py-2 pr-2">Equipo</th><th className="py-2 pr-2">Nota</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td className="py-2 pr-2"><input className="h-9 w-16 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" type="number" value={row.whatsappOrder || index + 1} onChange={(event) => updateRow(index, { whatsappOrder: Number(event.target.value) })} /></td>
                <td className="py-2 pr-2"><input className="h-9 w-44 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} /></td>
                <td className="py-2 pr-2"><select className="h-9 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.paymentStatus} onChange={(event) => updateRow(index, { paymentStatus: event.target.value as PaymentStatus })}><option value="paid">Pagado</option><option value="unpaid">No pagado</option><option value="promised">Prometido</option></select></td>
                <td className="py-2 pr-2"><input className="h-9 w-24 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" type="number" value={row.amountDue} onChange={(event) => updateRow(index, { amountDue: Number(event.target.value) })} /></td>
                <td className="py-2 pr-2"><input className="h-9 w-24 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" type="number" value={row.amountPaid} onChange={(event) => updateRow(index, { amountPaid: Number(event.target.value) })} /></td>
                <td className="py-2 pr-2"><select className="h-9 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}><option value="none">Sin equipo</option><option value="A">Rojo</option><option value="B">Amarillo</option></select></td>
                <td className="py-2 pr-2"><input className="h-9 w-44 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.note} onChange={(event) => updateRow(index, { note: event.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PublicMatchRows({ rows, players, standings }: { rows: MatchPlayer[]; players: Player[]; standings: Map<string, PlayerStanding> }) {
  const confirmedRows = rankedConfirmedRows(rows, players, standings);
  const outRows = rows.filter((row) => row.attendanceStatus === "out");
  const teamsAssigned = hasTeamsAssigned(rows);
  const teamA = confirmedRows.filter((row) => row.team === "A");
  const teamB = confirmedRows.filter((row) => row.team === "B");
  const unassigned = confirmedRows.filter((row) => row.team === "none");
  const pointsA = teamRankingTotal(rows, players, standings, "A");
  const pointsB = teamRankingTotal(rows, players, standings, "B");

  const renderRow = (row: MatchPlayer) => (
    <PlayerCollectionRow
      key={row.id}
      row={row}
      players={players}
      standings={standings}
      teamsAssigned={teamsAssigned}
      isAdmin={false}
    />
  );

  return (
    <div className="space-y-4">
      {teamsAssigned ? (
        <>
          {unassigned.length > 0 ? (
            <div className="space-y-2 rounded-md border border-(--border) bg-white/[0.04] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--muted)">Sin asignar ({unassigned.length})</p>
              <div className="space-y-2">{unassigned.map(renderRow)}</div>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
            <div className="space-y-2 rounded-md border-2 border-(--red)/35 bg-(--red)/10 p-3">
              <p className="text-sm font-bold text-(--red)">Equipo Rojo ({teamA.length}) - {pointsA} pts ranking</p>
              <div className="space-y-2">
                {teamA.map(renderRow)}
                {teamA.length === 0 ? <p className="text-sm text-(--muted)">Sin jugadores</p> : null}
              </div>
            </div>
            <div className="hidden items-center justify-center px-2 lg:flex">
              <span className="rounded-full bg-white/[0.12] px-3 py-1 text-xs font-bold text-(--muted)">VS</span>
            </div>
            <div className="space-y-2 rounded-md border-2 border-(--gold)/35 bg-(--gold)/10 p-3">
              <p className="text-sm font-bold text-(--gold)">Equipo Amarillo ({teamB.length}) - {pointsB} pts ranking</p>
              <div className="space-y-2">
                {teamB.map(renderRow)}
                {teamB.length === 0 ? <p className="text-sm text-(--muted)">Sin jugadores</p> : null}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-2">{confirmedRows.map(renderRow)}</div>
      )}
      {outRows.length > 0 ? (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--muted)">No pueden ({outRows.length})</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {outRows.map((row) => (
              <span key={row.id} className="rounded-md border border-white/10 bg-black/15 px-2 py-1 text-xs font-bold text-(--muted)">{row.name}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlayerCollectionRow({
  row,
  players,
  standings,
  teamsAssigned,
  isAdmin,
  onTeamChange,
  onOpenDetails,
  onRemove,
}: {
  row: MatchPlayer;
  players: Player[];
  standings: Map<string, PlayerStanding>;
  teamsAssigned: boolean;
  isAdmin: boolean;
  onTeamChange?: (team: Team) => void;
  onOpenDetails?: () => void;
  onRemove?: () => void;
}) {
  const standing = standingForMatchRow(row, players, standings);
  const whatsapp = whatsappHref(row.phone);
  const player = playerForMatchRow(row, players);
  const playerId = player?.id;
  const isArq = player?.isGoalkeeper === true;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-(--border) bg-white/[0.04] px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white/[0.08] px-2 text-xs font-bold text-(--muted) ring-1 ring-(--border)">{standing ? `#${standing.rank}` : "-"}</span>
        {teamsAssigned ? <span className={`h-3 w-3 shrink-0 rounded-full ${teamDot(row.team)}`} /> : null}
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">
            {playerId ? <Link href={`/players/${playerId}`} className="hover:underline">{row.name}</Link> : row.name}
            {isArq ? (
              <span className="ml-2 inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-500 uppercase tracking-wider gap-0.5" title="Arquero">
                🧤 ARQ
              </span>
            ) : null}
          </p>
          <p className="text-xs text-(--muted)">{standing ? `${standing.points} pts` : "Sin ranking"}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && onTeamChange ? <TeamToggle value={row.team} onChange={onTeamChange} /> : null}
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-(--green) hover:bg-(--green)/15" aria-label={`WhatsApp ${row.name}`}>
            <MessageCircle size={16} />
          </a>
        ) : null}
        {isAdmin && onOpenDetails ? (
          <button type="button" onClick={onOpenDetails} className="rounded-md p-1.5 text-(--muted) hover:bg-white/[0.14]" aria-label={`Editar ${row.name}`}>
            <Pencil size={16} />
          </button>
        ) : null}
        {isAdmin && onRemove ? (
          <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-(--red) hover:bg-(--red)/15" aria-label={`Quitar ${row.name} del partido`}>
            <UserMinus size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TeamAssignmentBoard({
  rows,
  players,
  standings,
  onOpenDetails,
  onRemove,
  onAddPlayer,
}: {
  rows: MatchPlayer[];
  players: Player[];
  standings: Map<string, PlayerStanding>;
  onOpenDetails: (rowId: string) => void;
  onRemove: (rowId: string) => void;
  onAddPlayer: () => void;
}) {
  const confirmedRanked = rankedConfirmedRows(rows, players, standings);
  const outRows = sortRowsWithMonthlyLast(rows.filter((row) => row.attendanceStatus === "out"), players);
  const confirmedCount = confirmedRanked.length;
  const missing = Math.max(SQUAD_TARGET - confirmedCount, 0);

  const renderRow = (row: MatchPlayer) => (
    <PlayerCollectionRow
      key={row.id}
      row={row}
      players={players}
      standings={standings}
      teamsAssigned={false}
      isAdmin
      onOpenDetails={() => onOpenDetails(row.id)}
      onRemove={() => onRemove(row.id)}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className={`rounded-md border px-3 py-2 ${missing > 0 ? "border-(--gold)/40 bg-(--gold)/10" : "border-(--green)/40 bg-(--green)/10"}`}>
          <p className="text-[11px] font-black uppercase tracking-wide text-(--muted)">Plantel</p>
          <p className={`text-xl font-black ${missing > 0 ? "text-(--gold)" : "text-(--green)"}`}>{confirmedCount}/{SQUAD_TARGET} · faltan {missing}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onAddPlayer}>
            <UserPlus size={16} />
            Agregar jugador
          </Button>
        </div>
      </div>
      <div className="space-y-2">{confirmedRanked.map(renderRow)}</div>
      {outRows.length > 0 ? (
        <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--muted)">No pueden ({outRows.length})</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {outRows.map((row) => (
              <OutPlayerRow key={row.id} row={row} onOpenDetails={() => onOpenDetails(row.id)} onRemove={() => onRemove(row.id)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OutPlayerRow({ row, onOpenDetails, onRemove }: { row: MatchPlayer; onOpenDetails: () => void; onRemove: () => void }) {
  const whatsapp = whatsappHref(row.phone);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/15 px-3 py-2">
      <p className="min-w-0 truncate text-sm font-semibold text-(--muted)"><span className="mr-2 text-xs">#{row.whatsappOrder || "-"}</span>{row.name}</p>
      <div className="flex items-center gap-1">
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-(--green) hover:bg-(--green)/15" aria-label={`WhatsApp ${row.name}`}>
            <MessageCircle size={16} />
          </a>
        ) : null}
        <button type="button" onClick={onOpenDetails} className="rounded-md p-1.5 text-(--muted) hover:bg-white/[0.14]" aria-label={`Editar ${row.name}`}>
          <Pencil size={16} />
        </button>
        <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-(--red) hover:bg-(--red)/15" aria-label={`Quitar ${row.name} del partido`}>
          <UserMinus size={16} />
        </button>
      </div>
    </div>
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
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <Modal title="Agregar jugador al partido" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-(--muted)">Jugadores existentes</p>
          <div className="max-h-56 space-y-1 overflow-auto">
            {candidates.length === 0 ? <p className="text-sm text-(--muted)">Todos los jugadores activos ya estan en este partido.</p> : null}
            {candidates.map((player) => (
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

function PlayerDetailModal({
  row,
  onClose,
  onSave,
}: {
  row: MatchPlayer;
  onClose: () => void;
  onSave: (patch: Partial<MatchPlayer>) => void;
}) {
  const [draft, setDraft] = useState(row);
  return (
    <Modal title={`Editar ${row.name}`} onClose={onClose}>
      <div className="space-y-3">
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
        <Button onClick={() => onSave(draft)}><Save size={16} />Guardar</Button>
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

function rankedConfirmedRows(rows: MatchPlayer[], players: Player[], standings: Map<string, PlayerStanding>) {
  return rows
    .filter((row) => row.attendanceStatus === "confirmed")
    .sort((a, b) => {
      const rankA = standingForMatchRow(a, players, standings)?.rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = standingForMatchRow(b, players, standings)?.rank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return whatsappOrderFor(a) - whatsappOrderFor(b) || a.name.localeCompare(b.name);
    });
}

function teamRankingTotal(rows: MatchPlayer[], players: Player[], standings: Map<string, PlayerStanding>, team: "A" | "B") {
  return rows
    .filter((row) => row.team === team && row.attendanceStatus === "confirmed")
    .reduce((sum, row) => sum + (standingForMatchRow(row, players, standings)?.points ?? 0), 0);
}

function MatchHero({
  match,
  rows,
  result,
  players,
  standings,
  isAdmin,
  onSave,
  isPending,
  previous,
  next,
}: {
  match: Match;
  rows: MatchPlayer[];
  result?: MatchResult;
  players: Player[];
  standings: Map<string, PlayerStanding>;
  isAdmin: boolean;
  onSave: () => void;
  isPending: boolean;
  previous?: Match;
  next?: Match;
}) {
  const summary = summarizeMatch(rows);
  const upcoming = matchIsUpcoming(match);
  const showResult = Boolean(result && !upcoming);
  const teamA = rows.filter((row) => row.team === "A" && row.attendanceStatus === "confirmed");
  const teamB = rows.filter((row) => row.team === "B" && row.attendanceStatus === "confirmed");
  const pointsA = teamRankingTotal(rows, players, standings, "A");
  const pointsB = teamRankingTotal(rows, players, standings, "B");
  const confirmed = summary.confirmedCount;
  const missing = Math.max(SQUAD_TARGET - confirmed, 0);

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

          {hasTeamsAssigned(rows) || showResult ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
            <div className="rounded-lg border border-(--red)/35 bg-(--red)/10 p-4">
              <p className="text-sm font-black uppercase tracking-wide text-(--red)">Equipo Rojo</p>
              <p className="mt-2 text-5xl font-black leading-none text-white">{showResult ? result?.scoreA : teamA.length}</p>
              <p className="mt-1 text-xs font-bold uppercase text-(--muted)">{showResult ? "goles" : `jugadores · ${pointsA} pts`}</p>
            </div>
            <div className="grid place-items-center">
              <span className="rounded-full border border-white/15 bg-white/[0.08] px-4 py-2 text-sm font-black text-white">VS</span>
            </div>
            <div className="rounded-lg border border-(--gold)/45 bg-(--gold)/10 p-4 lg:text-right">
              <p className="text-sm font-black uppercase tracking-wide text-(--gold)">Equipo Amarillo</p>
              <p className="mt-2 text-5xl font-black leading-none text-white">{showResult ? result?.scoreB : teamB.length}</p>
              <p className="mt-1 text-xs font-bold uppercase text-(--muted)">{showResult ? "goles" : `jugadores · ${pointsB} pts`}</p>
            </div>
          </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function MatchDetailPage({ id, initialData }: { id: string } & InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [isPending, startTransition] = useTransition();
  const match = data.matches.find((item) => item.id === id);
  const result = data.results.find((item) => item.matchId === id);
  const [rows, setRows] = useState(() => data.matchPlayers.filter((row) => row.matchId === id));
  const [scoreA, setScoreA] = useState(result?.scoreA ?? 0);
  const [scoreB, setScoreB] = useState(result?.scoreB ?? 0);
  const [resultNotes, setResultNotes] = useState(result?.notes ?? "");
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const standings = useMemo(() => buildPlayerStandings(data), [data]);

  if (!match) return <PageTitle title="Partido no encontrado" description="No existe en la base de datos." />;
  const currentMatch = match;
  const { previous, next } = adjacentMatches(data.matches, currentMatch.id);

  function updateRow(index: number, patch: Partial<MatchPlayer>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row)));
  }

  function removeRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
  }

  function buildMatchPlayerRow(player: Player): MatchPlayer {
    const now = new Date().toISOString();
    const monthly = player.paymentPlan === "monthly";
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

  function addExistingPlayer(player: Player) {
    setRows((current) => [...current, buildMatchPlayerRow(player)]);
    setShowAddPlayer(false);
  }

  function createAndAddPlayer(name: string, phone: string) {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const player: Player = { id: newId("player"), name: name.trim(), nickname: name.trim().split(" ")[0], phone: phone.trim(), paymentPlan: "perMatch", skillLevel: 3, active: true, shortName: name.trim().slice(0, 3).toUpperCase(), isGoalkeeper: name.toLowerCase().includes("arquero"), createdAt: now, updatedAt: now };
    savePlayerAction(player)
      .then(() => {
        commit(upsertPlayer(data, player));
        setRows((current) => [...current, buildMatchPlayerRow(player)]);
        setShowAddPlayer(false);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo crear el jugador."));
  }

  function save() {
    const derivedWinner: MatchResult["winner"] = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "draw";
    const nextResult: MatchResult = { id: result?.id ?? newId("result"), matchId: currentMatch.id, scoreA, scoreB, winner: derivedWinner, notes: resultNotes };
    startTransition(async () => {
      try {
        await saveMatchDetailAction(currentMatch.id, rows, nextResult);
        commit(upsertResult(replaceMatchPlayers(data, currentMatch.id, rows), nextResult));
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el partido.");
      }
    });
  }

  return (
    <>
      <MatchHero
        match={currentMatch}
        rows={rows}
        result={result}
        players={data.players}
        standings={standings}
        isAdmin={isAdmin}
        onSave={save}
        isPending={isPending}
        previous={previous}
        next={next}
      />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: equipos y resultado son solo lectura." /> : null}
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}

      {/* Marcador final / Resultado en la parte superior */}
      <div className="mt-4">
        {isAdmin ? (
          <Card className="space-y-4">
            <div>
              <h2 className="font-semibold">Resultado final</h2>
              <p className="mt-1 text-sm text-(--muted)">Ingresá el marcador real. El ganador se infiere automáticamente.</p>
            </div>
            <div className="flex items-center justify-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-black uppercase tracking-wide text-(--red)">Rojo</span>
                <input
                  type="number"
                  min={0}
                  value={scoreA}
                  onChange={(e) => setScoreA(Math.max(0, Number(e.target.value)))}
                  className="h-16 w-20 rounded-md border border-(--red)/40 bg-(--red)/10 text-center text-3xl font-black text-(--red) focus:outline-none focus:border-(--red)"
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-sm font-black text-(--muted)">vs</span>
                {(() => {
                  const w = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "draw";
                  return (
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${w === "A" ? "bg-(--red)/20 text-(--red)" : w === "B" ? "bg-(--gold)/20 text-(--gold)" : "bg-white/10 text-(--muted)"}`}>
                      {w === "A" ? "Gana Rojo" : w === "B" ? "Gana Amarillo" : "Empate"}
                    </span>
                  );
                })()}
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-black uppercase tracking-wide text-(--gold)">Amarillo</span>
                <input
                  type="number"
                  min={0}
                  value={scoreB}
                  onChange={(e) => setScoreB(Math.max(0, Number(e.target.value)))}
                  className="h-16 w-20 rounded-md border border-(--gold)/40 bg-(--gold)/10 text-center text-3xl font-black text-(--gold) focus:outline-none focus:border-(--gold)"
                />
              </div>
            </div>
            <p className="text-xs text-(--muted) text-center">
              Usá "Editar" en cada jugador para registrar los goles individuales.
            </p>
            <textarea className="min-h-16 w-full rounded-md border border-(--border) bg-(--panel-strong) p-2 text-sm text-white" value={resultNotes} onChange={(event) => setResultNotes(event.target.value)} placeholder="Notas del resultado (opcional)" />
          </Card>
        ) : result && !matchIsUpcoming(currentMatch) ? (
          <Card>
            <h2 className="font-semibold">Resultado final</h2>
            <p className="mt-2 text-3xl font-black">
              <span className="text-(--red)">{result.scoreA}</span>
              <span className="text-(--muted) mx-3">-</span>
              <span className="text-(--gold)">{result.scoreB}</span>
            </p>
            <p className="mt-1 text-sm text-(--muted)">
              Rojo vs Amarillo · {result.winner === "draw" ? "Empate" : `Gana ${teamLabel(result.winner)}`}
            </p>
          </Card>
        ) : null}
      </div>

      <Card className="mt-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Plantel</p>
            <h2 className="mt-1 text-xl font-black text-white">{isAdmin ? "Jugadores" : "Lista de jugadores"}</h2>
          </div>
        </div>
        {isAdmin ? (
          <TeamAssignmentBoard
            rows={rows}
            players={data.players}
            standings={standings}
            onOpenDetails={(rowId) => setEditingIndex(rows.findIndex((row) => row.id === rowId))}
            onRemove={removeRow}
            onAddPlayer={() => setShowAddPlayer(true)}
          />
        ) : (
          <PublicMatchRows rows={rows} players={data.players} standings={standings} />
        )}
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <CopyBlock title="Resumen de equipos" text={teamsMessage(currentMatch, rows)} />
        <CopyBlock title="Resumen del partido" text={matchSummaryMessage(currentMatch, rows)} />
      </div>

      {/* Equipos informativos al final */}
      {hasTeamsAssigned(rows) ? (
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
    </>
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
  const monthlyPlayers = data.players
    .filter((player) => player.active && player.paymentPlan === "monthly")
    .sort((a, b) => a.name.localeCompare(b.name));
  const allMonthlyPayments = paymentsWithCurrentMonth(data, month);
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
        id: newId("player"),
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
      <PageTitle title="Pagos" description={`Mensualidades con vencimiento los dias 10, pagos por partido y balance del club.`} />
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

function isGalletaRow(row: MatchPlayer, players: Player[]) {
  const player = players.find((item) => item.id === row.playerId);
  return !player || player.paymentPlan !== "monthly";
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
    const rows = data.matchPlayers.filter((row) => row.matchId === match.id && isGalletaRow(row, data.players));
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
    const player: Player = { id: newId("player"), name: name.trim(), nickname: name.trim().split(" ")[0], phone: "", paymentPlan: "perMatch", skillLevel: 3, active: true, shortName: name.trim().slice(0, 3).toUpperCase(), isGoalkeeper: name.toLowerCase().includes("arquero"), createdAt: now, updatedAt: now };
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
  const oficiales = visiblePlayers.filter((player) => player.paymentPlan === "monthly");
  const galletas = visiblePlayers.filter((player) => player.paymentPlan === "perMatch");
  const month = currentMonthKey();

  return (
    <>
      <PageTitle title="Jugadores" description={isAdmin ? "Oficiales: mensualidad del mes actual e historico de pagos. Galletas: deuda acumulada por partido." : "Lista publica de jugadores activos."} />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: telefonos, WhatsApp y edicion quedan ocultos." /> : null}
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      {isAdmin ? <Card className="mb-4 flex gap-2"><input className="h-10 min-w-0 flex-1 rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre del jugador nuevo" /><Button onClick={addPlayer}><Plus size={16} />Agregar</Button></Card> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">Oficiales</h2>
          <p className="text-xs text-(--muted)">Mensualidad de {month} y meses anteriores.</p>
          {oficiales.map((player) => {
            const payment = monthlyPaymentFor(player, month, data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === month));
            const paid = payment?.paymentStatus === "paid";
            const history = upsertMonthlyPayment(data.monthlyPayments.filter((item) => item.playerId === player.id), payment);
            return (
              <PlayerRow key={player.id} player={player} isAdmin={isAdmin} onEdit={() => setEditingPlayer(player)}>
                <PaymentBadge status={paid ? "paid" : payment?.paymentStatus ?? "unpaid"} />
                <PaymentHistory payments={history} />
              </PlayerRow>
            );
          })}
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Galletas</h2>
          {galletas.map((player) => {
            const debt = data.matchPlayers
              .filter((row) => row.playerId === player.id)
              .reduce((sum, row) => sum + Math.max(row.amountDue - row.amountPaid, 0), 0);
            return (
              <PlayerRow key={player.id} player={player} isAdmin={isAdmin} onEdit={() => setEditingPlayer(player)}>
                <span className="rounded-full bg-white/[0.08] px-2 py-1 text-xs font-semibold text-(--muted) ring-1 ring-(--border)">{formatCurrency(debt)}</span>
              </PlayerRow>
            );
          })}
        </Card>
      </div>
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

function PlayerRow({
  player,
  isAdmin,
  onEdit,
  children,
}: {
  player: Player;
  isAdmin: boolean;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const whatsapp = whatsappHref(player.phone);
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-(--border) bg-white/[0.04] px-3 py-2">
      <div>
        <p className="font-semibold text-white">{player.name}</p>
        <p className="text-sm text-(--muted)">{player.nickname || "Sin pseudonimo"}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {children}
        {isAdmin && whatsapp ? (
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--green) bg-(--green) px-3 text-sm font-bold text-(--bg-deep) hover:bg-(--green-dark) hover:text-white"
          >
            <MessageCircle size={16} />
            Cobrar
          </a>
        ) : null}
        {isAdmin ? <Button variant="secondary" onClick={onEdit}>Editar</Button> : null}
      </div>
    </div>
  );
}

function PlayerEditorForm({ player, onSave, players = [] }: { player: Player; onSave: (patch: Partial<Player>) => void; players?: Player[] }) {
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
      <label className="space-y-1 text-sm font-medium text-(--muted)">
        <span>Plan</span>
        <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={draft.paymentPlan} onChange={(event) => setDraft({ ...draft, paymentPlan: event.target.value as PaymentPlan })}>
          <option value="monthly">mensual (oficial)</option>
          <option value="perMatch">por partido (galleta)</option>
        </select>
      </label>
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

      {otherPlayers.length > 0 ? (
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

export function PlayerDetailPage({ id, initialData }: { id: string } & InitialDataProps) {
  const { data } = useSifupData(initialData);
  const player = data.players.find((item) => item.id === id);
  if (!player) return <PageTitle title="Jugador no encontrado" description="No existe en la base de datos." />;

  const stats = computePlayerStats(player, data);
  const history = stats.appearances
    .map((row) => ({ row, match: data.matches.find((item) => item.id === row.matchId), result: data.results.find((item) => item.matchId === row.matchId) }))
    .filter((item) => item.match)
    .sort((a, b) => (b.match?.date ?? "").localeCompare(a.match?.date ?? ""));

  return (
    <>
      <PageTitle title={player.name} description={`${player.paymentPlan === "monthly" ? "Oficial" : "Galleta"} · ${player.nickname || "Sin pseudonimo"}`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Partidos jugados" value={stats.played} />
        <Stat label="G-E-P" value={stats.form} />
        <Stat label="Win rate" value={`${stats.winRate}%`} />
        <Stat label="Puntos" value={stats.points} />
      </div>
      <Card className="mt-4">
        <p className="text-xs font-black uppercase tracking-wide text-(--muted)">Deuda pendiente</p>
        <p className={`mt-1 text-2xl font-black ${stats.pendingDebt > 0 ? "text-(--red)" : "text-(--green)"}`}>{formatCurrency(stats.pendingDebt)}</p>
      </Card>
      <Card className="mt-4 space-y-2">
        <h2 className="font-semibold">Historial de partidos</h2>
        {history.length === 0 ? <p className="text-sm text-(--muted)">Todavia no jugo ningun partido.</p> : null}
        {history.map(({ row, match, result }) => (
          <Link
            key={row.id}
            href={`/matches/${match?.id}`}
            className="flex flex-col gap-1 rounded-md border border-(--border) bg-white/[0.04] px-3 py-2 text-sm hover:bg-white/[0.08] sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-semibold text-white">{match?.weekLabel || match?.date}</p>
              <p className="text-xs text-(--muted)">{match?.date} · {teamLabel(row.team)}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-(--muted)">
              {result ? <span>Rojo {result.scoreA} - {result.scoreB} Amarillo</span> : <span>Sin resultado</span>}
              <span className={pendingForMatchRow(row) > 0 ? "text-(--red)" : "text-(--green)"}>{formatCurrency(pendingForMatchRow(row))}</span>
            </div>
          </Link>
        ))}
      </Card>
    </>
  );
}

export function StandingsPage({ initialData }: InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [error, setError] = useState("");

  const filteredStandings = useMemo(() => {
    const baseStandings = data.players.map((player) => {
      const stats = computePlayerStats(player, data);
      return {
        id: player.id,
        player: player.name,
        nickname: player.nickname,
        plan: player.paymentPlan,
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

  const last5Matches = useMemo(() => {
    return [...data.matches]
      .filter((match) => data.results.some((r) => r.matchId === match.id))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [data]);

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
                      Rojo {result.scoreA} - {result.scoreB} Amarillo
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

  const confirmedRows = rows.filter((r) => r.attendanceStatus === "confirmed");
  const teamA = confirmedRows.filter((row) => row.team === "A");
  const teamB = confirmedRows.filter((row) => row.team === "B");
  const unassigned = confirmedRows.filter((row) => row.team === "none");

  const pointsA = teamA.reduce((sum, row) => sum + (standingForMatchRow(row, data.players, standings)?.points ?? 0), 0);
  const pointsB = teamB.reduce((sum, row) => sum + (standingForMatchRow(row, data.players, standings)?.points ?? 0), 0);

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
        {/* Sugerencia preview */}
        <TeamSuggestionPreview rows={rows} players={data.players} standings={standings} />

        <div className="flex justify-between items-center bg-white/[0.04] p-3 rounded-md border border-(--border)">
          <div className="flex gap-4 text-xs font-bold uppercase">
            <span className="text-(--red)">Rojo: {pointsA} pts ({teamA.length} jug)</span>
            <span className="text-(--gold)">Amarillo: {pointsB} pts ({teamB.length} jug)</span>
          </div>
          <Button variant="secondary" onClick={resetBalancedTeams} disabled={isPending}>
            <Sparkles size={16} />
            Equilibrar por Ranking
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="space-y-3 border-t-2 border-t-(--red)/70 bg-(--red)/5">
            <h2 className="font-bold text-(--red)">Equipo Rojo ({teamA.length})</h2>
            <div className="space-y-2">
              {teamA.map((row) => (
                <TeamSelectorRow key={row.id} row={row} onChange={(team) => handleTeamChange(row.id, team)} players={data.players} standings={standings} />
              ))}
              {teamA.length === 0 ? <p className="text-sm text-(--muted) italic">Sin jugadores asignados</p> : null}
            </div>
          </Card>

          <Card className="space-y-3 border-t-2 border-t-(--gold)/70 bg-(--gold)/5">
            <h2 className="font-bold text-(--gold)">Equipo Amarillo ({teamB.length})</h2>
            <div className="space-y-2">
              {teamB.map((row) => (
                <TeamSelectorRow key={row.id} row={row} onChange={(team) => handleTeamChange(row.id, team)} players={data.players} standings={standings} />
              ))}
              {teamB.length === 0 ? <p className="text-sm text-(--muted) italic">Sin jugadores asignados</p> : null}
            </div>
          </Card>

          <Card className="space-y-3 md:col-span-2 lg:col-span-1">
            <h2 className="font-bold text-white">Sin equipo / Pendientes ({unassigned.length})</h2>
            <div className="space-y-2">
              {unassigned.map((row) => (
                <TeamSelectorRow key={row.id} row={row} onChange={(team) => handleTeamChange(row.id, team)} players={data.players} standings={standings} />
              ))}
              {unassigned.length === 0 ? <p className="text-sm text-(--muted) italic">Todos asignados</p> : null}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function TeamSelectorRow({ row, onChange, players, standings }: { row: MatchPlayer; onChange: (team: Team) => void; players: Player[]; standings: Map<string, PlayerStanding> }) {
  const isArq = playerForMatchRow(row, players)?.isGoalkeeper === true;
  const standing = standingForMatchRow(row, players, standings);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/5 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-semibold text-white">
          {row.name}
          {isArq ? (
            <span className="ml-2 inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-500 uppercase tracking-wider gap-0.5" title="Arquero">
              🧤 ARQ
            </span>
          ) : null}
        </p>
        <p className="text-xs text-(--muted)">{standing ? `${standing.points} pts` : "Sin ranking"}</p>
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onChange("A")}
          className={`h-8 px-3 text-xs font-black uppercase rounded transition ${row.team === "A" ? "bg-(--red) text-white" : "bg-white/[0.08] text-(--muted) hover:bg-white/[0.14]"}`}
        >
          Rojo
        </button>
        <button
          type="button"
          onClick={() => onChange("B")}
          className={`h-8 px-3 text-xs font-black uppercase rounded transition ${row.team === "B" ? "bg-(--gold) text-white" : "bg-white/[0.08] text-(--muted) hover:bg-white/[0.14]"}`}
        >
          Amarillo
        </button>
        <button
          type="button"
          onClick={() => onChange("none")}
          className={`h-8 px-3 text-xs font-black uppercase rounded transition ${row.team === "none" ? "bg-white/[0.2] text-white" : "bg-white/[0.08] text-(--muted) hover:bg-white/[0.14]"}`}
        >
          Ninguno
        </button>
      </div>
    </div>
  );
}

export function PlayerComparisonPage({ initialData }: InitialDataProps) {
  const { data } = useSifupData(initialData);

  const allStats = useMemo(() => {
    return data.players
      .filter((p) => p.active)
      .map((player) => {
        const stats = computePlayerStats(player, data);
        const totalGoals = data.matchPlayers
          .filter((mp) => (mp.playerId === player.id || mp.name === player.name) && mp.attendanceStatus === "confirmed")
          .reduce((sum, mp) => sum + (mp.goals ?? 0), 0);
        return {
          id: player.id,
          name: player.name,
          nickname: player.nickname,
          shortName: player.shortName,
          isGoalkeeper: player.isGoalkeeper,
          plan: player.paymentPlan,
          skillLevel: player.skillLevel,
          ...stats,
          goals: totalGoals,
        };
      });
  }, [data]);

  // Top goleador: jugador de campo con más goles
  const topScorers = useMemo(() =>
    [...allStats]
      .filter((r) => r.played > 0)
      .sort((a, b) => b.goals - a.goals || b.played - a.played)
      .slice(0, 5),
    [allStats]
  );

  // Mejor arquero: jugadores marcados como arquero, por rendimiento y partidos jugados
  const topGoalkeepers = useMemo(() =>
    [...allStats]
      .filter((r) => r.isGoalkeeper && r.played > 0)
      .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.played - a.played)
      .slice(0, 3),
    [allStats]
  );

  const maxGoals = topScorers[0]?.goals || 1;

  return (
    <div className="max-w-4xl mx-auto w-full px-4 pt-4 pb-12 space-y-6">
      <section className="hero">
        <div className="hero-bg" aria-hidden="true" />
        <div className="hero-copy">
          <div className="label-row">
            <span>SIFUP</span>
            <strong>Premios de la temporada</strong>
          </div>
          <h1>Mejores jugadores</h1>
          <p>Goleador de la temporada y mejor arquero por rendimiento acumulado.</p>
        </div>
        <div className="hero-metrics" aria-label="Totales">
          {topScorers[0] ? (
            <article className="metric lime">
              <span>⚽ Goleador</span>
              <strong style={{ fontSize: "13px" }}>{topScorers[0].shortName || topScorers[0].name.split(" ")[0]}</strong>
            </article>
          ) : null}
          {topGoalkeepers[0] ? (
            <article className="metric cyan">
              <span>🧤 Arquero</span>
              <strong style={{ fontSize: "13px" }}>{topGoalkeepers[0].shortName || topGoalkeepers[0].name.split(" ")[0]}</strong>
            </article>
          ) : null}
        </div>
      </section>

      {/* Goleador */}
      <section className="panel" style={{ padding: "20px 24px" }}>
        <div className="panel-heading" style={{ marginBottom: "20px" }}>
          <div>
            <h2>⚽ Tabla de goleadores</h2>
            <p>Goles registrados por partido. Registrá los goles desde el detalle de cada partido.</p>
          </div>
        </div>

        {topScorers.length === 0 || topScorers[0].goals === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>Aún no hay goles registrados. Editá a los jugadores en cada partido para agregar goles.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {topScorers.map((row, index) => {
              const pct = maxGoals > 0 ? (row.goals / maxGoals) * 100 : 0;
              const isTop = index === 0;
              return (
                <div key={row.id} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ minWidth: "24px", textAlign: "right", fontSize: "13px", fontWeight: 900, color: isTop ? "var(--gold)" : "var(--muted)" }}>
                    {index + 1}
                  </span>
                  <span style={{
                    minWidth: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: "50%", background: isTop ? "var(--gold)" : "rgba(255,255,255,0.08)",
                    fontSize: "11px", fontWeight: 900, color: isTop ? "#000" : "var(--muted)", flexShrink: 0,
                  }}>
                    {row.shortName ? row.shortName.toUpperCase().slice(0, 2) : row.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: isTop ? "var(--gold)" : "white" }}>
                        {row.name}
                      </span>
                      <span style={{ fontSize: "18px", fontWeight: 900, color: isTop ? "var(--gold)" : "var(--green)", marginLeft: "8px", flexShrink: 0 }}>
                        {row.goals} <span style={{ fontSize: "11px", fontWeight: 500, opacity: 0.7 }}>gol{row.goals !== 1 ? "es" : ""}</span>
                      </span>
                    </div>
                    <div style={{ height: "6px", borderRadius: "4px", background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: "4px", background: isTop ? "var(--gold)" : "var(--green)", transition: "width 0.4s ease" }} />
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "3px" }}>
                      {row.played} PJ · {row.goals > 0 ? `1 cada ${(row.played / row.goals).toFixed(1)} partidos` : "sin goles"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Mejor arquero */}
      <section className="panel" style={{ padding: "20px 24px" }}>
        <div className="panel-heading" style={{ marginBottom: "20px" }}>
          <div>
            <h2>🧤 Mejor arquero</h2>
            <p>Jugadores marcados como arquero, ordenados por rendimiento (victorias / partidos).</p>
          </div>
        </div>

        {topGoalkeepers.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>
            No hay jugadores marcados como arquero. Activá la opción en el perfil del jugador.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {topGoalkeepers.map((row, index) => {
              const isTop = index === 0;
              return (
                <div key={row.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", borderRadius: "10px", background: isTop ? "rgba(18,214,154,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${isTop ? "rgba(18,214,154,0.2)" : "rgba(255,255,255,0.06)"}` }}>
                  <span style={{ fontSize: "20px" }}>{index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}</span>
                  <span style={{
                    minWidth: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: "50%", background: isTop ? "var(--green)" : "rgba(255,255,255,0.1)",
                    fontSize: "12px", fontWeight: 900, color: isTop ? "var(--bg-deep)" : "var(--muted)", flexShrink: 0,
                  }}>
                    {row.shortName ? row.shortName.toUpperCase().slice(0, 2) : row.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontSize: "15px", fontWeight: 800, color: isTop ? "var(--green)" : "white" }}>
                          {row.name}
                        </span>
                        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                          {row.played} PJ · {row.form} · {row.plan === "monthly" ? "Oficial" : "Galleta"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "12px" }}>
                        <div style={{ fontSize: "22px", fontWeight: 900, color: isTop ? "var(--green)" : "white" }}>
                          {row.winRate}%
                        </div>
                        <div style={{ fontSize: "10px", color: "var(--muted)" }}>rendimiento</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Tabla completa */}
      <section className="panel ranking-panel">
        <div className="ranking-head">
          <div>
            <h2>Tabla completa con goles</h2>
            <p>Todos los jugadores activos con sus goles registrados.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Jugador</th>
                <th className="text-center" style={{ color: "var(--gold)" }}>Pts</th>
                <th className="text-center">Rend %</th>
                <th className="optional text-center">PJ</th>
                <th className="optional text-center">G</th>
                <th className="optional text-center">E</th>
                <th className="optional text-center">P</th>
                <th className="text-center" style={{ color: "var(--green)" }}>⚽</th>
              </tr>
            </thead>
            <tbody>
              {[...allStats]
                .filter((r) => r.played > 0)
                .sort((a, b) => b.goals - a.goals || b.points - a.points)
                .map((row, index) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 900, color: index === 0 ? "var(--gold)" : undefined }}>{index + 1}</td>
                    <td>
                      <div className="player">
                        <span className={row.plan !== "monthly" ? "galleta-bubble" : undefined}>
                          {row.shortName ? row.shortName.toUpperCase() : row.name.slice(0, 2).toUpperCase()}
                        </span>
                        <strong>
                          <div className="flex items-center gap-1.5">
                            <b>{row.name}</b>
                            {row.isGoalkeeper ? (
                              <span className="inline-flex items-center rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-black text-amber-500 uppercase tracking-wider gap-0.5">
                                🧤 ARQ
                              </span>
                            ) : null}
                          </div>
                          <small>{row.plan === "monthly" ? "Oficial" : "Galleta"}</small>
                        </strong>
                      </div>
                    </td>
                    <td className="points-cell text-center" style={{ fontSize: "18px", color: "var(--gold)", fontWeight: 1000 }}>{row.points}</td>
                    <td className="text-center" style={{ fontWeight: 700 }}>{row.winRate}%</td>
                    <td className="optional text-center">{row.played}</td>
                    <td className="optional text-center">{row.wins}</td>
                    <td className="optional text-center">{row.draws}</td>
                    <td className="optional text-center">{row.losses}</td>
                    <td className="text-center" style={{ fontWeight: 900, fontSize: "16px", color: row.goals > 0 ? "var(--green)" : "var(--muted)" }}>{row.goals}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
