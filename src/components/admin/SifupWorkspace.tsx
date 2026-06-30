"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Clipboard, MessageCircle, Plus, Save, Shield, WalletCards, X } from "lucide-react";
import {
  createMatchAction,
  markMatchPlayerPaidAction,
  saveMatchDetailAction,
  saveMonthlyPaymentAction,
  savePlayerAction,
} from "@/app/actions";
import { useIsAdmin } from "./AuthMode";
import { parseWhatsAppList } from "@/lib/parser";
import { formatCurrency, newId, replaceMatchPlayers, summarizeMatch, upsertMatch, upsertPlayer, upsertResult } from "@/lib/store";
import { finalResultMessage, matchSummaryMessage, pendingPaymentsMessage, teamsMessage } from "@/lib/whatsapp";
import type { Match, MatchPlayer, MatchResult, MonthlyPayment, PaymentPlan, PaymentStatus, Player, SifupData, Team } from "@/lib/types";

const sampleInput = `martes 30 junio, 21 horas, agrupacion de sordos:

1. Wictor (pagado)
2. Caldera (pagado)
3. Marcio (pagado)
4. Juanjo (pagado)
5. Beto (no pagado)
6. Francis (pagado)
7. Cooper (pagado)
8. Mantelli (no pagado)
9. Pololo de Francis (no pagado)
10. Mario Quintana (pagado)
11. Alonso Duran (pago manana)`;

const PER_MATCH_AMOUNT = 3500;
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

function PageTitle({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-950">{title}</h1>
        {description ? <p className="mt-1 text-sm leading-6 text-gray-600">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
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
    primary: "bg-emerald-700 text-white hover:bg-emerald-800 border-emerald-700",
    secondary: "bg-white text-gray-800 hover:bg-gray-100 border-gray-300",
    danger: "bg-red-600 text-white hover:bg-red-700 border-red-600",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function CtaLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
    >
      {children}
    </Link>
  );
}

function AdminOnlyNotice({ label = "Solo admin puede editar esta vista." }: { label?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      <Shield size={16} />
      {label}
    </div>
  );
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const styles = {
    paid: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    unpaid: "bg-red-50 text-red-800 ring-red-200",
    promised: "bg-amber-50 text-amber-800 ring-amber-200",
  };
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${styles[status]}`}>{status}</span>;
}

function StatusBadge({ value }: { value: string }) {
  return <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">{value}</span>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-950">{value}</p>
    </Card>
  );
}

function PaymentAccountCard({ data }: { data: SifupData }) {
  const finance = data.clubFinance;
  return (
    <Card className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Transferencias</p>
        <h2 className="mt-1 text-lg font-semibold text-gray-950">{finance.bank}</h2>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-gray-500">Cuenta</dt><dd className="font-semibold text-gray-950">{finance.account}</dd></div>
        <div><dt className="text-gray-500">Mail</dt><dd className="font-semibold text-gray-950">{finance.email}</dd></div>
        <div><dt className="text-gray-500">RUT</dt><dd className="font-semibold text-gray-950">{finance.rut}</dd></div>
        <div><dt className="text-gray-500">Cancha</dt><dd className="font-semibold text-gray-950">{formatCurrency(finance.courtCost)}</dd></div>
      </dl>
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
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
        <h3 className="text-sm font-semibold text-gray-950">{title}</h3>
        <Button variant="secondary" onClick={copy}>
          <Clipboard size={16} />
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-gray-950 p-3 text-xs leading-5 text-gray-50">{text}</pre>
    </Card>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 px-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100" aria-label="Cerrar">
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

function nextMatch(matches: Match[]) {
  return [...matches].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
}

export function DashboardPage({ initialData }: InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data } = useSifupData(initialData);
  const match = nextMatch(data.matches);
  const rows = data.matchPlayers.filter((row) => row.matchId === match?.id);
  const summary = summarizeMatch(rows);

  return (
    <>
      <PageTitle
        title="Dashboard"
        description="Resumen rapido del proximo partido y estado de pagos."
        action={isAdmin ? <CtaLink href="/matches/new"><Plus size={16} />New match</CtaLink> : undefined}
      />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: entra como admin para crear partidos y editar pagos." /> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmados" value={summary.confirmedCount} />
        <Stat label="Pagados" value={summary.paidCount} />
        <Stat label="Pendiente" value={formatCurrency(summary.pendingAmount)} />
        <Stat label="Recaudado" value={formatCurrency(summary.totalCollected)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{match?.weekLabel || match?.date} - {match?.time}</h2>
              <p className="mt-1 text-sm text-gray-600">{match?.location}</p>
            </div>
            {match ? <StatusBadge value={match.status} /> : null}
          </div>
          <div className="mt-4 divide-y divide-gray-100">
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
      {error ? <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p> : null}
      <div className="space-y-3">
        {data.matches.map((match) => {
          const rows = data.matchPlayers.filter((row) => row.matchId === match.id);
          const summary = summarizeMatch(rows);
          return (
            <Link key={match.id} href={`/matches/${match.id}`} className="block">
              <Card className="transition hover:border-emerald-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{match.weekLabel || match.date}</h2>
                    <p className="mt-1 text-sm font-medium text-gray-700">{match.date} - {match.time}</p>
                    <p className="mt-1 text-sm text-gray-600">{match.location}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge value={match.status} />
                    {match.courtPrepaid ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">cancha pagada</span> : null}
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
        })}
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
            className="min-h-72 w-full rounded-md border border-gray-300 p-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={parse}><WalletCards size={16} />Paste WhatsApp list</Button>
            <Button onClick={save} variant="secondary" disabled={isPending}><Save size={16} />Save match</Button>
          </div>
          {errors.map((error) => <p key={error} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>)}
        </Card>
        <MatchEditor match={match} setMatch={setMatch} rows={rows} updateRow={updateRow} knownLocations={data.matches.map((item) => item.location)} lastLocation={data.matches[0]?.location ?? ""} />
      </div>
    </>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="space-y-1 text-sm font-medium text-gray-700">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
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
        <div className="space-y-1">
          <label className="space-y-1 text-sm font-medium text-gray-700">
            <span>Location</span>
            <div className="flex gap-2">
              <input
                list="known-locations"
                value={match.location}
                onChange={(event) => setMatch({ ...match, location: event.target.value })}
                className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
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
          <div key={`${row.name}-${index}-card`} className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="grid gap-3">
              <Input label="Player" value={row.name} onChange={(value) => updateRow(index, { name: value })} />
              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Payment</span>
                <select className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm" value={row.paymentStatus} onChange={(event) => updateRow(index, { paymentStatus: event.target.value as PaymentStatus })}>
                  <option value="paid">paid</option><option value="unpaid">unpaid</option><option value="promised">promised</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Due" type="number" value={String(row.amountDue)} onChange={(value) => updateRow(index, { amountDue: Number(value) })} />
                <Input label="Paid" type="number" value={String(row.amountPaid)} onChange={(value) => updateRow(index, { amountPaid: Number(value) })} />
              </div>
              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Team</span>
                <select className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}>
                  <option value="none">none</option><option value="A">A</option><option value="B">B</option>
                </select>
              </label>
              <Input label="Note" value={row.note} onChange={(value) => updateRow(index, { note: value })} />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
            <tr><th className="py-2 pr-2">Player</th><th className="py-2 pr-2">Payment</th><th className="py-2 pr-2">Due</th><th className="py-2 pr-2">Paid</th><th className="py-2 pr-2">Team</th><th className="py-2 pr-2">Note</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td className="py-2 pr-2"><input className="h-9 w-44 rounded-md border border-gray-300 px-2" value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} /></td>
                <td className="py-2 pr-2"><select className="h-9 rounded-md border border-gray-300 px-2" value={row.paymentStatus} onChange={(event) => updateRow(index, { paymentStatus: event.target.value as PaymentStatus })}><option value="paid">paid</option><option value="unpaid">unpaid</option><option value="promised">promised</option></select></td>
                <td className="py-2 pr-2"><input className="h-9 w-24 rounded-md border border-gray-300 px-2" type="number" value={row.amountDue} onChange={(event) => updateRow(index, { amountDue: Number(event.target.value) })} /></td>
                <td className="py-2 pr-2"><input className="h-9 w-24 rounded-md border border-gray-300 px-2" type="number" value={row.amountPaid} onChange={(event) => updateRow(index, { amountPaid: Number(event.target.value) })} /></td>
                <td className="py-2 pr-2"><select className="h-9 rounded-md border border-gray-300 px-2" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}><option value="none">none</option><option value="A">A</option><option value="B">B</option></select></td>
                <td className="py-2 pr-2"><input className="h-9 w-44 rounded-md border border-gray-300 px-2" value={row.note} onChange={(event) => updateRow(index, { note: event.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PublicMatchRows({ rows }: { rows: MatchPlayer[] }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold text-gray-950">{row.name}</p><p className="text-xs text-gray-500">Equipo {row.team === "none" ? "por asignar" : row.team}</p></div>
          <div className="flex items-center gap-2"><PaymentBadge status={row.paymentStatus} /><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600 ring-1 ring-gray-200">{formatCurrency(Math.max(row.amountDue - row.amountPaid, 0))}</span></div>
        </div>
      ))}
    </div>
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
  const summary = summarizeMatch(rows);

  if (!match) return <PageTitle title="Match not found" description="No existe en la base de datos." />;
  const currentMatch = match;

  function updateRow(index: number, patch: Partial<MatchPlayer>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row)));
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

  return (
    <>
      <PageTitle title={`${currentMatch.weekLabel || currentMatch.date} - ${currentMatch.time}`} description={`${currentMatch.date} - ${currentMatch.location}`} action={isAdmin ? <Button onClick={save} disabled={isPending}><Save size={16} />Save match</Button> : undefined} />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: equipos, resultado y pagos son solo lectura." /> : null}
      {error ? <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmed" value={summary.confirmedCount} /><Stat label="Paid" value={summary.paidCount} /><Stat label="Unpaid/promised" value={summary.unpaidCount + summary.promisedCount} /><Stat label="Pending" value={formatCurrency(summary.pendingAmount)} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>{isAdmin ? <EditableRows rows={rows} updateRow={updateRow} /> : <PublicMatchRows rows={rows} />}</Card>
        <div className="space-y-4">
          {isAdmin ? (
            <Card className="space-y-3">
              <h2 className="font-semibold">Final score</h2>
              <div className="grid grid-cols-2 gap-3"><Input label="Team A" type="number" value={String(scoreA)} onChange={(value) => setScoreA(Number(value))} /><Input label="Team B" type="number" value={String(scoreB)} onChange={(value) => setScoreB(Number(value))} /></div>
              <textarea className="min-h-20 w-full rounded-md border border-gray-300 p-2 text-sm" value={resultNotes} onChange={(event) => setResultNotes(event.target.value)} placeholder="Result notes" />
            </Card>
          ) : result ? (
            <Card><h2 className="font-semibold">Resultado final</h2><p className="mt-2 text-2xl font-semibold">A {result.scoreA} - {result.scoreB} B</p><p className="mt-1 text-sm text-gray-600">{result.winner === "draw" ? "Empate" : `Gana equipo ${result.winner}`}</p></Card>
          ) : null}
          <CopyBlock title="Payment pending summary" text={pendingPaymentsMessage(currentMatch, rows)} />
          <CopyBlock title="Teams summary" text={teamsMessage(currentMatch, rows)} />
          <CopyBlock title="Final result summary" text={finalResultMessage(currentMatch, { id: result?.id ?? "preview", matchId: currentMatch.id, scoreA, scoreB, winner: scoreA === scoreB ? "draw" : scoreA > scoreB ? "A" : "B", notes: resultNotes })} />
        </div>
      </div>
    </>
  );
}

export function PaymentsPage({ initialData }: InitialDataProps) {
  const isAdmin = useIsAdmin();
  const { data, commit } = useSifupData(initialData);
  const [error, setError] = useState("");
  const perMatchPending = data.matchPlayers.filter((row) => row.amountDue > row.amountPaid);
  const courtBalance = data.clubFinance.prepaidTotal - data.matches.filter((match) => match.courtPrepaid).reduce((sum, match) => sum + match.courtCost, 0);

  function markPaid(row: MatchPlayer) {
    const updated = { ...row, paymentStatus: "paid" as const, amountPaid: row.amountDue, updatedAt: new Date().toISOString() };
    markMatchPlayerPaidAction(row.id)
      .then(() => commit({ ...data, matchPlayers: data.matchPlayers.map((item) => (item.id === row.id ? updated : item)) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo marcar como pagado."));
  }

  function markMonthlyPaid(payment: MonthlyPayment) {
    const updated = { ...payment, paymentStatus: "paid" as const, amountPaid: payment.expectedAmount, updatedAt: new Date().toISOString() };
    saveMonthlyPaymentAction(updated)
      .then(() => commit({ ...data, monthlyPayments: data.monthlyPayments.map((item) => (item.id === payment.id ? updated : item)) }))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo guardar la mensualidad."));
  }

  return (
    <>
      <PageTitle title="Payments" description="Mensualidades, pagos por partido y estado de cancha." />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: el marcado de pagos queda reservado para admin." /> : null}
      {error ? <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p> : null}
      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_0.7fr]">
        <PaymentAccountCard data={data} />
        <Card><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cancha</p><p className="mt-2 text-2xl font-semibold text-gray-950">{formatCurrency(data.clubFinance.prepaidTotal)}</p><p className="mt-1 text-sm text-gray-600">Pagado para {data.clubFinance.prepaidCourts} fechas. Saldo referencial: {formatCurrency(courtBalance)}.</p></Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">Mensualidad junio</h2>
          {data.monthlyPayments.map((payment) => {
            const player = data.players.find((item) => item.id === payment.playerId);
            const pending = Math.max(payment.expectedAmount - payment.amountPaid, 0);
            return (
              <div key={payment.id} className="flex flex-col gap-3 rounded-md border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-semibold">{player?.name}</p><p className="text-sm text-gray-600">{formatCurrency(payment.amountPaid)} / {formatCurrency(payment.expectedAmount)} - pendiente {formatCurrency(pending)}</p></div>
                <div className="flex items-center gap-2"><PaymentBadge status={payment.paymentStatus} />{isAdmin && pending > 0 ? <Button onClick={() => markMonthlyPaid(payment)}>Mark as paid</Button> : null}</div>
              </div>
            );
          })}
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Por partido</h2>
          {perMatchPending.map((row) => {
            const match = data.matches.find((item) => item.id === row.matchId);
            return (
              <div key={row.id} className="flex flex-col gap-3 rounded-md border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-semibold">{row.name}</p><p className="mt-1 text-sm text-gray-600">{match?.weekLabel || match?.date} - {match?.location}</p><p className="mt-1 text-sm font-medium">{formatCurrency(Math.max(row.amountDue - row.amountPaid, 0))}</p></div>
                <div className="flex items-center gap-2"><PaymentBadge status={row.paymentStatus} />{isAdmin ? <Button onClick={() => markPaid(row)}>Mark as paid</Button> : null}</div>
              </div>
            );
          })}
          {perMatchPending.length === 0 ? <p className="text-sm text-gray-600">No hay pagos por partido pendientes.</p> : null}
        </Card>
      </div>
    </>
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
      <PageTitle title="Players" description={isAdmin ? "Oficiales (mensualidad) y galletas (por partido)." : "Lista publica de jugadores activos."} />
      {!isAdmin ? <AdminOnlyNotice label="Vista publica: telefonos, WhatsApp y edicion quedan ocultos." /> : null}
      {error ? <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p> : null}
      {isAdmin ? <Card className="mb-4 flex gap-2"><input className="h-10 min-w-0 flex-1 rounded-md border border-gray-300 px-3 text-sm" value={name} onChange={(event) => setName(event.target.value)} placeholder="New player name" /><Button onClick={addPlayer}><Plus size={16} />Add</Button></Card> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">Oficiales</h2>
          {oficiales.map((player) => {
            const payment = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === month);
            const paid = payment?.paymentStatus === "paid";
            return (
              <PlayerRow key={player.id} player={player} isAdmin={isAdmin} onEdit={() => setEditingPlayer(player)}>
                <PaymentBadge status={paid ? "paid" : payment?.paymentStatus ?? "unpaid"} />
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
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">{formatCurrency(debt)}</span>
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
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <div>
        <p className="font-semibold text-gray-950">{player.name}</p>
        <p className="text-sm text-gray-600">{player.nickname || "Sin pseudonimo"}</p>
      </div>
      <div className="flex items-center gap-2">
        {children}
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
      <label className="space-y-1 text-sm font-medium text-gray-700">
        <span>Plan</span>
        <select className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm" value={draft.paymentPlan} onChange={(event) => setDraft({ ...draft, paymentPlan: event.target.value as PaymentPlan })}>
          <option value="monthly">mensual (oficial)</option>
          <option value="perMatch">por partido (galleta)</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
        <span>Activo</span>
      </label>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => onSave(draft)}><Save size={16} />Guardar</Button>
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"><MessageCircle size={16} />WhatsApp</a>
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
      return { player: player.name, played: appearances.length, wins, losses, draws, winRate: appearances.length ? Math.round((wins / appearances.length) * 100) : 0, pendingDebt: matchDebt + monthlyDebt };
    }).sort((a, b) => b.winRate - a.winRate || b.played - a.played);
  }, [data]);

  return (
    <>
      <PageTitle title="Standings" description="Ranking simple calculado desde la base de datos." />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <tr><th className="py-2">Player</th><th>Played</th><th>Wins</th><th>Losses</th><th>Draws</th><th>Win rate</th><th>Pending debt</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {standings.map((row) => (
                <tr key={row.player}><td className="py-2 font-medium">{row.player}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.draws}</td><td>{row.winRate}%</td><td>{formatCurrency(row.pendingDebt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
