"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, hasAdminPassword, validPassword } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth";
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
  const password = String(formData.get("password") ?? "");
  if (!hasAdminPassword()) {
    return { error: "SIFUP_ADMIN_PASSWORD no esta configurado en Vercel." };
  }
  if (!validPassword(password)) {
    return { error: "Password incorrecto." };
  }
  await createSession();
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
  await requireAdmin();
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
