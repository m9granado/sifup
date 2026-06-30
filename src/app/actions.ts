"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, validPassword } from "@/lib/auth";

export type LoginState = { error: string };

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  if (!validPassword(password)) {
    return { error: "Password incorrecto o SIFUP_ADMIN_PASSWORD no configurado." };
  }
  await createSession();
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
