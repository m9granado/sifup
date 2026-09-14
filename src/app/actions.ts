"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, validPassword, requireAdmin, requireOwnPlayerOrAdmin, type Role } from "@/lib/auth";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { randomUUID } from "crypto";
import {
  clearMatchFinalStanding,
  createUser,
  finishMatchGame,
  markMatchPlayerPaid,
  resetUserPassword,
  saveMatchPlayers,
  saveMatchTeams,
  saveMatchWithPlayers,
  saveMonthlyPayment,
  savePlayer,
  setMatchFinalStanding,
  setMatchPlayerPaymentStatus,
  startMatchGame,
  updateMatchGameScore,
  updateUser,
  mergePlayers as repositoryMergePlayers,
} from "@/lib/repository";
import type { Match, MatchGame, MatchPlayer, MatchResult, MatchTeam, MonthlyPayment, Player } from "@/lib/types";

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
    } else if (!validPassword(admin.password, existing[0].password_hash) || existing[0].role !== "admin" || !existing[0].active) {
      await sql`
        update app_users
        set password_hash = ${hashPassword(admin.password)}, role = 'admin', active = true
        where email = ${admin.email}
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
      role text not null default 'jugador' check (role in ('admin', 'jugador', 'galleta')),
      active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      player_id text
    );
  `);
  await ensureSystemUsers(sql);
  let users = await sql<Array<{ id: string; password_hash: string; role: Role }>>`select id, password_hash, role from app_users where email = ${email} and active = true`;
  // Bootstrap the first administrator once, then all access is database-driven.
  if (!users[0] && email === process.env.SIFUP_ADMIN_EMAIL && password === process.env.SIFUP_ADMIN_PASSWORD) {
    const id = randomUUID();
    await sql`insert into app_users (id, email, password_hash, role) values (${id}, ${email}, ${hashPassword(password)}, 'admin') on conflict (email) do nothing`;
    users = await sql<Array<{ id: string; password_hash: string; role: Role }>>`select id, password_hash, role from app_users where email = ${email} and active = true`;
  }
  if (!users[0] || !validPassword(password, users[0].password_hash)) return { error: "Correo o contraseña incorrectos." };
  await createSession(users[0].id);
  redirect(users[0].role === "galleta" ? "/matches" : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

function revalidateAdminViews(matchId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/matches");
  revalidatePath("/payments");
  revalidatePath("/players");
  revalidatePath("/standings");
  if (matchId) revalidatePath(`/matches/${matchId}`);
}

export async function createMatchAction(match: Match, rows: MatchPlayer[], teams?: MatchTeam[]) {
  await requireAdmin();
  await saveMatchWithPlayers(match, rows, teams);
  revalidateAdminViews(match.id);
}

export async function saveMatchAction(match: Match, rows: MatchPlayer[], teams?: MatchTeam[]) {
  await requireAdmin();
  await saveMatchWithPlayers(match, rows, teams);
  revalidateAdminViews(match.id);
}

export async function saveMatchTeamsAction(matchId: string, teams: MatchTeam[]) {
  await requireAdmin();
  await saveMatchTeams(teams);
  revalidateAdminViews(matchId);
}

export async function startMatchGameAction(matchId: string, game: Pick<MatchGame, "id" | "seq" | "homeTeamId" | "awayTeamId" | "waitingTeamId" | "startedAt" | "createdAt" | "updatedAt">) {
  await requireAdmin();
  await startMatchGame({ ...game, matchId });
  revalidateAdminViews(matchId);
}

export async function updateMatchGameScoreAction(matchId: string, gameId: string, scoreHome: number, scoreAway: number) {
  await requireAdmin();
  await updateMatchGameScore(gameId, scoreHome, scoreAway);
  revalidateAdminViews(matchId);
}

export async function finishMatchGameAction(matchId: string, gameId: string, payload: { scoreHome: number; scoreAway: number; endReason: MatchGame["endReason"]; winnerTeamId: string; endedAt: string }) {
  await requireAdmin();
  await finishMatchGame(gameId, payload);
  revalidateAdminViews(matchId);
}

export async function setMatchFinalStandingAction(matchId: string, ranks: { teamId: string; finalRank: 1 | 2 | 3 }[]) {
  await requireAdmin();
  await setMatchFinalStanding(ranks);
  revalidateAdminViews(matchId);
}

export async function clearMatchFinalStandingAction(matchId: string) {
  await requireAdmin();
  await clearMatchFinalStanding(matchId);
  revalidateAdminViews(matchId);
}

export async function saveMatchDetailAction(matchId: string, rows: MatchPlayer[], result?: MatchResult) {
  await requireAdmin();
  await saveMatchPlayers(matchId, rows, result);
  revalidateAdminViews(matchId);
}

export async function markMatchPlayerPaidAction(rowId: string) {
  await requireAdmin();
  await markMatchPlayerPaid(rowId);
  revalidateAdminViews();
}

export async function setMatchPlayerPaymentStatusAction(rowId: string, status: "paid" | "unpaid") {
  await requireAdmin();
  await setMatchPlayerPaymentStatus(rowId, status);
  revalidateAdminViews();
}

export async function savePlayerAction(player: Player, guestName?: string) {
  await requireOwnPlayerOrAdmin(player.id);
  await savePlayer(player, guestName);
  revalidateAdminViews();
}

export async function saveMonthlyPaymentAction(payment: MonthlyPayment) {
  await requireAdmin();
  await saveMonthlyPayment(payment);
  revalidateAdminViews();
}

export async function mergePlayersAction(sourceId: string, targetId: string) {
  await requireAdmin();
  await repositoryMergePlayers(sourceId, targetId);
  revalidateAdminViews();
}

function revalidateUsersView() {
  revalidatePath("/users");
}

export async function createUserAction(input: { email: string; password: string; role: Role; playerId: string | null }) {
  await requireAdmin();
  await createUser({
    id: randomUUID(),
    email: input.email.trim().toLowerCase(),
    passwordHash: hashPassword(input.password),
    role: input.role,
    playerId: input.playerId,
  });
  revalidateUsersView();
}

export async function updateUserAction(userId: string, input: { role?: Role; active?: boolean; playerId?: string | null }) {
  await requireAdmin();
  await updateUser(userId, input);
  revalidateUsersView();
}

export async function resetUserPasswordAction(userId: string, newPassword: string) {
  await requireAdmin();
  await resetUserPassword(userId, hashPassword(newPassword));
  revalidateUsersView();
}
