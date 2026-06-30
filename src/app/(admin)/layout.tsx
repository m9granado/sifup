import { AppShell } from "@/components/admin/AppShell";
import { isAuthenticated } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const isAdmin = await isAuthenticated();
  return <AppShell isAdmin={isAdmin}>{children}</AppShell>;
}
