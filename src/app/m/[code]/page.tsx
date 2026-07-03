import { notFound, redirect } from "next/navigation";
import { getSifupData } from "@/lib/repository";
import type { Match } from "@/lib/types";

function dateCodes(match: Match) {
  const [month, day] = match.date.slice(5).split("-");
  return [
    `${month}${day}`,
    `${Number(month)}${day}`,
    `${Number(month)}${Number(day)}`,
  ];
}

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const data = await getSifupData();
  const sorted = [...data.matches].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const numericIndex = Number(code);
  const match = sorted.find((item) => dateCodes(item).includes(code)) ?? (Number.isInteger(numericIndex) && numericIndex > 0 ? sorted[numericIndex - 1] : undefined);

  if (!match) notFound();
  redirect(`/matches/${match.id}`);
}
