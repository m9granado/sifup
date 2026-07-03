import type { Match, MatchPlayer, PaymentStatus } from "./types";
import { PER_MATCH_AMOUNT } from "./sifup-constants";

const monthMap: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

export type ParsedWhatsAppList = {
  match: Pick<Match, "date" | "time" | "location" | "notes" | "totalCost">;
  players: Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[];
  errors: string[];
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parsePayment(raw: string): { paymentStatus: PaymentStatus; note: string } {
  const clean = normalize(raw);
  if (clean.includes("no pagado")) return { paymentStatus: "unpaid", note: "" };
  if (clean.includes("pagado")) return { paymentStatus: "paid", note: "" };
  if (
    clean.includes("pago manana") ||
    clean.includes("paga manana") ||
    clean.includes("pago despues") ||
    clean.includes("paga despues")
  ) {
    return { paymentStatus: "promised", note: raw.trim() };
  }
  return { paymentStatus: "unpaid", note: raw.trim() };
}

function parseHeader(line: string) {
  const normalized = normalize(line);
  const dayMonthMatch = normalized.match(/(\d{1,2})\s+([a-z]+)/);
  const hourMatch =
    normalized.match(/(?:^|[,\s])(\d{1,2})(?::(\d{2}))?\s*(?:horas|hrs|h)\b/) ??
    normalized.match(/\b(?:a las|hora)\s+(\d{1,2})(?::(\d{2}))?\b/);
  const rawTail = line.split(":").slice(1).join(":").trim().replace(/\.$/, "");
  const location = /(?:club|cancha|sordos|nunoa|ñuñoa|av\.?|avenida|calle)/i.test(rawTail) ? rawTail : "";
  const year = new Date().getFullYear();
  const month = dayMonthMatch ? monthMap[dayMonthMatch[2]] : undefined;
  const day = dayMonthMatch?.[1].padStart(2, "0");
  const parsedHour = Number(hourMatch?.[1]);
  const hour = Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23
    ? String(parsedHour).padStart(2, "0")
    : "21";
  const minute = hourMatch?.[2] ?? "00";

  return {
    date: month && day ? `${year}-${month}-${day}` : "",
    time: `${hour}:${minute}`,
    location: location || "Por definir",
  };
}

export function parseWhatsAppList(input: string, amountDue = 4000): ParsedWhatsAppList {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim())
    .filter(Boolean);
  const errors: string[] = [];
  const header = lines.find((line) => !isListItem(line) && !isOutSection(line)) ?? "";
  const matchInfo = parseHeader(header);

  if (!matchInfo.date) errors.push("No se pudo detectar la fecha del partido.");
  if (!matchInfo.time) errors.push("No se pudo detectar la hora del partido.");

  const players: ParsedWhatsAppList["players"] = [];
  let currentSection: "confirmed" | "out" = "confirmed";

  for (const line of lines) {
    if (line === header) continue;
    if (isOutSection(line)) {
      currentSection = "out";
      continue;
    }
    if (!isListItem(line)) continue;

      const orderMatch = line.match(/^(\d+)[\).-]\s*/);
    const order = players.length + 1;
    const withoutNumber = line
      .replace(/^\s*(?:[*\-•]\s*)?(\d+)[\).-]\s*/, "")
      .replace(/^\s*[*\-•]\s*/, "")
      .trim();
      const noteMatch = withoutNumber.match(/\(([^)]+)\)/);
      const rawNote = noteMatch?.[1] ?? "";
      const name = withoutNumber.replace(/\s*\([^)]+\)\s*/g, "").trim();
      const { paymentStatus, note } = parsePayment(rawNote);
    if (!name) continue;

    players.push({
      name,
      phone: "",
      attendanceStatus: currentSection,
      paymentStatus: currentSection === "out" ? "paid" : paymentStatus,
      amountDue: currentSection === "out" ? 0 : amountDue,
      amountPaid: currentSection === "out" || paymentStatus !== "paid" ? 0 : amountDue,
      note: currentSection === "out" ? "No puede" : note,
      team: "none" as const,
      whatsappOrder: Number(orderMatch?.[1] ?? order),
      goals: 0,
    });
  }

  if (players.length === 0) errors.push("No se detectaron jugadores en la lista.");

  return {
    match: {
      date: matchInfo.date,
      time: matchInfo.time,
      location: matchInfo.location,
      notes: "Importado desde WhatsApp.",
      totalCost: players.length * amountDue,
    },
    players,
    errors,
  };
}

function isOutSection(line: string) {
  return /^no\s+pueden\s*:?\s*$/i.test(normalize(line));
}

function isListItem(line: string) {
  return /^\s*(?:[*\-•]\s*)?(?:\d+[\).-]\s*)?\S+/.test(line) && !line.includes(":");
}

export function parseDefaultWhatsAppList(input: string) {
  return parseWhatsAppList(input, PER_MATCH_AMOUNT);
}
