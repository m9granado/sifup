import { PlayerComparisonPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  return <PlayerComparisonPage initialData={await getSifupData()} />;
}
