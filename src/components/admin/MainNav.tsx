"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

export function MainNav({ nextMatchId }: { nextMatchId?: string }) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/dashboard", label: "Inicio", icon: "icon-home" },
    { href: "/matches", label: "Partidos", icon: "icon-calendar" },
    { href: "/players", label: "Jugadores", icon: "icon-users" },
    ...(nextMatchId ? [{ href: `/matches/${nextMatchId}/teams`, label: "Equipos", icon: "icon-shield" }] : []),
    { href: "/payments", label: "Pagos", icon: "icon-wallet" },
    { href: "/standings", label: "Rankings", icon: "icon-trophy" },
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
            <span>
              <svg>
                <use href={`#${item.icon}`} />
              </svg>
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
