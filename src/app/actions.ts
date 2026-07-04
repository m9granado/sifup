"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, hasAdminPassword, validPassword } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth";
import {
  markMatchPlayerPaid,
  saveMatchPlayers,
  saveMatchWithPlayers,
  saveMonthlyPayment,
  savePlayer,
  setMatchPlayerPaymentStatus,
} from "@/lib/repository";
import type { Match, MatchPlayer, MatchResult, MonthlyPayment, Player } from "@/lib/types";

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

export async function createMatchAction(match: Match, rows: MatchPlayer[]) {
  await requireAdmin();
  await saveMatchWithPlayers(match, rows);
  revalidateAdminViews(match.id);
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

export async function savePlayerAction(player: Player) {
  await requireAdmin();
  await savePlayer(player);
  revalidateAdminViews();
}

export async function saveMonthlyPaymentAction(payment: MonthlyPayment) {
  await requireAdmin();
  await saveMonthlyPayment(payment);
  revalidateAdminViews();
}
