import { PlayerEditPage } from "@/components/admin/SifupWorkspace";
import { getSifupData } from "@/lib/repository";
import { getPlayerLogin, hasPermission } from "@/lib/auth";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canManageLogins = await hasPermission("users");
  const playerLogin = canManageLogins ? await getPlayerLogin(id) : null;
  return (
    <PlayerEditPage
      id={id}
      initialData={await getSifupData()}
      playerLogin={playerLogin}
      canManageLogins={canManageLogins}
    />
  );
}
