import { AppShell } from "@/components/admin/AppShell";
import { isAuthenticated } from "@/lib/auth";
import { getSifupData } from "@/lib/repository";
import { nextMatch } from "@/lib/store";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [isAdmin, data] = await Promise.all([isAuthenticated(), getSifupData()]);
  const nextMatchId = nextMatch(data.matches)?.id;
  return (
    <AppShell isAdmin={isAdmin} nextMatchId={nextMatchId}>
      {children}
    </AppShell>
  );
}
