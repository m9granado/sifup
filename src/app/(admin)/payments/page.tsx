import { PaymentsPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";
import { requirePermission } from "@/lib/auth";

export default async function Page() {
  await requirePermission("payments");
  return <PaymentsPage initialData={await getSifupData()} />;
}
