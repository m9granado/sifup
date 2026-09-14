"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/auth";

type AuthMode = { role: Role | null; playerId: string | null };

const AuthModeContext = createContext<AuthMode>({ role: null, playerId: null });

export function AuthModeProvider({
  role,
  playerId,
  children,
}: {
  role: Role | null;
  playerId: string | null;
  children: React.ReactNode;
}) {
  return <AuthModeContext.Provider value={{ role, playerId }}>{children}</AuthModeContext.Provider>;
}

export function useAuthMode() {
  return useContext(AuthModeContext);
}

export function useIsAdmin() {
  return useContext(AuthModeContext).role === "admin";
}
