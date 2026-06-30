"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession, hasAdminPassword, validPassword } from "@/lib/auth";

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
