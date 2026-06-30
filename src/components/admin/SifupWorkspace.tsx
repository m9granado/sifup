"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clipboard, Plus, Save, WalletCards } from "lucide-react";
import { parseWhatsAppList } from "@/lib/parser";
import {
  formatCurrency,
  loadData,
  newId,
  replaceMatchPlayers,
  saveData,
  summarizeMatch,
  upsertMatch,
  upsertPlayer,
  upsertResult,
} from "@/lib/store";
import { seedData } from "@/lib/mock-data";
import {
  finalResultMessage,
  matchSummaryMessage,
  pendingPaymentsMessage,
  teamsMessage,
} from "@/lib/whatsapp";
import type { Match, MatchPlayer, MatchResult, PaymentStatus, Player, SifupData, Team } from "@/lib/types";

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

function useSifupData() {
  const [data, setData] = useState<SifupData>(seedData);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setData(loadData());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function commit(next: SifupData) {
    setData(next);
    saveData(next);
  }
  return { data, commit };
}

function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  className?: string;
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
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${variants[variant]} ${className}`}
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

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const styles = {
    paid: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    unpaid: "bg-red-50 text-red-800 ring-red-200",
    promised: "bg-amber-50 text-amber-800 ring-amber-200",
  };
  const labels = { paid: "paid", unpaid: "unpaid", promised: "promised" };
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${styles[status]}`}>{labels[status]}</span>;
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
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-gray-950 p-3 text-xs leading-5 text-gray-50">
        {text}
      </pre>
    </Card>
  );
}

function nextMatch(matches: Match[]) {
  return [...matches].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
}

export function DashboardPage() {
  const { data } = useSifupData();
  const match = nextMatch(data.matches);
  const rows = data.matchPlayers.filter((row) => row.matchId === match?.id);
  const summary = summarizeMatch(rows);

  return (
    <>
      <PageTitle
        title="Dashboard"
        description="Resumen rapido del proximo partido y estado de pagos."
        action={
          <CtaLink href="/matches/new">
            <Plus size={16} />
            New match
          </CtaLink>
        }
      />
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
              <h2 className="text-lg font-semibold">{match?.date} {match?.time}</h2>
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
        {match ? (
          <CopyBlock title="Clean match summary" text={matchSummaryMessage(match, rows)} />
        ) : null}
      </div>
    </>
  );
}

export function MatchesPage() {
  const { data } = useSifupData();
  return (
    <>
      <PageTitle
        title="Matches"
        description="Historial local de partidos y listas importadas."
        action={
          <CtaLink href="/matches/new">
            <Plus size={16} />
            New match
          </CtaLink>
        }
      />
      <div className="space-y-3">
        {data.matches.map((match) => {
          const rows = data.matchPlayers.filter((row) => row.matchId === match.id);
          const summary = summarizeMatch(rows);
          return (
            <Link key={match.id} href={`/matches/${match.id}`} className="block">
              <Card className="transition hover:border-emerald-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{match.date} - {match.time}</h2>
                    <p className="mt-1 text-sm text-gray-600">{match.location}</p>
                  </div>
                  <StatusBadge value={match.status} />
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

export function NewMatchPage() {
  const router = useRouter();
  const { data, commit } = useSifupData();
  const [raw, setRaw] = useState(sampleInput);
  const [match, setMatch] = useState({
    date: "",
    time: "21:00",
    location: "",
    totalCost: 0,
    notes: "",
  });
  const [rows, setRows] = useState<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  function parse() {
    const parsed = parseWhatsAppList(raw);
    setMatch(parsed.match);
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
      totalCost: Number(match.totalCost) || rows.reduce((sum, row) => sum + row.amountDue, 0),
      notes: match.notes,
      createdAt: now,
      updatedAt: now,
    };
    const nextRows: MatchPlayer[] = rows.map((row) => ({
      ...row,
      id: newId("mp"),
      matchId,
      createdAt: now,
      updatedAt: now,
    }));
    commit(replaceMatchPlayers(upsertMatch(data, nextMatch), matchId, nextRows));
    router.push(`/matches/${matchId}`);
  }

  return (
    <>
      <PageTitle title="New match" description="Pega la lista WhatsApp, revisa la tabla editable y guarda." />
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="space-y-3">
          <textarea
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            className="min-h-72 w-full rounded-md border border-gray-300 p-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={parse}>
              <WalletCards size={16} />
              Paste WhatsApp list
            </Button>
            <Button onClick={save} variant="secondary">
              <Save size={16} />
              Save match
            </Button>
          </div>
          {errors.map((error) => (
            <p key={error} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>
          ))}
        </Card>
        <MatchEditor match={match} setMatch={setMatch} rows={rows} updateRow={updateRow} />
      </div>
    </>
  );
}

function MatchEditor({
  match,
  setMatch,
  rows,
  updateRow,
}: {
  match: { date: string; time: string; location: string; totalCost: number; notes: string };
  setMatch: (value: { date: string; time: string; location: string; totalCost: number; notes: string }) => void;
  rows: Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[];
  updateRow: (index: number, patch: Partial<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">>) => void;
}) {
  return (
    <Card className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Date" type="date" value={match.date} onChange={(date) => setMatch({ ...match, date })} />
        <Input label="Time" type="time" value={match.time} onChange={(time) => setMatch({ ...match, time })} />
        <Input label="Location" value={match.location} onChange={(location) => setMatch({ ...match, location })} />
        <Input label="Total cost" type="number" value={String(match.totalCost)} onChange={(totalCost) => setMatch({ ...match, totalCost: Number(totalCost) })} />
      </div>
      <EditableRows rows={rows} updateRow={updateRow} />
    </Card>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
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

function EditableRows({
  rows,
  updateRow,
}: {
  rows: Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[];
  updateRow: (index: number, patch: Partial<Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">>) => void;
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
                  <option value="paid">paid</option>
                  <option value="unpaid">unpaid</option>
                  <option value="promised">promised</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Due" type="number" value={String(row.amountDue)} onChange={(value) => updateRow(index, { amountDue: Number(value) })} />
                <Input label="Paid" type="number" value={String(row.amountPaid)} onChange={(value) => updateRow(index, { amountPaid: Number(value) })} />
              </div>
              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Team</span>
                <select className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}>
                  <option value="none">none</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
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
          <tr>
            <th className="py-2 pr-2">Player</th>
            <th className="py-2 pr-2">Payment</th>
            <th className="py-2 pr-2">Due</th>
            <th className="py-2 pr-2">Paid</th>
            <th className="py-2 pr-2">Team</th>
            <th className="py-2 pr-2">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, index) => (
            <tr key={`${row.name}-${index}`}>
              <td className="py-2 pr-2">
                <input className="h-9 w-44 rounded-md border border-gray-300 px-2" value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <select className="h-9 rounded-md border border-gray-300 px-2" value={row.paymentStatus} onChange={(event) => updateRow(index, { paymentStatus: event.target.value as PaymentStatus })}>
                  <option value="paid">paid</option>
                  <option value="unpaid">unpaid</option>
                  <option value="promised">promised</option>
                </select>
              </td>
              <td className="py-2 pr-2">
                <input className="h-9 w-24 rounded-md border border-gray-300 px-2" type="number" value={row.amountDue} onChange={(event) => updateRow(index, { amountDue: Number(event.target.value) })} />
              </td>
              <td className="py-2 pr-2">
                <input className="h-9 w-24 rounded-md border border-gray-300 px-2" type="number" value={row.amountPaid} onChange={(event) => updateRow(index, { amountPaid: Number(event.target.value) })} />
              </td>
              <td className="py-2 pr-2">
                <select className="h-9 rounded-md border border-gray-300 px-2" value={row.team} onChange={(event) => updateRow(index, { team: event.target.value as Team })}>
                  <option value="none">none</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </td>
              <td className="py-2 pr-2">
                <input className="h-9 w-44 rounded-md border border-gray-300 px-2" value={row.note} onChange={(event) => updateRow(index, { note: event.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </>
  );
}

export function MatchDetailPage({ id }: { id: string }) {
  const { data, commit } = useSifupData();
  const match = data.matches.find((item) => item.id === id);
  const result = data.results.find((item) => item.matchId === id);
  const [rows, setRows] = useState(() => data.matchPlayers.filter((row) => row.matchId === id));
  const [scoreA, setScoreA] = useState(result?.scoreA ?? 0);
  const [scoreB, setScoreB] = useState(result?.scoreB ?? 0);
  const [resultNotes, setResultNotes] = useState(result?.notes ?? "");
  const summary = summarizeMatch(rows);

  if (!match) {
    return <PageTitle title="Match not found" description="No existe en los datos locales." />;
  }

  const currentMatch = match;

  function updateRow(index: number, patch: Partial<MatchPlayer>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row)));
  }

  function save() {
    const winner = scoreA === scoreB ? "draw" : scoreA > scoreB ? "A" : "B";
    const nextResult: MatchResult = {
      id: result?.id ?? newId("result"),
      matchId: currentMatch.id,
      scoreA,
      scoreB,
      winner,
      notes: resultNotes,
    };
    commit(upsertResult(replaceMatchPlayers(data, currentMatch.id, rows), nextResult));
  }

  return (
    <>
      <PageTitle
        title={`${currentMatch.date} ${currentMatch.time}`}
        description={currentMatch.location}
        action={<Button onClick={save}><Save size={16} />Save match</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmed" value={summary.confirmedCount} />
        <Stat label="Paid" value={summary.paidCount} />
        <Stat label="Unpaid/promised" value={summary.unpaidCount + summary.promisedCount} />
        <Stat label="Pending" value={formatCurrency(summary.pendingAmount)} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <EditableRows rows={rows} updateRow={updateRow} />
        </Card>
        <div className="space-y-4">
          <Card className="space-y-3">
            <h2 className="font-semibold">Final score</h2>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Team A" type="number" value={String(scoreA)} onChange={(value) => setScoreA(Number(value))} />
              <Input label="Team B" type="number" value={String(scoreB)} onChange={(value) => setScoreB(Number(value))} />
            </div>
            <textarea className="min-h-20 w-full rounded-md border border-gray-300 p-2 text-sm" value={resultNotes} onChange={(event) => setResultNotes(event.target.value)} placeholder="Result notes" />
          </Card>
          <CopyBlock title="Payment pending summary" text={pendingPaymentsMessage(currentMatch, rows)} />
          <CopyBlock title="Teams summary" text={teamsMessage(currentMatch, rows)} />
          <CopyBlock title="Final result summary" text={finalResultMessage(currentMatch, { id: result?.id ?? "preview", matchId: currentMatch.id, scoreA, scoreB, winner: scoreA === scoreB ? "draw" : scoreA > scoreB ? "A" : "B", notes: resultNotes })} />
        </div>
      </div>
    </>
  );
}

export function PaymentsPage() {
  const { data, commit } = useSifupData();
  const pending = data.matchPlayers.filter((row) => row.paymentStatus !== "paid");

  function markPaid(row: MatchPlayer) {
    const rows = data.matchPlayers.map((item) =>
      item.id === row.id
        ? { ...item, paymentStatus: "paid" as const, amountPaid: item.amountDue, updatedAt: new Date().toISOString() }
        : item,
    );
    commit({ ...data, matchPlayers: rows });
  }

  return (
    <>
      <PageTitle title="Payments" description="Todos los jugadores impagos o prometidos por partido." />
      <div className="space-y-3">
        {pending.map((row) => {
          const match = data.matches.find((item) => item.id === row.matchId);
          return (
            <Card key={row.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">{row.name}</h2>
                  <p className="mt-1 text-sm text-gray-600">{match?.date} - {match?.location}</p>
                  <p className="mt-1 text-sm font-medium">{formatCurrency(Math.max(row.amountDue - row.amountPaid, 0))}</p>
                </div>
                <div className="flex items-center gap-2">
                  <PaymentBadge status={row.paymentStatus} />
                  <Button onClick={() => markPaid(row)}>Mark as paid</Button>
                </div>
              </div>
            </Card>
          );
        })}
        {pending.length === 0 ? <Card>No hay pagos pendientes.</Card> : null}
      </div>
    </>
  );
}

export function PlayersPage() {
  const { data, commit } = useSifupData();
  const [name, setName] = useState("");

  function addPlayer() {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const player: Player = {
      id: newId("player"),
      name: name.trim(),
      nickname: name.trim().split(" ")[0],
      phone: "",
      skillLevel: 3,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    commit(upsertPlayer(data, player));
    setName("");
  }

  return (
    <>
      <PageTitle title="Players" description="Base local simple para conectar luego a Supabase/Postgres." />
      <Card className="mb-4 flex gap-2">
        <input className="h-10 min-w-0 flex-1 rounded-md border border-gray-300 px-3 text-sm" value={name} onChange={(event) => setName(event.target.value)} placeholder="New player name" />
        <Button onClick={addPlayer}><Plus size={16} />Add</Button>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <tr><th className="py-2">Name</th><th>Nickname</th><th>Skill</th><th>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.players.map((player) => (
                <tr key={player.id}><td className="py-2 font-medium">{player.name}</td><td>{player.nickname}</td><td>{player.skillLevel}/5</td><td>{player.active ? "active" : "inactive"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export function StandingsPage() {
  const { data } = useSifupData();
  const standings = useMemo(() => {
    return data.players.map((player) => {
      const appearances = data.matchPlayers.filter((row) => row.name === player.name || row.playerId === player.id);
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
      const pendingDebt = appearances.reduce((sum, row) => sum + Math.max(row.amountDue - row.amountPaid, 0), 0);
      return {
        player: player.name,
        played: appearances.length,
        wins,
        losses,
        draws,
        winRate: appearances.length ? Math.round((wins / appearances.length) * 100) : 0,
        pendingDebt,
      };
    }).sort((a, b) => b.winRate - a.winRate || b.played - a.played);
  }, [data]);

  return (
    <>
      <PageTitle title="Standings" description="Ranking simple calculado desde los datos locales." />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <tr><th className="py-2">Player</th><th>Played</th><th>Wins</th><th>Losses</th><th>Draws</th><th>Win rate</th><th>Pending debt</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {standings.map((row) => (
                <tr key={row.player}>
                  <td className="py-2 font-medium">{row.player}</td>
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{row.draws}</td>
                  <td>{row.winRate}%</td>
                  <td>{formatCurrency(row.pendingDebt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
