import { AppShell } from "@/components/admin/AppShell";
import { getCurrentUser } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <AppShell role={user?.role ?? null} playerId={user?.playerId ?? null}>
      {children}
    </AppShell>
  );
}
