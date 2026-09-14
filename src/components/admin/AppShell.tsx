import Image from "next/image";
import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions";
import type { Role } from "@/lib/auth";
import { AuthModeProvider } from "./AuthMode";
import { IconSprite } from "./IconSprite";
import { MainNav } from "./MainNav";

export function AppShell({
  children,
  role,
  playerId,
}: {
  children: React.ReactNode;
  role: Role | null;
  playerId: string | null;
}) {
  const homeHref = role === "galleta" ? "/matches" : "/dashboard";
  return (
    <AuthModeProvider role={role} playerId={playerId}>
      <IconSprite />
      <input className="menu-toggle" type="checkbox" id="menu-toggle" aria-label="Abrir menu" />
      <div className="shell">
        <header className="mobile-header">
          <Link className="mobile-brand" href={homeHref} aria-label="SIFUP">
            <Image src="/brand/sifup-logo-preferred.png" alt="SIFUP" width={1015} height={600} />
          </Link>
          <label className="hamburger" htmlFor="menu-toggle" aria-label="Abrir menu">
            <span></span>
          </label>
        </header>

        <label className="menu-scrim" htmlFor="menu-toggle" aria-hidden="true"></label>

        <aside className="sidebar" aria-label="Menu principal">
          <label className="sidebar-close" htmlFor="menu-toggle" aria-label="Cerrar menu">
            Cerrar
          </label>

          <Link className="brand" href={homeHref} aria-label="SIFUP">
            <Image src="/brand/sifup-logo-preferred.png" alt="SIFUP" width={1015} height={600} />
          </Link>

          <MainNav role={role} />

          <div className="sidebar-auth">
            {role ? (
              <form action={logoutAction}>
                <button type="submit">
                  <LogOut size={16} />
                  Logout
                </button>
              </form>
            ) : (
              <Link href="/login">
                <LogIn size={16} />
                Admin
              </Link>
            )}
          </div>

          <div className="sidebar-note">
            <strong>Design system</strong>
            <span>Futbol de barrio organizado: verde cancha, noche, textura, deuda visible y ranking vivo.</span>
          </div>
        </aside>

        <main className="content">{children}</main>
      </div>
    </AuthModeProvider>
  );
}
