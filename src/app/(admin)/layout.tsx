import { AppShell } from "@/components/admin/AppShell";
import { getCurrentUser } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const isAdmin = Boolean(user);
  const canPayments = Boolean(user && (user.role === "admin" || user.permissions.includes("payments")));
  return (
    <AppShell isAdmin={isAdmin} canPayments={canPayments}>
      {children}
    </AppShell>
  );
}
