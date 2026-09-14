import { TeamsPage } from "@/components/admin/SifupWorkspace";
import { requireRole } from "@/lib/auth";
import { getSifupData } from "@/lib/repository";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "jugador", "galleta"]);
  const { id } = await params;
  return <TeamsPage id={id} initialData={await getSifupData()} />;
}
