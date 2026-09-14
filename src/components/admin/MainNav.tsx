"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth";

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

function itemsForRole(role: Role | null): NavItem[] {
  if (role === "galleta") {
    return [
      { href: "/matches", label: "Partidos", icon: "icon-calendar" },
      { href: "/standings", label: "Rankings", icon: "icon-trophy" },
    ];
  }

  const items: NavItem[] = [
    { href: "/dashboard", label: "Inicio", icon: "icon-home" },
    { href: "/matches", label: "Partidos", icon: "icon-calendar" },
    { href: "/players", label: "Jugadores", icon: "icon-users" },
    { href: "/payments", label: "Pagos", icon: "icon-wallet" },
    { href: "/standings", label: "Rankings", icon: "icon-trophy" },
  ];

  if (role === "admin") items.push({ href: "/users", label: "Usuarios", icon: "icon-settings" });

  return items;
}

export function MainNav({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const items = itemsForRole(role);

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
