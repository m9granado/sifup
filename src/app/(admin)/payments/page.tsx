import { PaymentsPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  return <PaymentsPage initialData={await getSifupData()} />;
}
