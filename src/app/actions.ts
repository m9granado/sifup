"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, validPassword, requirePermission } from "@/lib/auth";
import { getSql, hasDatabaseUrl } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { randomUUID } from "crypto";
import {
  clearMatchFinalStanding,
  finishMatchGame,
  markMatchPlayerPaid,
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
import type { Match, MatchGame, MatchPlayer, MatchResult, MatchTeam, MonthlyPayment, Player } from "@/lib/types";

export type LoginState = { error: string };

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
  `);
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

export async function mergePlayersAction(sourceId: string, targetId: string) {
  await requirePermission("users");
  await repositoryMergePlayers(sourceId, targetId);
  revalidateAdminViews();
}
