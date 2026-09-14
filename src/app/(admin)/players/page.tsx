import { PlayersPage } from "@/components/admin/SifupWorkspace";
import { requireRole } from "@/lib/auth";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  await requireRole(["admin", "jugador"]);
  return <PlayersPage initialData={await getSifupData()} />;
}
