import { StandingsPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  return <StandingsPage initialData={await getSifupData()} />;
}
