import { DashboardPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  return <DashboardPage initialData={await getSifupData()} />;
}
