import { PaymentsPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";
import { requireRole } from "@/lib/auth";

export default async function Page() {
  await requireRole(["admin", "jugador"]);
  return <PaymentsPage initialData={await getSifupData()} />;
}
