import { PlayersPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  return <PlayersPage initialData={await getSifupData()} />;
}
