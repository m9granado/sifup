import type { Match } from "./types";

/** Date is the calendar source of truth; every match occurs exactly once. */
export function matchesOverview(matches: Match[], today: string) {
  const sorted = [...matches].sort((a, b) => `${b.date} ${b.time} ${b.id}`.localeCompare(`${a.date} ${a.time} ${a.id}`));
  const next = [...sorted].reverse().find(match => match.date >= today && ["open", "confirmed", "roster_locked"].includes(match.status));
  const latestActiveMonth = sorted.find(match => match.date <= today)?.date.slice(0, 7);
  const grouped = new Map<string, Match[]>();
  for (const match of sorted) {
    const key = match.date.slice(0, 7);
    grouped.set(key, [...(grouped.get(key) ?? []), match]);
  }
  return { next, months: [...grouped].map(([key, entries]) => ({ key, matches: entries.filter(match => match.id !== next?.id), open: key === next?.date.slice(0, 7) || key === latestActiveMonth })) };
}
