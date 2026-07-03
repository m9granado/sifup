const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function monthKey(date: string) {
  return date.slice(0, 7);
}

export function weekLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const week = Math.ceil(parsed.getDate() / 7);
  return `${week}a sem ${monthNames[parsed.getMonth()] ?? ""}`.trim();
}

