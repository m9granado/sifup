import { MatchesPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";

export default async function Page() {
  return <MatchesPage initialData={await getSifupData()} />;
}
