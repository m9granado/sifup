import { MatchesPage } from "@/components/admin/SifupWorkspace";
import { requireRole } from "@/lib/auth";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  await requireRole(["admin", "jugador", "galleta"]);
  return <MatchesPage initialData={await getSifupData()} />;
}
