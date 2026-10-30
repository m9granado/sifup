import "server-only";
import type { TransactionSql } from "postgres";
import { planCourtPayment, type CourtPaymentInput } from "./court-payments";
import { planSchedule, planCourtExpense, type ScheduleEntry, type CourtExpenseInput } from "./court-operations";

import { seedData } from "./mock-data";
import { getSql, hasDatabaseUrl } from "./db";
import { monthKey } from "./sifup-date";
import { mergedReceipt, parsePaymentReceipt } from "./payment-receipt";
import type { ClubExpense, CourtPayment, Match, MatchGame, MatchPlayer, MatchResult, MatchTeam, MonthlyPayment, Player, SifupData } from "./types";

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
  is_goalkeeper: boolean;
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
  match_format: Match["matchFormat"];
  squad_target: number;
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
  paid_at: Date | string | null;
  paid_date: Date | string | null;
  note: string;
  team: MatchPlayer["team"];
  team_id: string | null;
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

type MatchTeamRow = {
  id: string;
  match_id: string;
  name: string;
  color: MatchTeam["color"];
  seq: number;
  final_rank: 1 | 2 | 3 | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MatchGameRow = {
  id: string;
  match_id: string;
  seq: number;
  home_team_id: string;
  away_team_id: string;
  waiting_team_id: string | null;
  score_home: number;
  score_away: number;
  status: MatchGame["status"];
  started_at: Date | string;
  ended_at: Date | string | null;
  end_reason: MatchGame["endReason"] | null;
  winner_team_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
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
  paid_date: Date | string | null;
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

export async function getSifupData(client?: ReturnType<typeof getSql> | TransactionSql): Promise<SifupData> {
  if (!hasDatabaseUrl()) return seedData;

  const sql = client ?? getSql();
  const [matches, players, matchPlayers, results, matchTeams, matchGames, monthlyPayments, finances, clubExpenses, courtPayments] = await Promise.all([
    sql<MatchRow[]>`select * from matches order by match_date desc, match_time desc`,
    sql<PlayerRow[]>`select * from players order by name asc`,
    sql<MatchPlayerRow[]>`select * from match_players order by match_id desc, whatsapp_order asc nulls last, created_at asc, id asc`,
    sql<MatchResultRow[]>`select * from match_results`,
    sql<MatchTeamRow[]>`select * from match_teams order by match_id desc, seq asc`,
    sql<MatchGameRow[]>`select * from match_games order by match_id desc, seq asc`,
    sql<MonthlyPaymentRow[]>`select * from monthly_payments order by month_key desc, player_id asc`,
    sql<ClubFinanceRow[]>`select * from club_finances order by created_at asc limit 1`,
    sql<ClubExpenseRow[]>`select * from club_expenses order by expense_date desc, created_at desc`,
    sql<Array<{ source_match_id: string; target_match_id: string; expense_id: string; amount: number }>>`select * from court_payments order by source_match_id`,
  ]);

  return {
    courtPayments: courtPayments.map((row): CourtPayment => ({ sourceMatchId: row.source_match_id, targetMatchId: row.target_match_id, expenseId: row.expense_id, amount: row.amount })),
    matches: matches.map((row) => ({
      id: row.id,
      date: dateOnly(row.match_date),
      time: row.match_time,
      location: row.location,
      status: row.status,
      totalCost: row.total_cost,
      weekLabel: row.week_label,
      // Derived from match_date at read time (DB column untouched): a stored
      // month_key desynced from match_date must never drive billing/roster lookups.
      monthKey: monthKey(dateOnly(row.match_date)),
      courtCost: row.court_cost,
      courtPrepaid: row.court_prepaid,
      notes: row.notes,
      matchFormat: row.match_format,
      squadTarget: row.squad_target,
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
      isGoalkeeper: Boolean(row.is_goalkeeper),
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
      // Quien no va ("out") nunca debe: filas viejas pueden arrastrar un monto de cuando figuraba confirmado.
      amountDue: row.attendance_status === "out" ? 0 : row.amount_due,
      amountPaid: row.amount_paid,
      paidAt: row.paid_at ? iso(row.paid_at) : undefined,
      paidDate: row.paid_date ? dateOnly(row.paid_date) : undefined,
      note: row.note,
      team: row.team,
      teamId: row.team_id ?? undefined,
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
    matchTeams: matchTeams.map((row) => ({
      id: row.id,
      matchId: row.match_id,
      name: row.name,
      color: row.color,
      seq: row.seq,
      finalRank: row.final_rank ?? undefined,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })),
    matchGames: matchGames.map((row) => ({
      id: row.id,
      matchId: row.match_id,
      seq: row.seq,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      waitingTeamId: row.waiting_team_id ?? undefined,
      scoreHome: row.score_home,
      scoreAway: row.score_away,
      status: row.status,
      startedAt: iso(row.started_at),
      endedAt: row.ended_at ? iso(row.ended_at) : undefined,
      endReason: row.end_reason ?? undefined,
      winnerTeamId: row.winner_team_id ?? undefined,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
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
      paidDate: row.paid_date ? dateOnly(row.paid_date) : undefined,
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

export async function applySchedule(entries: ScheduleEntry[]) {
  return requireDatabase().begin(async tx => {
    // ponytail: reuse the court-operation lock; split by date only if throughput requires it.
    await tx`select pg_advisory_xact_lock(17402026)`;
    await tx`select id from matches order by id for update`;
    const plan = planSchedule(await getSifupData(tx), entries);
    for (const { match, previous, unchanged } of plan) {
      if (unchanged) continue;
      if (previous) {
        await tx`update matches set match_time = ${match.time}, location = ${match.location}, status = ${match.status}, notes = ${match.notes}, court_cost = ${match.courtCost}, court_prepaid = ${match.courtPrepaid}, updated_at = now() where id = ${match.id}`;
      } else {
        await tx`insert into matches (id, match_date, match_time, location, status, total_cost, week_label, month_key, court_cost, court_prepaid, notes, match_format, squad_target, created_at, updated_at)
          values (${match.id}, ${match.date}, ${match.time}, ${match.location}, ${match.status}, ${match.totalCost}, ${match.weekLabel}, ${match.monthKey}, ${match.courtCost}, false, ${match.notes}, ${match.matchFormat}, ${match.squadTarget ?? 12}, ${match.createdAt}, ${match.updatedAt})`;
      }
    }
    return plan;
  });
}

export async function applyCourtExpense(input: CourtExpenseInput) {
  return requireDatabase().begin(async tx => {
    await tx`select pg_advisory_xact_lock(17402026)`;
    const plan = planCourtExpense(await getSifupData(tx), input);
    if (!plan.unchanged) {
      const e = plan.expense;
      await tx`insert into club_expenses (id, expense_date, label, amount, category, note, created_at, updated_at) values (${e.id}, ${e.expenseDate}, ${e.label}, ${e.amount}, ${e.category}, ${e.note}, ${e.createdAt}, ${e.updatedAt})`;
    }
    return plan;
  });
}

export async function applyCourtPayment(input: CourtPaymentInput) {
  const sql = requireDatabase();
  return sql.begin(async (tx) => {
    // ponytail: serialize this low-volume financial operation; per-expense locks
    // can replace the shared lock if concurrent administrators ever need them.
    await tx`select pg_advisory_xact_lock(17402026)`;
    await tx`select id from club_expenses where id = ${input.expenseId} for update`;
    await tx`select id from matches order by id for update`;
    const plan = planCourtPayment(await getSifupData(tx), input);
    if (plan.unchanged) return plan;
    const { source, target, payment } = plan;
    if (plan.createTarget) {
      await tx`insert into matches (id, match_date, match_time, location, status, total_cost, week_label, month_key, court_cost, court_prepaid, notes, match_format, squad_target, created_at, updated_at)
        values (${target.id}, ${target.date}, ${target.time}, ${target.location}, ${target.status}, ${target.totalCost}, ${target.weekLabel}, ${target.monthKey}, ${target.courtCost}, true, ${target.notes}, ${target.matchFormat}, ${target.squadTarget ?? 12}, ${target.createdAt}, ${target.updatedAt})`;
    }
    if (source.id !== target.id) {
      // Release a direct link inside the same transaction before suspending its
      // old destination; the replacement below retains the original source ID.
      await tx`delete from court_payments where source_match_id = ${source.id} and target_match_id = ${source.id}`;
      await tx`update matches set status = 'suspended', court_prepaid = false, updated_at = now() where id = ${source.id}`;
    }
    await tx`insert into court_payments (source_match_id, target_match_id, expense_id, amount)
      values (${payment.sourceMatchId}, ${payment.targetMatchId}, ${payment.expenseId}, ${payment.amount})
      on conflict (source_match_id) do update set target_match_id = excluded.target_match_id`;
    await tx`update matches set court_prepaid = true, updated_at = now() where id = ${target.id}`;
    return plan;
  });
}

async function preserveMatchReceipts(tx: TransactionSql, matchId: string, players: MatchPlayer[]) {
  const previous = await tx<MatchPlayerRow[]>`select * from match_players where match_id = ${matchId} for update`;
  return players.map((row) => {
    const old = previous.find((item) => item.id === row.id);
    return old && row.paidAt === undefined && row.paidDate === undefined
      ? { ...row, paidAt: old.paid_at ? iso(old.paid_at) : undefined, paidDate: old.paid_date ? dateOnly(old.paid_date) : undefined }
      : row;
  });
}

export async function saveMatchWithPlayers(match: Match, players: MatchPlayer[], teams?: MatchTeam[]) {
  const sql = requireDatabase();
  const now = new Date().toISOString();
  await sql.begin(async (tx) => {
    await tx`
      insert into matches (id, match_date, match_time, location, status, total_cost, week_label, month_key, court_cost, court_prepaid, notes, match_format, squad_target, created_at, updated_at)
      values (${match.id}, ${match.date}, ${match.time}, ${match.location}, ${match.status}, ${match.totalCost}, ${match.weekLabel}, ${match.monthKey}, ${match.courtCost}, ${match.courtPrepaid}, ${match.notes}, ${match.matchFormat}, ${match.squadTarget ?? 12}, ${match.createdAt}, ${match.updatedAt})
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
        match_format = excluded.match_format,
        squad_target = excluded.squad_target,
        updated_at = excluded.updated_at
    `;
    if (teams && teams.length > 0) {
      for (const team of teams) {
        await tx`
          insert into match_teams (id, match_id, name, color, seq, created_at, updated_at)
          values (${team.id}, ${team.matchId}, ${team.name}, ${team.color}, ${team.seq}, ${team.createdAt}, ${team.updatedAt})
          on conflict (id) do update set
            name = excluded.name,
            color = excluded.color,
            seq = excluded.seq,
            updated_at = excluded.updated_at
        `;
      }
    }
    const preserved = await preserveMatchReceipts(tx, match.id, players);
    await tx`delete from match_players where match_id = ${match.id}`;
    for (const row of preserved) {
      await tx`
        insert into match_players (id, match_id, player_id, name, phone, attendance_status, payment_status, amount_due, amount_paid, paid_at, paid_date, note, team, team_id, whatsapp_order, goals, created_at, updated_at)
                values (${row.id}, ${row.matchId}, ${row.playerId ?? null}, ${row.name}, ${row.phone ?? ""}, ${row.attendanceStatus}, ${row.paymentStatus}, ${row.attendanceStatus === "out" ? 0 : row.amountDue ?? 0}, ${row.amountPaid ?? 0}, ${row.paidAt ?? null}, ${row.paidDate ?? null}, ${row.note ?? ""}, ${row.team ?? "none"}, ${row.teamId ?? null}, ${row.whatsappOrder ?? null}, ${row.goals ?? null}, ${row.createdAt ?? now}, ${row.updatedAt ?? now})
      `;
    }
  });
}

export async function saveMatch(match: Match) {
  const sql = requireDatabase();
  await sql`
    insert into matches (id, match_date, match_time, location, status, total_cost, week_label, month_key, court_cost, court_prepaid, notes, match_format, squad_target, created_at, updated_at)
    values (${match.id}, ${match.date}, ${match.time}, ${match.location}, ${match.status}, ${match.totalCost}, ${match.weekLabel}, ${match.monthKey}, ${match.courtCost}, ${match.courtPrepaid}, ${match.notes}, ${match.matchFormat}, ${match.squadTarget ?? 12}, ${match.createdAt}, ${match.updatedAt})
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
      match_format = excluded.match_format,
      squad_target = excluded.squad_target,
      updated_at = excluded.updated_at
  `;
}

export async function saveMatchPlayers(matchId: string, players: MatchPlayer[], result?: MatchResult) {
  const sql = requireDatabase();
  const now = new Date().toISOString();
  await sql.begin(async (tx) => {
    const preserved = await preserveMatchReceipts(tx, matchId, players);
    await tx`delete from match_players where match_id = ${matchId}`;
    for (const row of preserved) {
      await tx`
        insert into match_players (id, match_id, player_id, name, phone, attendance_status, payment_status, amount_due, amount_paid, paid_at, paid_date, note, team, team_id, whatsapp_order, goals, created_at, updated_at)
                values (${row.id}, ${row.matchId}, ${row.playerId ?? null}, ${row.name}, ${row.phone ?? ""}, ${row.attendanceStatus}, ${row.paymentStatus}, ${row.attendanceStatus === "out" ? 0 : row.amountDue ?? 0}, ${row.amountPaid ?? 0}, ${row.paidAt ?? null}, ${row.paidDate ?? null}, ${row.note ?? ""}, ${row.team ?? "none"}, ${row.teamId ?? null}, ${row.whatsappOrder ?? null}, ${row.goals ?? null}, ${row.createdAt ?? now}, ${row.updatedAt ?? now})
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

export async function saveMatchTeams(teams: MatchTeam[]) {
  const sql = requireDatabase();
  await sql.begin(async (tx) => {
    for (const team of teams) {
      await tx`
        insert into match_teams (id, match_id, name, color, seq, final_rank, created_at, updated_at)
        values (${team.id}, ${team.matchId}, ${team.name}, ${team.color}, ${team.seq}, ${team.finalRank ?? null}, ${team.createdAt}, ${team.updatedAt})
        on conflict (id) do update set
          name = excluded.name,
          color = excluded.color,
          seq = excluded.seq,
          updated_at = excluded.updated_at
      `;
    }
  });
}

export async function startMatchGame(game: Pick<MatchGame, "id" | "matchId" | "seq" | "homeTeamId" | "awayTeamId" | "waitingTeamId" | "startedAt" | "createdAt" | "updatedAt">) {
  const sql = requireDatabase();
  await sql`
    insert into match_games (id, match_id, seq, home_team_id, away_team_id, waiting_team_id, status, started_at, created_at, updated_at)
    values (${game.id}, ${game.matchId}, ${game.seq}, ${game.homeTeamId}, ${game.awayTeamId}, ${game.waitingTeamId ?? null}, 'in_progress', ${game.startedAt}, ${game.createdAt}, ${game.updatedAt})
  `;
}

export async function updateMatchGameScore(gameId: string, scoreHome: number, scoreAway: number) {
  const sql = requireDatabase();
  await sql`
    update match_games
    set score_home = ${scoreHome}, score_away = ${scoreAway}, updated_at = now()
    where id = ${gameId}
  `;
}

export async function finishMatchGame(gameId: string, payload: { scoreHome: number; scoreAway: number; endReason: MatchGame["endReason"]; winnerTeamId: string; endedAt: string }) {
  const sql = requireDatabase();
  await sql`
    update match_games
    set score_home = ${payload.scoreHome},
        score_away = ${payload.scoreAway},
        end_reason = ${payload.endReason ?? null},
        winner_team_id = ${payload.winnerTeamId},
        status = 'finished',
        ended_at = ${payload.endedAt},
        updated_at = now()
    where id = ${gameId}
  `;
}

export async function setMatchFinalStanding(ranks: { teamId: string; finalRank: 1 | 2 | 3 }[]) {
  const sql = requireDatabase();
  await sql.begin(async (tx) => {
    for (const rank of ranks) {
      await tx`update match_teams set final_rank = ${rank.finalRank}, updated_at = now() where id = ${rank.teamId}`;
    }
  });
}

export async function clearMatchFinalStanding(matchId: string) {
  const sql = requireDatabase();
  await sql`update match_teams set final_rank = null, updated_at = now() where match_id = ${matchId}`;
}

export async function markMatchPlayerPaid(rowId: string) {
  const sql = requireDatabase();
  await sql`
    update match_players
    set payment_status = 'paid', amount_paid = amount_due,
        paid_at = case when paid_at is null and paid_date is null and amount_due > 0 then now() else paid_at end,
        updated_at = now()
    where id = ${rowId}
  `;
}

export async function setMatchPlayerPaymentStatus(rowId: string, status: "paid" | "unpaid") {
  const sql = requireDatabase();
  await sql`
    update match_players
    set payment_status = ${status}, amount_paid = case when ${status} = 'paid' then amount_due else 0 end,
        paid_at = case when ${status} = 'paid' and amount_due > 0 and paid_at is null and paid_date is null then now() else paid_at end,
        updated_at = now()
    where id = ${rowId}
  `;
}

export async function savePlayer(player: Player, guestName?: string) {
  const sql = requireDatabase();
  await sql.begin(async (tx) => {
    await tx`
      insert into players (id, name, nickname, phone, payment_plan, skill_level, active, short_name, is_goalkeeper, created_at, updated_at)
      values (${player.id}, ${player.name}, ${player.nickname}, ${player.phone}, ${player.paymentPlan}, ${player.skillLevel}, ${player.active}, ${player.shortName || ""}, ${player.isGoalkeeper}, ${player.createdAt}, ${player.updatedAt})
      on conflict (id) do update set
        name = excluded.name,
        nickname = excluded.nickname,
        phone = excluded.phone,
        payment_plan = excluded.payment_plan,
        skill_level = excluded.skill_level,
        active = excluded.active,
        short_name = excluded.short_name,
        is_goalkeeper = excluded.is_goalkeeper,
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

export async function saveMonthlyPayment(payment: MonthlyPayment, replaceReceipt = false) {
  const sql = requireDatabase();
  await sql`
    insert into monthly_payments (id, player_id, month_key, expected_amount, amount_paid, payment_status, note, paid_at, paid_date, created_at, updated_at)
    values (${payment.id}, ${payment.playerId}, ${payment.monthKey}, ${payment.expectedAmount}, ${payment.amountPaid}, ${payment.paymentStatus}, ${payment.note}, ${payment.paidAt ?? null}, ${payment.paidDate ?? null}, ${payment.createdAt}, ${payment.updatedAt})
    on conflict (player_id, month_key) do update set
      expected_amount = excluded.expected_amount,
      amount_paid = excluded.amount_paid,
      payment_status = excluded.payment_status,
      note = excluded.note,
      paid_at = case when ${replaceReceipt} then excluded.paid_at when monthly_payments.paid_at is not null or monthly_payments.paid_date is not null then monthly_payments.paid_at else excluded.paid_at end,
      paid_date = case when ${replaceReceipt} then excluded.paid_date else coalesce(monthly_payments.paid_date, excluded.paid_date) end,
      updated_at = excluded.updated_at
  `;
}

/** Receipt-only correction: SQL never touches amounts, status, notes or other payments. */
export async function correctPaymentReceipt(kind: "monthly" | "perMatch", id: string, receivedAt: string) {
  const receipt = parsePaymentReceipt(receivedAt);
  const sql = requireDatabase();
  const rows = kind === "monthly"
    ? await sql`update monthly_payments set paid_at = ${receipt.paidAt ?? null}, paid_date = ${receipt.paidDate ?? null}, updated_at = now() where id = ${id} and amount_paid > 0 returning id`
    : await sql`update match_players set paid_at = ${receipt.paidAt ?? null}, paid_date = ${receipt.paidDate ?? null}, updated_at = now() where id = ${id} and amount_paid > 0 returning id`;
  if (!rows.length) throw new Error("No existe un pago recibido para corregir.");
}

export async function deleteMonthlyPayment(playerId: string, monthKey: string) {
  const sql = requireDatabase();
  await sql`delete from monthly_payments where player_id = ${playerId} and month_key = ${monthKey}`;
}

export async function applyRosterChange(input: {
  playerId: string;
  monthKey: string;
  upsertPayment?: MonthlyPayment;
  deletePayment?: boolean;
  rowUpdates: { id: string; amountDue: number; amountPaid: number; paymentStatus: string; note: string }[];
}) {
  const sql = requireDatabase();
  await sql.begin(async (tx) => {
    if (input.upsertPayment) {
      const payment = input.upsertPayment;
      await tx`
        insert into monthly_payments (id, player_id, month_key, expected_amount, amount_paid, payment_status, note, paid_at, paid_date, created_at, updated_at)
        values (${payment.id}, ${payment.playerId}, ${payment.monthKey}, ${payment.expectedAmount}, ${payment.amountPaid}, ${payment.paymentStatus}, ${payment.note}, ${payment.paidAt ?? null}, ${payment.paidDate ?? null}, ${payment.createdAt}, ${payment.updatedAt})
        on conflict (player_id, month_key) do update set
          expected_amount = excluded.expected_amount,
          amount_paid = excluded.amount_paid,
          payment_status = excluded.payment_status,
          note = excluded.note,
          paid_at = case when monthly_payments.paid_at is not null or monthly_payments.paid_date is not null then monthly_payments.paid_at else excluded.paid_at end,
          paid_date = coalesce(monthly_payments.paid_date, excluded.paid_date),
          updated_at = excluded.updated_at
      `;
    }
    if (input.deletePayment) {
      await tx`delete from monthly_payments where player_id = ${input.playerId} and month_key = ${input.monthKey}`;
    }
    for (const row of input.rowUpdates) {
      await tx`
        update match_players
        set amount_due = ${row.amountDue}, amount_paid = ${row.amountPaid}, payment_status = ${row.paymentStatus}, note = ${row.note}, updated_at = now()
        where id = ${row.id}
      `;
    }
  });
}

export async function saveClubExpense(expense: ClubExpense) {
  const sql = requireDatabase();
  await sql`
    insert into club_expenses (id, expense_date, label, amount, category, note, created_at, updated_at)
    values (${expense.id}, ${expense.expenseDate}, ${expense.label}, ${expense.amount}, ${expense.category}, ${expense.note}, ${expense.createdAt}, ${expense.updatedAt})
  `;
}

function receiptFromRow(row: { amount_paid: number; paid_at: Date | string | null; paid_date: Date | string | null }) {
  return { amountPaid: row.amount_paid, paidAt: row.paid_at ? iso(row.paid_at) : undefined, paidDate: row.paid_date ? dateOnly(row.paid_date) : undefined };
}

export async function mergePlayers(sourceId: string, targetId: string) {
  const sql = requireDatabase();
  await sql.begin(async (tx) => {
    // 1. Obtener la info del jugador destino
    const [targetPlayer] = await tx`select name from players where id = ${targetId}`;
    if (!targetPlayer) throw new Error("Jugador destino no encontrado.");

    // 2. Consolidar participaciones si ambos jugadores ya estaban en el mismo partido
    const targetRows = await tx<MatchPlayerRow[]>`select * from match_players where player_id = ${targetId}`;
    for (const tRow of targetRows) {
      const [sRow] = await tx<MatchPlayerRow[]>`select * from match_players where player_id = ${sourceId} and match_id = ${tRow.match_id}`;
      if (sRow) {
        const receipt = mergedReceipt(receiptFromRow(tRow), receiptFromRow(sRow));
        const combinedPaid = (tRow.amount_paid || 0) + (sRow.amount_paid || 0);
        const combinedDue = Math.max(tRow.amount_due || 0, sRow.amount_due || 0);
        const bestStatus = tRow.attendance_status === "confirmed" || sRow.attendance_status === "confirmed" ? "confirmed" : tRow.attendance_status;
        const bestTeam = tRow.team !== "none" ? tRow.team : sRow.team;
        await tx`
          update match_players
          set amount_paid = ${combinedPaid}, amount_due = ${combinedDue}, attendance_status = ${bestStatus}, team = ${bestTeam}, paid_at = ${receipt.paidAt ?? null}, paid_date = ${receipt.paidDate ?? null}, updated_at = now()
          where id = ${tRow.id}
        `;
        await tx`delete from match_players where id = ${sRow.id}`;
      }
    }

    // Actualizar el resto de participaciones en partidos (match_players)
    await tx`
      update match_players
      set player_id = ${targetId}, name = ${targetPlayer.name}, updated_at = now()
      where player_id = ${sourceId}
    `;

    // 3. Fusionar pagos mensuales (monthly_payments) para evitar violaciones de unicidad (player_id, month_key)
    const sourcePayments = await tx<MonthlyPaymentRow[]>`select * from monthly_payments where player_id = ${sourceId}`;
    for (const sourcePay of sourcePayments) {
      const [targetPay] = await tx<MonthlyPaymentRow[]>`
        select * from monthly_payments
        where player_id = ${targetId} and month_key = ${sourcePay.month_key}
      `;
      if (targetPay) {
        const receipt = mergedReceipt(receiptFromRow(targetPay), receiptFromRow(sourcePay));
        // Sumar montos pagados y actualizar
        const newPaid = Math.min(targetPay.amount_paid + sourcePay.amount_paid, targetPay.expected_amount);
        const newStatus = newPaid >= targetPay.expected_amount ? "paid" : newPaid > 0 ? "promised" : "unpaid";
        await tx`
          update monthly_payments
          set amount_paid = ${newPaid}, payment_status = ${newStatus}, paid_at = ${receipt.paidAt ?? null}, paid_date = ${receipt.paidDate ?? null}, updated_at = now()
          where id = ${targetPay.id}
        `;
        // Eliminar el duplicado origen
        await tx`delete from monthly_payments where id = ${sourcePay.id}`;
      } else {
        // Actualizar player_id al destino
        await tx`
          update monthly_payments
          set player_id = ${targetId}, updated_at = now()
          where id = ${sourcePay.id}
        `;
      }
    }

    // 4. Eliminar el jugador origen
    await tx`delete from players where id = ${sourceId}`;
  });
}
