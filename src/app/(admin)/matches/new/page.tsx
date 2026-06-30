import { NewMatchPage } from "@/components/admin/SifupWorkspace";
import { requireAdmin } from "@/lib/auth";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  await requireAdmin();
  return <NewMatchPage initialData={await getSifupData()} />;
}
