"use client";

import { createContext, useContext } from "react";

const AuthModeContext = createContext(false);

export function AuthModeProvider({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  return <AuthModeContext.Provider value={isAdmin}>{children}</AuthModeContext.Provider>;
}

export function useIsAdmin() {
  return useContext(AuthModeContext);
}
