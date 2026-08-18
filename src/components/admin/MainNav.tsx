"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

export function MainNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/dashboard", label: "Inicio", icon: "icon-home" },
    { href: "/matches", label: "Partidos", icon: "icon-calendar" },
    ...(isAdmin ? [{ href: "/players", label: "Jugadores", icon: "icon-users" }] : []),
    ...(isAdmin ? [{ href: "/payments", label: "Pagos", icon: "icon-wallet" }] : []),
    { href: "/standings", label: "Rankings", icon: "icon-trophy" },
  ];

  return (
    <nav className="main-nav">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
