import { MatchDetailPage } from "@/components/admin/SifupWorkspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatchDetailPage id={id} />;
}
