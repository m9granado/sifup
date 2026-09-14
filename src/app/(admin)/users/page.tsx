import { UsersWorkspace } from "@/components/admin/UsersWorkspace";
import { requireAdmin } from "@/lib/auth";
import { getSifupData, listUsers } from "@/lib/repository";

export default async function Page() {
  await requireAdmin();
  const [users, data] = await Promise.all([listUsers(), getSifupData()]);
  return <UsersWorkspace users={users} players={data.players} />;
}
