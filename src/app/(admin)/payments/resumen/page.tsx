import { PaymentsSummary } from "@/components/admin/PaymentsSummary";
import { getSifupData } from "@/lib/repository";
import { hasPermission } from "@/lib/auth";
import { currentMonthKey } from "@/lib/store";

export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const monthKey = date && /^\d{4}-\d{2}$/.test(date) ? date : currentMonthKey();
  const [canEdit, data] = await Promise.all([hasPermission("payments"), getSifupData()]);
  return <PaymentsSummary data={data} monthKey={monthKey} canEdit={canEdit} />;
}
