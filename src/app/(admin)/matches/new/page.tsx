import { NewMatchPage } from "@/components/admin/SifupWorkspace";
import { requireAdmin } from "@/lib/auth";

export default async function Page() {
  await requireAdmin();
  return <NewMatchPage />;
}
