import "server-only";

import { seedData } from "./mock-data";
import { getSql, hasDatabaseUrl } from "./db";
import type { ClubExpense, Match, MatchPlayer, MatchResult, MonthlyPayment, Player, SifupData } from "./types";

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function dateOnly(value: Date | string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

type PlayerRow = {
  id: string;
  name: string;
  nickname: string;
  phone: string;
  payment_plan: Player["paymentPlan"];
  skill_level: Player["skillLevel"];
  active: boolean;
  short_name: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type MatchRow = {
  id: string;
  match_date: Date | string;
  match_time: string;
  location: string;
  status: Match["status"];
  total_cost: number;
  week_label: string;
  month_key: string;
  court_cost: number;
  court_prepaid: boolean;
  notes: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type MatchPlayerRow = {
  id: string;
  match_id: string;
  player_id: string | null;
  name: string;
  phone: string;
  attendance_status: MatchPlayer["attendanceStatus"];
  payment_status: MatchPlayer["paymentStatus"];
  amount_due: number;
  amount_paid: number;
  note: string;
  team: MatchPlayer["team"];
  whatsapp_order: number | null;
  goals: number | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MatchResultRow = {
  id: string;
  match_id: string;
  score_a: number;
  score_b: number;
  winner: MatchResult["winner"];
  notes: string;
};

type MonthlyPaymentRow = {
  id: string;
  player_id: string;
  month_key: string;
  expected_amount: number;
  amount_paid: number;
  payment_status: MonthlyPayment["paymentStatus"];
  note: string;
  paid_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ClubFinanceRow = {
  id: string;
  bank: string;
  account: string;
  email: string;
  rut: string;
  court_cost: number;
  prepaid_courts: number;
  prepaid_total: number;
  notes: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ClubExpenseRow = {
  id: string;
  expense_date: Date | string;
  label: string;
  amount: number;
  category: ClubExpense["category"];
  note: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function getSifupData(): Promise<SifupData> {
  if (!hasDatabaseUrl()) return seedData;

  const sql = getSql();
  const [matches, players, matchPlayers, results, monthlyPayments, finances, clubExpenses] = await Promise.all([
    sql<MatchRow[]>`select * from matches order by match_date desc, match_time desc`,
    sql<PlayerRow[]>`select * from players order by name asc`,
    sql<MatchPlayerRow[]>`select * from match_players order by match_id desc, whatsapp_order asc nulls last, created_at asc, id asc`,
    sql<MatchResultRow[]>`select * from match_results`,
    sql<MonthlyPaymentRow[]>`select * from monthly_payments order by month_key desc, player_id asc`,
    sql<ClubFinanceRow[]>`select * from club_finances order by created_at asc limit 1`,
    sql<ClubExpenseRow[]>`select * from club_expenses order by expense_date desc, created_at desc`,
  ]);

  return {
    matches: matches.map((row) => ({
      id: row.id,
      date: dateOnly(row.match_date),
      time: row.match_time,
      location: row.location,
      status: row.status,
      totalCost: row.total_cost,
      weekLabel: row.week_label,
      monthKey: row.month_key,
      courtCost: row.court_cost,
      courtPrepaid: row.court_prepaid,
      notes: row.notes,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    players: players.map((row) => ({
      id: row.id,
      name: row.name,
      nickname: row.nickname,
      phone: row.phone,
      paymentPlan: row.payment_plan,
      skillLevel: row.skill_level,
      active: row.active,
      shortName: row.short_name || "",
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    matchPlayers: matchPlayers.map((row) => ({
      id: row.id,
      matchId: row.match_id,
      playerId: row.player_id ?? undefined,
      name: row.name,
      phone: row.phone,
      attendanceStatus: row.attendance_status,
      paymentStatus: row.payment_status,
      amountDue: row.amount_due,
      amountPaid: row.amount_paid,
      note: row.note,
      team: row.team,
      whatsappOrder: row.whatsapp_order ?? 0,
      goals: row.goals ?? undefined,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    results: results.map((row) => ({
      id: row.id,
      matchId: row.match_id,
      scoreA: row.score_a,
      scoreB: row.score_b,
      winner: row.winner,
      notes: row.notes,
    })),
    monthlyPayments: monthlyPayments.map((row) => ({
      id: row.id,
      playerId: row.player_id,
      monthKey: row.month_key,
      expectedAmount: row.expected_amount,
      amountPaid: row.amount_paid,
      paymentStatus: row.payment_status,
      note: row.note,
      paidAt: row.paid_at ? iso(row.paid_at) : undefined,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    clubExpenses: clubExpenses.map((row) => ({
      id: row.id,
      expenseDate: dateOnly(row.expense_date),
      label: row.label,
      amount: row.amount,
      category: row.category,
      note: row.note,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    clubFinance: finances[0]
      ? {
          id: finances[0].id,
          bank: finances[0].bank,
          account: finances[0].account,
          email: finances[0].email,
          rut: finances[0].rut,
          courtCost: finances[0].court_cost,
          prepaidCourts: finances[0].prepaid_courts,
          prepaidTotal: finances[0].prepaid_total,
          notes: finances[0].notes,
          createdAt: iso(finances[0].created_at),
          updatedAt: iso(finances[0].updated_at),
        }
      : seedData.clubFinance,
  };
}

function requireDatabase() {
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL no esta configurado.");
  return getSql();
}

export async function saveMatchWithPlayers(match: Match, players: MatchPlayer[]) {
  const sql = requireDatabase();
  await sql.begin(async (tx) => {
    await tx`
      insert into matches (id, match_date, match_time, location, status, total_cost, week_label, month_key, court_cost, court_prepaid, notes, created_at, updated_at)
      values (${match.id}, ${match.date}, ${match.time}, ${match.location}, ${match.status}, ${match.totalCost}, ${match.weekLabel}, ${match.monthKey}, ${match.courtCost}, ${match.courtPrepaid}, ${match.notes}, ${match.createdAt}, ${match.updatedAt})
      on conflict (id) do update set
        match_date = excluded.match_date,
        match_time = excluded.match_time,
        location = excluded.location,
        status = excluded.status,
        total_cost = excluded.total_cost,
        week_label = excluded.week_label,
        month_key = excluded.month_key,
        court_cost = excluded.court_cost,
        court_prepaid = excluded.court_prepaid,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `;
    await tx`delete from match_players where match_id = ${match.id}`;
    for (const row of players) {
      await tx`
        insert into match_players (id, match_id, player_id, name, phone, attendance_status, payment_status, amount_due, amount_paid, note, team, whatsapp_order, goals, created_at, updated_at)
        values (${row.id}, ${row.matchId}, ${row.playerId ?? null}, ${row.name}, ${row.phone}, ${row.attendanceStatus}, ${row.paymentStatus}, ${row.amountDue}, ${row.amountPaid}, ${row.note}, ${row.team}, ${row.whatsappOrder}, ${row.goals ?? null}, ${row.createdAt}, ${row.updatedAt})
      `;
    }
  });
}

export async function saveMatchPlayers(matchId: string, players: MatchPlayer[], result?: MatchResult) {
  const sql = requireDatabase();
  const now = new Date().toISOString();
  await sql.begin(async (tx) => {
    await tx`delete from match_players where match_id = ${matchId}`;
    for (const row of players) {
      await tx`
        insert into match_players (id, match_id, player_id, name, phone, attendance_status, payment_status, amount_due, amount_paid, note, team, whatsapp_order, goals, created_at, updated_at)
        values (${row.id}, ${row.matchId}, ${row.playerId ?? null}, ${row.name}, ${row.phone}, ${row.attendanceStatus}, ${row.paymentStatus}, ${row.amountDue}, ${row.amountPaid}, ${row.note}, ${row.team}, ${row.whatsappOrder}, ${row.goals ?? null}, ${row.createdAt}, ${row.updatedAt})
      `;
    }
    await tx`update matches set updated_at = ${now} where id = ${matchId}`;
    if (result) {
      await tx`
        insert into match_results (id, match_id, score_a, score_b, winner, notes)
        values (${result.id}, ${result.matchId}, ${result.scoreA}, ${result.scoreB}, ${result.winner}, ${result.notes})
        on conflict (match_id) do update set
          score_a = excluded.score_a,
          score_b = excluded.score_b,
          winner = excluded.winner,
          notes = excluded.notes
      `;
    }
  });
}

export async function markMatchPlayerPaid(rowId: string) {
  const sql = requireDatabase();
  await sql`
    update match_players
    set payment_status = 'paid', amount_paid = amount_due, updated_at = now()
    where id = ${rowId}
  `;
}

export async function setMatchPlayerPaymentStatus(rowId: string, status: "paid" | "unpaid") {
  const sql = requireDatabase();
  await sql`
    update match_players
    set payment_status = ${status}, amount_paid = case when ${status} = 'paid' then amount_due else 0 end, updated_at = now()
    where id = ${rowId}
  `;
}

export async function savePlayer(player: Player, guestName?: string) {
  const sql = requireDatabase();
  await sql.begin(async (tx) => {
    await tx`
      insert into players (id, name, nickname, phone, payment_plan, skill_level, active, short_name, created_at, updated_at)
      values (${player.id}, ${player.name}, ${player.nickname}, ${player.phone}, ${player.paymentPlan}, ${player.skillLevel}, ${player.active}, ${player.shortName || ""}, ${player.createdAt}, ${player.updatedAt})
      on conflict (id) do update set
        name = excluded.name,
        nickname = excluded.nickname,
        phone = excluded.phone,
        payment_plan = excluded.payment_plan,
        skill_level = excluded.skill_level,
        active = excluded.active,
        short_name = excluded.short_name,
        updated_at = excluded.updated_at
    `;

    if (guestName) {
      await tx`
        update match_players
        set player_id = ${player.id}, name = ${player.name}, updated_at = now()
        where player_id = ${player.id} or (player_id is null and lower(name) = lower(${guestName}))
      `;
    } else {
      await tx`
        update match_players
        set name = ${player.name}, updated_at = now()
        where player_id = ${player.id}
      `;
    }
  });
}

export async function saveMonthlyPayment(payment: MonthlyPayment) {
  const sql = requireDatabase();
  await sql`
    insert into monthly_payments (id, player_id, month_key, expected_amount, amount_paid, payment_status, note, paid_at, created_at, updated_at)
    values (${payment.id}, ${payment.playerId}, ${payment.monthKey}, ${payment.expectedAmount}, ${payment.amountPaid}, ${payment.paymentStatus}, ${payment.note}, ${payment.paidAt ?? null}, ${payment.createdAt}, ${payment.updatedAt})
    on conflict (player_id, month_key) do update set
      expected_amount = excluded.expected_amount,
      amount_paid = excluded.amount_paid,
      payment_status = excluded.payment_status,
      note = excluded.note,
      paid_at = excluded.paid_at,
      updated_at = excluded.updated_at
  `;
}
