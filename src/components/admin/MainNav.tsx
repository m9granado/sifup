"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  code: string;
};

export function MainNav({ nextMatchId }: { nextMatchId?: string }) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/dashboard", label: "Inicio", code: "IN" },
    { href: "/matches", label: "Partidos", code: "PA" },
    { href: "/players", label: "Jugadores", code: "JU" },
    ...(nextMatchId ? [{ href: `/matches/${nextMatchId}/teams`, label: "Equipos", code: "EQ" }] : []),
    { href: "/payments", label: "Pagos", code: "PG" },
    { href: "/standings", label: "Rankings", code: "RK" },
  ];

  const teamsHref = nextMatchId ? `/matches/${nextMatchId}/teams` : undefined;

  return (
    <nav className="main-nav">
      {items.map((item) => {
        const isMatchesItem = item.href === "/matches";
        const active = isMatchesItem
          ? (pathname === item.href || pathname.startsWith(`${item.href}/`)) && pathname !== teamsHref
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : undefined}>
            <span>{item.code}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
