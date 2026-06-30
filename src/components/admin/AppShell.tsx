import Link from "next/link";
import { CalendarDays, CreditCard, Home, LogIn, LogOut, Trophy, Users } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { AuthModeProvider } from "./AuthMode";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/matches", label: "Matches", icon: CalendarDays },
  { href: "/players", label: "Players", icon: Users },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/standings", label: "Standings", icon: Trophy },
];

export function AppShell({
  children,
  isAdmin,
}: {
  children: React.ReactNode;
  isAdmin: boolean;
}) {
  return (
    <AuthModeProvider isAdmin={isAdmin}>
      <div className="min-h-screen bg-gray-50 text-gray-950">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-700 text-sm font-black text-white">
              SF
            </span>
            <div>
              <p className="text-base font-bold leading-5">SIFUP</p>
              <p className="hidden text-xs text-gray-500 sm:block">WhatsApp a administracion</p>
            </div>
          </Link>
          {isAdmin ? (
            <form action={logoutAction}>
              <button className="flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-100">
                <LogOut size={16} />
                Logout
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              <LogIn size={16} />
              Admin
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 pb-24 pt-4 md:grid-cols-[220px_1fr] md:pb-8">
        <aside className="hidden md:block">
          <nav className="sticky top-20 space-y-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-white hover:text-emerald-800"
              >
                <item.icon size={17} />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-gray-200 bg-white md:hidden">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium text-gray-700"
          >
            <item.icon size={18} />
            {item.label}
          </Link>
        ))}
      </nav>
      </div>
    </AuthModeProvider>
  );
}
