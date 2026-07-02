"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, ChevronLeft, ChevronRight, Clipboard, Medal, MessageCircle, Pencil, Plus, Save, Shield, Sparkles, Trophy, UserMinus, UserPlus, Users, WalletCards, X } from "lucide-react";
import {
  createMatchAction,
  markMatchPlayerPaidAction,
  saveMatchDetailAction,
  saveMonthlyPaymentAction,
  savePlayerAction,
  setMatchPlayerPaymentStatusAction,
} from "@/app/actions";
import { useIsAdmin } from "./AuthMode";
import { parseWhatsAppList } from "@/lib/parser";
import { adjacentMatches, formatCurrency, newId, nextMatch, replaceMatchPlayers, summarizeMatch, upsertMatch, upsertPlayer, upsertResult, whatsappOrderFor } from "@/lib/store";
import { finalResultMessage, matchSummaryMessage, pendingPaymentsMessage, teamsMessage } from "@/lib/whatsapp";
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

const PER_MATCH_AMOUNT = 3500;
const MONTHLY_AMOUNT = 20000;
const COURT_COST = 35000;

type InitialDataProps = { initialData: SifupData };

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

function teamLabel(team: Team) {
  if (team === "A") return "Rojo";
  if (team === "B") return "Amarillo";
  return "Sin equipo";
}

function playerForMatchRow(row: MatchPlayer, players: Player[]) {
  return players.find((player) => player.id === row.playerId) ?? findKnownPlayer(players, row.name);
}

function isMonthlyMatchRow(row: MatchPlayer, players: Player[]) {
  return playerForMatchRow(row, players)?.paymentPlan === "monthly" || row.note.toLowerCase().includes("mensualidad");
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
  return <span className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${styles[status]}`}>{status}</span>;
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

function PaymentToggle({ status, onToggle, disabled }: { status: PaymentStatus; onToggle: () => void; disabled?: boolean }) {
  const paid = status === "paid";
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`inline-flex h-11 w-32 items-center justify-center rounded-md border text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        paid ? "border-(--green) bg-(--green) text-(--bg-deep) hover:bg-(--green-dark) hover:text-white" : "border-(--red)/35 bg-(--red)/10 text-(--red) hover:bg-(--red)/20"
      }`}
    >
      {paid ? "Pagado" : "No pagado"}
    </button>
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
        {isAdmin ? <CtaLink href="/matches/new"><Plus size={16} />New match</CtaLink> : null}
      </div>
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: entra como admin para crear partidos y editar pagos." /> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{match?.weekLabel || match?.date} - {match?.time}</h2>
              <p className="mt-1 text-sm text-(--muted)">{match?.location}</p>
            </div>
            {match ? <StatusBadge value={match.status} /> : null}
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
        {match ? <CopyBlock title="Clean match summary" text={matchSummaryMessage(match, rows)} /> : null}
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
        title="Matches"
        description="Martes registrados por semana, pagos y asistencia."
        action={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={createUpcomingMatches} disabled={isPending}>
                <CalendarPlus size={16} />
                Crear proximas 2 fechas
              </Button>
              <CtaLink href="/matches/new"><Plus size={16} />New match</CtaLink>
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
          return data.matches.map((match) => {
            const rows = data.matchPlayers.filter((row) => row.matchId === match.id);
            const summary = summarizeMatch(rows);
            const isNext = match.id === nextId;
            return (
              <Link key={match.id} href={`/matches/${match.id}`} className="block">
                <Card className={`transition hover:border-(--lime)/40 ${isNext ? "border-(--lime) bg-(--lime)/10 ring-2 ring-(--lime)/30" : ""}`}>
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
                      <StatusBadge value={match.status} />
                      {match.courtPrepaid ? <span className="rounded-full bg-(--green)/15 px-2 py-1 text-xs font-bold text-(--green) ring-1 ring-(--green)/30">cancha pagada</span> : null}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <span>{summary.confirmedCount} jugadores</span>
                    <span>{summary.paidCount} pagados</span>
                    <span>{formatCurrency(summary.pendingAmount)} pend.</span>
                  </div>
                </Card>
              </Link>
            );
          });
        })()}
      </div>
    </>
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

  function parse() {
    const parsed = parseWhatsAppList(raw, PER_MATCH_AMOUNT);
    setMatch({ ...parsed.match, totalCost: COURT_COST });
    setRows(parsed.players);
    setErrors(parsed.errors);
  }

  function updateRow(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
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
    const nextRows: MatchPlayer[] = rows.map((row) => {
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
      <PageTitle title="New match" description="Pega la lista WhatsApp, revisa la tabla editable y guarda en la base." />
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="space-y-3">
          <textarea
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            className="min-h-72 w-full rounded-md border border-(--border) bg-(--panel-strong) p-3 text-sm text-white outline-none focus:border-(--green) focus:ring-4 focus:ring-(--green)/20"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={parse}><WalletCards size={16} />Paste WhatsApp list</Button>
            <Button onClick={save} variant="secondary" disabled={isPending}><Save size={16} />Save match</Button>
          </div>
          {errors.map((error) => <p key={error} className="rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p>)}
        </Card>
        <MatchEditor match={match} setMatch={setMatch} rows={rows} updateRow={updateRow} knownLocations={data.matches.map((item) => item.location)} lastLocation={data.matches[0]?.location ?? ""} />
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
        <Input label="Date" type="date" value={match.date} onChange={(date) => setMatch({ ...match, date })} />
        <Input label="Time" type="time" value={match.time} onChange={(time) => setMatch({ ...match, time })} />
        <div className="space-y-1 sm:col-span-2">
          <label className="space-y-1 text-sm font-medium text-(--muted)">
            <span>Location</span>
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
        <Input label="Total cost" type="number" value={String(match.totalCost)} onChange={(totalCost) => setMatch({ ...match, totalCost: Number(totalCost) })} />
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
              <Input label="Player" value={row.name} onChange={(value) => updateRow(index, { name: value })} />
              <label className="space-y-1 text-sm font-medium text-(--muted)">
                <span>Payment</span>
                <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={row.paymentStatus} onChange={(event) => updateRow(index, { paymentStatus: event.target.value as PaymentStatus })}>
                  <option value="paid">paid</option><option value="unpaid">unpaid</option><option value="promised">promised</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Due" type="number" value={String(row.amountDue)} onChange={(value) => updateRow(index, { amountDue: Number(value) })} />
                <Input label="Paid" type="number" value={String(row.amountPaid)} onChange={(value) => updateRow(index, { amountPaid: Number(value) })} />
              </div>
              <label className="space-y-1 text-sm font-medium text-(--muted)">
                <span>Team</span>
                <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}>
                  <option value="none">Sin equipo</option><option value="A">Rojo</option><option value="B">Amarillo</option>
                </select>
              </label>
              <Input label="Note" value={row.note} onChange={(value) => updateRow(index, { note: value })} />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="border-b border-(--border) text-xs uppercase text-(--muted)">
            <tr><th className="py-2 pr-2">#</th><th className="py-2 pr-2">Player</th><th className="py-2 pr-2">Payment</th><th className="py-2 pr-2">Due</th><th className="py-2 pr-2">Paid</th><th className="py-2 pr-2">Team</th><th className="py-2 pr-2">Note</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td className="py-2 pr-2"><input className="h-9 w-16 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" type="number" value={row.whatsappOrder || index + 1} onChange={(event) => updateRow(index, { whatsappOrder: Number(event.target.value) })} /></td>
                <td className="py-2 pr-2"><input className="h-9 w-44 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} /></td>
                <td className="py-2 pr-2"><select className="h-9 rounded-md border border-(--border) bg-(--panel-strong) px-2 text-white" value={row.paymentStatus} onChange={(event) => updateRow(index, { paymentStatus: event.target.value as PaymentStatus })}><option value="paid">paid</option><option value="unpaid">unpaid</option><option value="promised">promised</option></select></td>
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

function PublicMatchRows({ rows, players }: { rows: MatchPlayer[]; players: Player[] }) {
  const sortedRows = sortRowsWithMonthlyLast(rows, players);
  return (
    <div className="space-y-2">
      {sortedRows.map((row, index) => {
        const monthly = isMonthlyMatchRow(row, players);
        const pending = pendingForMatchRow(row);
        return (
        <div key={row.id} className={`flex flex-col gap-2 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between ${monthly ? "border-(--cyan)/45 bg-(--cyan)/10" : "border-(--border) bg-white/[0.04]"}`}>
          <div className="flex items-center gap-2">
            <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white/[0.08] px-2 text-xs font-bold text-(--muted) ring-1 ring-(--border)">{row.whatsappOrder || index + 1}</span>
            <span className={`h-3 w-3 shrink-0 rounded-full ${teamDot(row.team)}`} />
            <div>
              <p className="font-semibold text-white">{row.name} {monthly ? <span className="ml-2 rounded bg-(--cyan)/20 px-1.5 py-0.5 text-[10px] font-black uppercase text-(--cyan)">Mensual</span> : null}</p>
              <p className="text-xs text-(--muted)">{teamLabel(row.team)} - Falta {formatCurrency(pending)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2"><PaymentBadge status={row.paymentStatus} /><span className="rounded-full bg-white/[0.08] px-2 py-1 text-xs font-semibold text-(--muted) ring-1 ring-(--border)">{formatCurrency(pending)}</span></div>
        </div>
        );
      })}
    </div>
  );
}

function PlayerRosterRow({
  row,
  monthly,
  onTeamChange,
  onOpenDetails,
  onRemove,
}: {
  row: MatchPlayer;
  monthly: boolean;
  onTeamChange: (team: Team) => void;
  onOpenDetails: () => void;
  onRemove: () => void;
}) {
  const whatsapp = whatsappHref(row.phone);
  const pending = pendingForMatchRow(row);
  return (
    <div className={`space-y-2 rounded-md border p-3 ${monthly ? "border-(--cyan)/45 bg-(--cyan)/10" : "border-(--border) bg-white/[0.04]"}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-white"><span className="mr-2 text-xs text-(--muted)">#{row.whatsappOrder || "-"}</span>{row.name}</p>
          <p className="mt-0.5 text-xs text-(--muted)">Falta {formatCurrency(pending)} {monthly ? <span className="ml-2 rounded bg-(--cyan)/20 px-1.5 py-0.5 text-[10px] font-black uppercase text-(--cyan)">Mensual</span> : null}</p>
        </div>
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
      <TeamToggle value={row.team} onChange={onTeamChange} />
    </div>
  );
}

function TeamAssignmentBoard({
  rows,
  players,
  onTeamChange,
  onOpenDetails,
  onRemove,
  onAddPlayer,
}: {
  rows: MatchPlayer[];
  players: Player[];
  onTeamChange: (rowId: string, team: Team) => void;
  onOpenDetails: (rowId: string) => void;
  onRemove: (rowId: string) => void;
  onAddPlayer: () => void;
}) {
  const teamA = sortRowsWithMonthlyLast(rows.filter((row) => row.team === "A"), players);
  const teamB = sortRowsWithMonthlyLast(rows.filter((row) => row.team === "B"), players);
  const unassigned = sortRowsWithMonthlyLast(rows.filter((row) => row.team === "none"), players);
  const pendingAmount = summarizeMatch(rows).pendingAmount;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="rounded-md border border-(--pink)/35 bg-(--pink)/10 px-3 py-2">
          <p className="text-[11px] font-black uppercase tracking-wide text-(--muted)">Falta recaudar</p>
          <p className="text-xl font-black text-(--pink)">{formatCurrency(pendingAmount)}</p>
        </div>
        <Button variant="secondary" onClick={onAddPlayer}>
          <UserPlus size={16} />
          Agregar jugador
        </Button>
      </div>
      {unassigned.length > 0 ? (
        <div className="space-y-2 rounded-md border border-(--border) bg-white/[0.04] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--muted)">Sin asignar ({unassigned.length})</p>
          <div className="space-y-2 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0 xl:grid-cols-3">
            {unassigned.map((row) => (
              <PlayerRosterRow key={row.id} row={row} monthly={isMonthlyMatchRow(row, players)} onTeamChange={(team) => onTeamChange(row.id, team)} onOpenDetails={() => onOpenDetails(row.id)} onRemove={() => onRemove(row.id)} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <div className="space-y-2 rounded-md border-2 border-(--red)/35 bg-(--red)/10 p-3">
          <p className="text-sm font-bold text-(--red)">Equipo Rojo ({teamA.length})</p>
          <div className="space-y-2">
            {teamA.map((row) => (
              <PlayerRosterRow key={row.id} row={row} monthly={isMonthlyMatchRow(row, players)} onTeamChange={(team) => onTeamChange(row.id, team)} onOpenDetails={() => onOpenDetails(row.id)} onRemove={() => onRemove(row.id)} />
            ))}
            {teamA.length === 0 ? <p className="text-sm text-(--muted)">Sin jugadores</p> : null}
          </div>
        </div>
        <div className="hidden items-center justify-center px-2 lg:flex">
          <span className="rounded-full bg-white/[0.12] px-3 py-1 text-xs font-bold text-(--muted)">VS</span>
        </div>
        <div className="space-y-2 rounded-md border-2 border-(--gold)/35 bg-(--gold)/10 p-3">
          <p className="text-sm font-bold text-(--gold)">Equipo Amarillo ({teamB.length})</p>
          <div className="space-y-2">
            {teamB.map((row) => (
              <PlayerRosterRow key={row.id} row={row} monthly={isMonthlyMatchRow(row, players)} onTeamChange={(team) => onTeamChange(row.id, team)} onOpenDetails={() => onOpenDetails(row.id)} onRemove={() => onRemove(row.id)} />
            ))}
            {teamB.length === 0 ? <p className="text-sm text-(--muted)">Sin jugadores</p> : null}
          </div>
        </div>
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
            <option value="confirmed">confirmed</option>
            <option value="maybe">maybe</option>
            <option value="out">out</option>
            <option value="waitlist">waitlist</option>
          </select>
        </label>
        <Input label="# WhatsApp" type="number" value={String(draft.whatsappOrder)} onChange={(value) => setDraft({ ...draft, whatsappOrder: Number(value) })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Due" type="number" value={String(draft.amountDue)} onChange={(value) => setDraft({ ...draft, amountDue: Number(value) })} />
          <Input label="Paid" type="number" value={String(draft.amountPaid)} onChange={(value) => setDraft({ ...draft, amountPaid: Number(value) })} />
        </div>
        <Input label="Nota" value={draft.note} onChange={(value) => setDraft({ ...draft, note: value })} />
        <Button onClick={() => onSave(draft)}><Save size={16} />Guardar</Button>
      </div>
    </Modal>
  );
}

function PaymentCollectionRow({ row, monthly, onToggle, disabled }: { row: MatchPlayer; monthly: boolean; onToggle: () => void; disabled?: boolean }) {
  const pending = pendingForMatchRow(row);
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${monthly ? "border-(--cyan)/45 bg-(--cyan)/10" : "border-(--border) bg-white/[0.04]"}`}>
      <div>
        <p className="font-semibold text-white"><span className="mr-2 text-xs text-(--muted)">#{row.whatsappOrder || "-"}</span>{row.name} {monthly ? <span className="ml-2 rounded bg-(--cyan)/20 px-1.5 py-0.5 text-[10px] font-black uppercase text-(--cyan)">Mensual</span> : null}</p>
        <p className="text-sm text-(--muted)">{pending > 0 ? `Pendiente ${formatCurrency(pending)}` : "Sin saldo pendiente"}</p>
      </div>
      <PaymentToggle status={row.paymentStatus} onToggle={onToggle} disabled={disabled} />
    </div>
  );
}

export function MatchDetailPage({ id, initialData }: { id: string } & InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [isPending, startTransition] = useTransition();
  const [paymentPending, setPaymentPending] = useState<string | null>(null);
  const match = data.matches.find((item) => item.id === id);
  const result = data.results.find((item) => item.matchId === id);
  const [rows, setRows] = useState(() => data.matchPlayers.filter((row) => row.matchId === id));
  const [scoreA, setScoreA] = useState(result?.scoreA ?? 0);
  const [scoreB, setScoreB] = useState(result?.scoreB ?? 0);
  const [resultNotes, setResultNotes] = useState(result?.notes ?? "");
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const summary = summarizeMatch(rows);
  const collectionRows = sortRowsWithMonthlyLast(rows, data.players);

  if (!match) return <PageTitle title="Match not found" description="No existe en la base de datos." />;
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
    const player: Player = { id: newId("player"), name: name.trim(), nickname: name.trim().split(" ")[0], phone: phone.trim(), paymentPlan: "perMatch", skillLevel: 3, active: true, createdAt: now, updatedAt: now };
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
    const winner = scoreA === scoreB ? "draw" : scoreA > scoreB ? "A" : "B";
    const nextResult: MatchResult = { id: result?.id ?? newId("result"), matchId: currentMatch.id, scoreA, scoreB, winner, notes: resultNotes };
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

  function togglePayment(row: MatchPlayer, index: number) {
    const nextStatus = row.paymentStatus === "paid" ? "unpaid" : "paid";
    setPaymentPending(row.id);
    setMatchPlayerPaymentStatusAction(row.id, nextStatus)
      .then(() => {
        const patch = { paymentStatus: nextStatus, amountPaid: nextStatus === "paid" ? row.amountDue : 0 } as const;
        updateRow(index, patch);
        commit({ ...data, matchPlayers: data.matchPlayers.map((item) => (item.id === row.id ? { ...item, ...patch } : item)) });
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo actualizar el pago."))
      .finally(() => setPaymentPending(null));
  }

  return (
    <>
      <PageTitle
        title={`${currentMatch.weekLabel || currentMatch.date} - ${currentMatch.time}`}
        description={`${currentMatch.date} - ${currentMatch.location}`}
        action={
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
            <Link href={`/matches/${currentMatch.id}/teams`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
              <Users size={16} />
              Ver equipos
            </Link>
            {isAdmin ? <Button onClick={save} disabled={isPending}><Save size={16} />Save match</Button> : null}
          </div>
        }
      />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: equipos, resultado y pagos son solo lectura." /> : null}
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmed" value={summary.confirmedCount} /><Stat label="Paid" value={summary.paidCount} /><Stat label="Unpaid/promised" value={summary.unpaidCount + summary.promisedCount} /><Stat label="Pending" value={formatCurrency(summary.pendingAmount)} />
      </div>

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Jugadores y equipos</h2>
        {isAdmin ? (
          <TeamAssignmentBoard
            rows={rows}
            players={data.players}
            onTeamChange={(rowId, team) => updateRow(rows.findIndex((row) => row.id === rowId), { team })}
            onOpenDetails={(rowId) => setEditingIndex(rows.findIndex((row) => row.id === rowId))}
            onRemove={removeRow}
            onAddPlayer={() => setShowAddPlayer(true)}
          />
        ) : (
          <PublicMatchRows rows={rows} players={data.players} />
        )}
      </Card>

      <div className="mt-4">
        {isAdmin ? (
          <Card className="space-y-3">
            <h2 className="font-semibold">Final score</h2>
            <div className="grid grid-cols-2 gap-3"><Input label="Rojo" type="number" value={String(scoreA)} onChange={(value) => setScoreA(Number(value))} /><Input label="Amarillo" type="number" value={String(scoreB)} onChange={(value) => setScoreB(Number(value))} /></div>
            <textarea className="min-h-20 w-full rounded-md border border-(--border) bg-(--panel-strong) p-2 text-sm text-white" value={resultNotes} onChange={(event) => setResultNotes(event.target.value)} placeholder="Result notes" />
          </Card>
        ) : result ? (
          <Card><h2 className="font-semibold">Resultado final</h2><p className="mt-2 text-2xl font-semibold">Rojo {result.scoreA} - {result.scoreB} Amarillo</p><p className="mt-1 text-sm text-(--muted)">{result.winner === "draw" ? "Empate" : `Gana ${teamLabel(result.winner)}`}</p></Card>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CopyBlock title="Payment pending summary" text={pendingPaymentsMessage(currentMatch, rows)} />
        <CopyBlock title="Teams summary" text={teamsMessage(currentMatch, rows)} />
        <CopyBlock title="Final result summary" text={finalResultMessage(currentMatch, { id: result?.id ?? "preview", matchId: currentMatch.id, scoreA, scoreB, winner: scoreA === scoreB ? "draw" : scoreA > scoreB ? "A" : "B", notes: resultNotes })} />
      </div>

      <Card className="mt-4 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold">Cobranza</h2>
          <div className="rounded-md border border-(--pink)/35 bg-(--pink)/10 px-3 py-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-(--muted)">Falta recaudar</p>
            <p className="text-lg font-black text-(--pink)">{formatCurrency(summary.pendingAmount)}</p>
          </div>
        </div>
        {isAdmin
          ? collectionRows.map((row) => (
              <PaymentCollectionRow key={row.id} row={row} monthly={isMonthlyMatchRow(row, data.players)} onToggle={() => togglePayment(row, rows.findIndex((item) => item.id === row.id))} disabled={paymentPending === row.id} />
            ))
          : collectionRows.map((row, index) => {
              const monthly = isMonthlyMatchRow(row, data.players);
              const pending = pendingForMatchRow(row);
              return (
              <div key={row.id} className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${monthly ? "border-(--cyan)/45 bg-(--cyan)/10" : "border-(--border) bg-white/[0.04]"}`}>
                <p className="font-semibold text-white"><span className="mr-2 text-xs text-(--muted)">#{row.whatsappOrder || index + 1}</span>{row.name}</p>
                <div className="flex items-center gap-2">{monthly ? <span className="rounded bg-(--cyan)/20 px-1.5 py-0.5 text-[10px] font-black uppercase text-(--cyan)">Mensual</span> : null}<PaymentBadge status={row.paymentStatus} /><span className="rounded-full bg-white/[0.08] px-2 py-1 text-xs font-semibold text-(--muted) ring-1 ring-(--border)">{formatCurrency(pending)}</span></div>
              </div>
              );
            })}
      </Card>

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
  const month = currentMonthKey();
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

  function markPaid(row: MatchPlayer) {
    const updated = { ...row, paymentStatus: "paid" as const, amountPaid: row.amountDue, updatedAt: new Date().toISOString() };
    markMatchPlayerPaidAction(row.id)
      .then(() => commit({ ...data, matchPlayers: data.matchPlayers.map((item) => (item.id === row.id ? updated : item)) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo marcar como pagado."));
  }

  function markMonthlyPaid(payment: MonthlyPayment) {
    const updated = { ...payment, paymentStatus: "paid" as const, amountPaid: payment.expectedAmount, updatedAt: new Date().toISOString() };
    saveMonthlyPaymentAction(updated)
      .then(() => commit({ ...data, monthlyPayments: upsertMonthlyPayment(data.monthlyPayments, updated) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar la mensualidad."));
  }

  return (
    <>
      <PageTitle title="Payments" description={`Mensualidades con vencimiento los dias 10, pagos por partido y balance del club.`} />
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
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-3">
          <div>
            <h2 className="font-semibold">Mensualidad {monthLabel(month)}</h2>
            <p className="text-sm text-(--muted)">Vence {paymentDueLabel(month)}. Si una cuota no existe en la base, se muestra como pendiente y se crea al marcarla pagada.</p>
          </div>
          {currentMonthlyPayments.map((payment) => {
            const player = data.players.find((item) => item.id === payment.playerId);
            const pending = Math.max(payment.expectedAmount - payment.amountPaid, 0);
            return (
              <div key={payment.id} className="flex flex-col gap-3 rounded-md border border-(--border) bg-white/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-semibold">{player?.name}</p><p className="text-sm text-(--muted)">{formatCurrency(payment.amountPaid)} / {formatCurrency(payment.expectedAmount)} - pendiente {formatCurrency(pending)}</p></div>
                <div className="flex items-center gap-2"><PaymentBadge status={payment.paymentStatus} />{isAdmin && pending > 0 ? <Button onClick={() => markMonthlyPaid(payment)}>Pagado</Button> : null}</div>
              </div>
            );
          })}
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Por partido</h2>
          {perMatchPending.map((row) => {
            const match = data.matches.find((item) => item.id === row.matchId);
            return (
              <div key={row.id} className="flex flex-col gap-3 rounded-md border border-(--border) bg-white/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-semibold">{row.name}</p><p className="mt-1 text-sm text-(--muted)">{match?.weekLabel || match?.date} - {match?.location}</p><p className="mt-1 text-sm font-medium">{formatCurrency(Math.max(row.amountDue - row.amountPaid, 0))}</p></div>
                <div className="flex items-center gap-2"><PaymentBadge status={row.paymentStatus} />{isAdmin ? <Button onClick={() => markPaid(row)}>Pagado</Button> : null}</div>
              </div>
            );
          })}
          {perMatchPending.length === 0 ? <p className="text-sm text-(--muted)">No hay pagos por partido pendientes.</p> : null}
        </Card>
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
    const player: Player = { id: newId("player"), name: name.trim(), nickname: name.trim().split(" ")[0], phone: "", paymentPlan: "perMatch", skillLevel: 3, active: true, createdAt: now, updatedAt: now };
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
        commit(upsertPlayer(data, updated));
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
      <PageTitle title="Players" description={isAdmin ? "Oficiales: mensualidad del mes actual e historico de pagos. Galletas: deuda acumulada por partido." : "Lista publica de jugadores activos."} />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: telefonos, WhatsApp y edicion quedan ocultos." /> : null}
      {error ? <p className="mb-4 rounded-md bg-(--gold)/15 px-3 py-2 text-sm font-bold text-(--gold)">{error}</p> : null}
      {isAdmin ? <Card className="mb-4 flex gap-2"><input className="h-10 min-w-0 flex-1 rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={name} onChange={(event) => setName(event.target.value)} placeholder="New player name" /><Button onClick={addPlayer}><Plus size={16} />Add</Button></Card> : null}
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
          <PlayerEditorForm player={editingPlayer} onSave={savePlayer} />
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

function PlayerEditorForm({ player, onSave }: { player: Player; onSave: (patch: Partial<Player>) => void }) {
  const [draft, setDraft] = useState(player);
  const whatsapp = whatsappHref(draft.phone);
  return (
    <div className="space-y-3">
      <Input label="Nombre" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
      <Input label="Pseudonimo" value={draft.nickname} onChange={(value) => setDraft({ ...draft, nickname: value })} />
      <Input label="Telefono" value={draft.phone} onChange={(value) => setDraft({ ...draft, phone: value })} />
      <label className="space-y-1 text-sm font-medium text-(--muted)">
        <span>Plan</span>
        <select className="h-10 w-full rounded-md border border-(--border) bg-(--panel-strong) px-3 text-sm text-white" value={draft.paymentPlan} onChange={(event) => setDraft({ ...draft, paymentPlan: event.target.value as PaymentPlan })}>
          <option value="monthly">mensual (oficial)</option>
          <option value="perMatch">por partido (galleta)</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-(--muted)">
        <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
        <span>Activo</span>
      </label>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => onSave(draft)}><Save size={16} />Guardar</Button>
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--green) bg-(--green) px-3 text-sm font-bold text-(--bg-deep) hover:bg-(--green-dark) hover:text-white"><MessageCircle size={16} />WhatsApp</a>
        ) : null}
      </div>
    </div>
  );
}

export function StandingsPage({ initialData }: InitialDataProps) {
  const { data } = useSifupData(initialData);
  const standings = useMemo(() => {
    return data.players.map((player) => {
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
        player: player.name,
        nickname: player.nickname,
        plan: player.paymentPlan,
        played: appearances.length,
        wins,
        losses,
        draws,
        winRate: appearances.length ? Math.round((wins / appearances.length) * 100) : 0,
        points: wins * 3 + draws * 2 + losses,
        form: decided ? `${wins}-${draws}-${losses}` : "0-0-0",
        pendingDebt: matchDebt + monthlyDebt,
      };
    }).sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played);
  }, [data]);

  const topThree = standings.slice(0, 3);
  const totalPlayed = data.results.length;
  const activePlayers = data.players.filter((player) => player.active).length;
  const totalPending = standings.reduce((sum, row) => sum + row.pendingDebt, 0);
  const averageWinRate = standings.length ? Math.round(standings.reduce((sum, row) => sum + row.winRate, 0) / standings.length) : 0;
  const recentResults = [...data.results]
    .map((result) => ({ result, match: data.matches.find((match) => match.id === result.matchId) }))
    .filter((item) => item.match)
    .sort((a, b) => (b.match?.date ?? "").localeCompare(a.match?.date ?? ""))
    .slice(0, 4);

  const rankClass = ["first", "second", "third"];

  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden="true"></div>
        <div className="hero-copy">
          <div className="label-row">
            <span>SIFUP</span>
            <strong>Tabla viva de los martes</strong>
          </div>
          <h1>Rankings</h1>
          <p>Vision general, resultados y rendimiento acumulado por jugador, con deuda pendiente siempre visible.</p>
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
          <article className="metric pink">
            <span>Win rate prom.</span>
            <strong>{averageWinRate}%</strong>
          </article>
          <article className="metric gold">
            <span>Deuda</span>
            <strong>{formatCurrency(totalPending)}</strong>
          </article>
        </div>
      </section>

      <nav className="section-nav" aria-label="Secciones del ranking">
        <a className="selected" href="#vision">Vision general</a>
        <a href="#top3">Top 3</a>
        <a href="#ranking">Ranking general</a>
        <a href="#resultados">Resultados</a>
      </nav>

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
                <span className="medal"><Medal size={14} /></span>
                <h3>{row.player}</h3>
                <p>{row.nickname || (row.plan === "monthly" ? "Oficial" : "Galleta")}</p>
                <div className="podium-footer">
                  <strong>{row.points}</strong>
                  <span>{row.winRate}%<small>{row.form}</small></span>
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
            {recentResults.map(({ result, match }) => (
              <article key={result.id} className="result-row">
                <div>
                  <strong>{match?.weekLabel || match?.date}</strong>
                  <span>{match?.location}</span>
                </div>
                <div className="score">
                  <b>Rojo</b> {result.scoreA} - {result.scoreB} <b>Amarillo</b>
                  <small>{result.winner === "draw" ? "Empate" : `Gana ${teamLabel(result.winner)}`}</small>
                </div>
              </article>
            ))}
            {recentResults.length === 0 ? <p className="text-sm text-(--muted)">Aun no hay resultados cerrados.</p> : null}
          </div>
        </article>
      </section>

      <section id="ranking" className="panel ranking-panel">
        <div className="ranking-head">
          <div>
            <h2>Ranking general</h2>
            <p>Ordenado por puntos, rendimiento y partidos jugados.</p>
          </div>
          <strong className="season-chip">Temporada actual</strong>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Jugador</th>
                <th className="optional">PJ</th>
                <th className="optional">G</th>
                <th className="optional">E</th>
                <th className="optional">P</th>
                <th className="optional">%</th>
                <th>Puntos</th>
                <th>Deuda</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, index) => (
                <tr key={row.player}>
                  <td>{index + 1}</td>
                  <td>
                    <div className="player">
                      <span>{row.player.slice(0, 2).toUpperCase()}</span>
                      <strong>{row.player}<small>{row.plan === "monthly" ? "Oficial" : "Galleta"} · {row.form}</small></strong>
                    </div>
                  </td>
                  <td className="optional">{row.played}</td>
                  <td className="optional">{row.wins}</td>
                  <td className="optional">{row.draws}</td>
                  <td className="optional">{row.losses}</td>
                  <td className="optional">{row.winRate}%</td>
                  <td className="points-cell">{row.points}</td>
                  <td className={row.pendingDebt > 0 ? "debt" : "ok"}>{formatCurrency(row.pendingDebt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function TeamsPage({ id, initialData }: { id: string } & InitialDataProps) {
  const { data } = useSifupData(initialData);
  const match = data.matches.find((item) => item.id === id);
  const rows = data.matchPlayers.filter((row) => row.matchId === id);

  if (!match) return <PageTitle title="Match not found" description="No existe en la base de datos." />;

  const teamA = rows.filter((row) => row.team === "A");
  const teamB = rows.filter((row) => row.team === "B");
  const unassigned = rows.filter((row) => row.team === "none");

  return (
    <>
      <PageTitle
        title={`Equipos - ${match.weekLabel || match.date}`}
        description={`${match.date} - ${match.location}`}
        action={
          <Link href={`/matches/${match.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-(--border) bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.12]">
            Volver al partido
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamColumn label="Equipo Rojo" rows={teamA} />
        <TeamColumn label="Equipo Amarillo" rows={teamB} />
      </div>
      {unassigned.length > 0 ? <div className="mt-4"><TeamColumn label="Sin equipo" rows={unassigned} /></div> : null}
    </>
  );
}

function TeamColumn({ label, rows }: { label: string; rows: MatchPlayer[] }) {
  return (
    <Card className="space-y-2">
      <h2 className="font-bold text-white">{label} ({rows.length})</h2>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="result-row"><strong><span className="mr-2 text-sm text-(--muted)">#{whatsappOrderFor(row)}</span>{row.name}</strong></li>
        ))}
        {rows.length === 0 ? <li className="text-sm text-(--muted)">Sin jugadores</li> : null}
      </ul>
    </Card>
  );
}
