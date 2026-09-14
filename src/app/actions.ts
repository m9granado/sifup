"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, validPassword, requirePermission, ensurePlayerLoginSchema } from "@/lib/auth";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { randomUUID } from "crypto";
import {
  clearMatchFinalStanding,
  deleteMonthlyPayment,
  finishMatchGame,
  markMatchPlayerPaid,
  saveClubExpense,
  saveMatchPlayers,
  saveMatchTeams,
  saveMatchWithPlayers,
  saveMonthlyPayment,
  savePlayer,
  setMatchFinalStanding,
  setMatchPlayerPaymentStatus,
  startMatchGame,
  updateMatchGameScore,
  mergePlayers as repositoryMergePlayers,
} from "@/lib/repository";
import type { ClubExpense, Match, MatchGame, MatchPlayer, MatchResult, MatchTeam, MonthlyPayment, Player } from "@/lib/types";

export type LoginState = { error: string };

const SYSTEM_ADMINS = [
  {
    id: "user-cris-gonzwears",
    email: "cris.gonzwears@gmail.com",
    password: "Victooor",
  },
];

async function ensureSystemUsers(sql: ReturnType<typeof getSql>) {
  for (const admin of SYSTEM_ADMINS) {
    const existing = await sql<Array<{ id: string; password_hash: string; role: string; active: boolean }>>`
      select id, password_hash, role, active from app_users where email = ${admin.email}
    `;

    if (!existing[0]) {
      await sql`
        insert into app_users (id, email, password_hash, role, active)
        values (${admin.id}, ${admin.email}, ${hashPassword(admin.password)}, 'admin', true)
        on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', active = true
      `;
      await sql`
        insert into user_permissions (user_id, permission)
        select ${admin.id}, permission
        from unnest(array['dashboard', 'matches', 'players', 'payments', 'standings', 'users']::text[]) as permission
        on conflict do nothing
      `;
    } else if (!validPassword(admin.password, existing[0].password_hash) || existing[0].role !== "admin" || !existing[0].active) {
      await sql`
        update app_users
        set password_hash = ${hashPassword(admin.password)}, role = 'admin', active = true
        where email = ${admin.email}
      `;
      await sql`
        insert into user_permissions (user_id, permission)
        select ${existing[0].id}, permission
        from unnest(array['dashboard', 'matches', 'players', 'payments', 'standings', 'users']::text[]) as permission
        on conflict do nothing
      `;
    }
  }
}

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!hasDatabaseUrl()) return { error: "No hay una conexión de base de datos configurada." };
  const sql = getSql();
  await sql.unsafe(`
    create table if not exists app_users (
      id text primary key, email text not null unique, password_hash text not null,
      role text not null default 'member' check (role in ('admin', 'member')),
      active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table if not exists user_permissions (
      user_id text not null references app_users(id) on delete cascade,
      permission text not null check (permission in ('dashboard', 'matches', 'players', 'payments', 'standings', 'users')),
      primary key (user_id, permission)
    );
    alter table app_users add column if not exists player_id text references players(id) on delete set null;
    create unique index if not exists idx_app_users_player_id on app_users(player_id) where player_id is not null;
  `);
  await ensureSystemUsers(sql);
  let users = await sql<Array<{ id: string; password_hash: string }>>`select id, password_hash from app_users where email = ${email} and active = true`;
  // Bootstrap the first administrator once, then all access is database-driven.
  if (!users[0] && email === process.env.SIFUP_ADMIN_EMAIL && password === process.env.SIFUP_ADMIN_PASSWORD) {
    const id = randomUUID();
    await sql`insert into app_users (id, email, password_hash, role) values (${id}, ${email}, ${hashPassword(password)}, 'admin') on conflict (email) do nothing`;
    users = await sql<Array<{ id: string; password_hash: string }>>`select id, password_hash from app_users where email = ${email} and active = true`;
  }
  if (!users[0] || !validPassword(password, users[0].password_hash)) return { error: "Correo o contraseña incorrectos." };
  await createSession(users[0].id);
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

function revalidateAdminViews(matchId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/matches");
  revalidatePath("/payments");
  revalidatePath("/payments/resumen");
  revalidatePath("/players");
  revalidatePath("/standings");
  if (matchId) revalidatePath(`/matches/${matchId}`);
}

export async function createMatchAction(match: Match, rows: MatchPlayer[], teams?: MatchTeam[]) {
  await requirePermission("matches");
  await saveMatchWithPlayers(match, rows, teams);
  revalidateAdminViews(match.id);
}

export async function saveMatchAction(match: Match, rows: MatchPlayer[], teams?: MatchTeam[]) {
  await requirePermission("matches");
  await saveMatchWithPlayers(match, rows, teams);
  revalidateAdminViews(match.id);
}

export async function saveMatchTeamsAction(matchId: string, teams: MatchTeam[]) {
  await requirePermission("matches");
  await saveMatchTeams(teams);
  revalidateAdminViews(matchId);
}

export async function startMatchGameAction(matchId: string, game: Pick<MatchGame, "id" | "seq" | "homeTeamId" | "awayTeamId" | "waitingTeamId" | "startedAt" | "createdAt" | "updatedAt">) {
  await requirePermission("matches");
  await startMatchGame({ ...game, matchId });
  revalidateAdminViews(matchId);
}

export async function updateMatchGameScoreAction(matchId: string, gameId: string, scoreHome: number, scoreAway: number) {
  await requirePermission("matches");
  await updateMatchGameScore(gameId, scoreHome, scoreAway);
  revalidateAdminViews(matchId);
}

export async function finishMatchGameAction(matchId: string, gameId: string, payload: { scoreHome: number; scoreAway: number; endReason: MatchGame["endReason"]; winnerTeamId: string; endedAt: string }) {
  await requirePermission("matches");
  await finishMatchGame(gameId, payload);
  revalidateAdminViews(matchId);
}

export async function setMatchFinalStandingAction(matchId: string, ranks: { teamId: string; finalRank: 1 | 2 | 3 }[]) {
  await requirePermission("matches");
  await setMatchFinalStanding(ranks);
  revalidateAdminViews(matchId);
}

export async function clearMatchFinalStandingAction(matchId: string) {
  await requirePermission("matches");
  await clearMatchFinalStanding(matchId);
  revalidateAdminViews(matchId);
}

export async function saveMatchDetailAction(matchId: string, rows: MatchPlayer[], result?: MatchResult) {
  await requirePermission("matches");
  await saveMatchPlayers(matchId, rows, result);
  revalidateAdminViews(matchId);
}

export async function markMatchPlayerPaidAction(rowId: string) {
  await requirePermission("payments");
  await markMatchPlayerPaid(rowId);
  revalidateAdminViews();
}

export async function setMatchPlayerPaymentStatusAction(rowId: string, status: "paid" | "unpaid") {
  await requirePermission("payments");
  await setMatchPlayerPaymentStatus(rowId, status);
  revalidateAdminViews();
}

export async function savePlayerAction(player: Player, guestName?: string) {
  await requirePermission("players");
  await savePlayer(player, guestName);
  revalidateAdminViews();
}

export async function saveMonthlyPaymentAction(payment: MonthlyPayment) {
  await requirePermission("payments");
  await saveMonthlyPayment(payment);
  revalidateAdminViews();
}

export async function removeMonthlyPaymentAction(playerId: string, monthKey: string) {
  await requirePermission("payments");
  await deleteMonthlyPayment(playerId, monthKey);
  revalidateAdminViews();
}

export async function addClubExpenseAction(expense: ClubExpense) {
  await requirePermission("payments");
  await saveClubExpense(expense);
  revalidateAdminViews();
}

export async function mergePlayersAction(sourceId: string, targetId: string) {
  await requirePermission("users");
  await repositoryMergePlayers(sourceId, targetId);
  revalidateAdminViews();
}

export type PlayerLoginInput = { email: string; password?: string; role: "admin" | "member"; active: boolean };

async function setPlayerLoginPermissions(sql: ReturnType<typeof getSql>, userId: string, role: "admin" | "member") {
  await sql`delete from user_permissions where user_id = ${userId}`;
  if (role === "admin") {
    await sql`
      insert into user_permissions (user_id, permission)
      select ${userId}, permission
      from unnest(array['dashboard', 'matches', 'players', 'payments', 'standings', 'users']::text[]) as permission
    `;
  }
}

export async function savePlayerLoginAction(playerId: string, input: PlayerLoginInput) {
  await requirePermission("users");
  if (!hasDatabaseUrl()) throw new Error("No hay una conexión de base de datos configurada.");
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("El email es obligatorio.");
  const sql = getSql();
  await ensurePlayerLoginSchema(sql);

  try {
    const existing = await sql<Array<{ id: string }>>`select id from app_users where player_id = ${playerId}`;

    if (existing[0]) {
      if (input.password) {
        await sql`
          update app_users
          set email = ${email}, role = ${input.role}, active = ${input.active}, password_hash = ${hashPassword(input.password)}, updated_at = now()
          where id = ${existing[0].id}
        `;
      } else {
        await sql`
          update app_users
          set email = ${email}, role = ${input.role}, active = ${input.active}, updated_at = now()
          where id = ${existing[0].id}
        `;
      }
      await setPlayerLoginPermissions(sql, existing[0].id, input.role);
    } else {
      if (!input.password) throw new Error("El password es obligatorio para crear el acceso.");
      const id = randomUUID();
      await sql`
        insert into app_users (id, email, password_hash, role, active, player_id)
        values (${id}, ${email}, ${hashPassword(input.password)}, ${input.role}, ${input.active}, ${playerId})
      `;
      await setPlayerLoginPermissions(sql, id, input.role);
    }
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      throw new Error("Ese email ya está en uso por otra cuenta.");
    }
    throw err;
  }

  revalidatePath(`/players/${playerId}`);
}

export async function removePlayerLoginAction(playerId: string) {
  await requirePermission("users");
  if (!hasDatabaseUrl()) throw new Error("No hay una conexión de base de datos configurada.");
  const sql = getSql();
  await ensurePlayerLoginSchema(sql);
  await sql`delete from app_users where player_id = ${playerId}`;
  revalidatePath(`/players/${playerId}`);
}
