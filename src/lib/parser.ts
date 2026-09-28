import type { AttendanceStatus, Match, MatchPlayer, PaymentStatus } from "./types";
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
  match: Pick<Match, "date" | "time" | "location" | "notes" | "totalCost"> & {
    squadTarget?: number;
    matchFormat?: Match["matchFormat"];
  };
  players: Omit<MatchPlayer, "id" | "matchId" | "createdAt" | "updatedAt">[];
  errors: string[];
};

export function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Limpia emojis, símbolos de formato y texto entre paréntesis o corchetes del nombre.
 * Se usa de forma unificada antes de buscar jugadores por nombre o apodo.
 */
export function cleanPlayerName(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[✅🍪⚽💰🪑❌🔴🟡🟢•·*~_|/#]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function parseHeader(headerLines: string[]) {
  const joined = normalize(headerLines.join(" "));
  const monthNames = Object.keys(monthMap).join("|");

  // 1. Fecha en formato "martes 7 julio", "22 septiembre", "Martes 29 Septiembre", "29 de Septiembre"
  const dayMonthMatch = joined.match(
    new RegExp(`(?:^|\\s)(?:(?:lunes|martes|miercoles|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\\s+)?(\\d{1,2})\\s*(?:de\\s+)?(${monthNames})\\b`, "i"),
  );

  // 2. Fecha en formato numérico "Martes 29/09", "29/09", "29-09", etc.
  const numericDateMatch = joined.match(
    /(?:^|\s)(?:(?:lunes|martes|miercoles|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+)?(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:[\/.-](\d{2,4}))?\b/i,
  );

  const hourMatch =
    joined.match(/(?:^|[,\s·🕘])(\d{1,2})(?::(\d{2}))?\s*(?:horas|hrs|h)\b/i) ??
    joined.match(/(?:^|[,\s·🕘])(\d{1,2}):(\d{2})\b/) ??
    joined.match(/\b(?:a las|hora)\s+(\d{1,2})(?::(\d{2}))?\b/i);

  const locationLine = headerLines.find((line) =>
    /(?:📍|club|cancha|sordos|nunoa|ñuñoa|av\.?|avenida|calle|alessandri)/i.test(line),
  );
  let location = "";
  if (locationLine) {
    location = locationLine
      .replace(/^[📍\s*•\-·]+/, "")
      .replace(/:\s*$/, "")
      .trim();
  }

  const currentYear = new Date().getFullYear();
  let day: string | undefined;
  let month: string | undefined;
  let year: number = currentYear;

  if (dayMonthMatch) {
    day = dayMonthMatch[1].padStart(2, "0");
    month = monthMap[dayMonthMatch[2]];
  } else if (numericDateMatch) {
    day = numericDateMatch[1].padStart(2, "0");
    month = numericDateMatch[2].padStart(2, "0");
    if (numericDateMatch[3]) {
      const rawYear = Number(numericDateMatch[3]);
      year = numericDateMatch[3].length === 2 ? 2000 + rawYear : rawYear;
    }
  }

  const parsedHour = Number(hourMatch?.[1]);
  const hour =
    Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23
      ? String(parsedHour).padStart(2, "0")
      : "21";
  const minute = hourMatch?.[2] ?? "00";

  // Detección de formato 7x7 o squadTarget
  const is7x7 = /\b7x7\b|\b7\s*vs\s*7\b|\b7\s*v\s*7\b/i.test(joined);
  const targetMatch = joined.match(/\((\d{1,2})\/(\d{1,2})\)/);
  const squadTarget = is7x7 ? 14 : targetMatch ? Number(targetMatch[2]) : 12;

  return {
    date: month && day ? `${year}-${month}-${day}` : "",
    time: `${hour}:${minute}`,
    location: location || "Por definir",
    matchFormat: is7x7 || squadTarget === 14 ? ("7x7" as const) : ("clasico" as const),
    squadTarget,
  };
}

export function parseWhatsAppList(input: string, amountDue = 4000): ParsedWhatsAppList {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim())
    .filter(Boolean);
  const errors: string[] = [];
  const headerLines: string[] = [];

  for (const line of lines) {
    if (parseSection(line) || isListItem(line)) break;
    if (/^jugadores\s*:?$/i.test(normalize(line))) continue;
    headerLines.push(line);
  }

  const headerSet = new Set(headerLines);
  const matchInfo = parseHeader(headerLines);

  if (!matchInfo.date) errors.push("No se pudo detectar la fecha del partido.");
  if (!matchInfo.time) errors.push("No se pudo detectar la hora del partido.");

  const players: ParsedWhatsAppList["players"] = [];
  let currentSection: AttendanceStatus = "confirmed";

  let confirmedOrder = 1;
  let galletaOrder = 1;
  let bancaOrder = 1;
  let outOrder = 1;

  // Para evitar que el mismo jugador quede duplicado en el mismo partido
  const seenNames = new Set<string>();

  for (const line of lines) {
    if (headerSet.has(line)) continue;

    const section = parseSection(line);
    if (section) {
      currentSection = section.status;
      continue;
    }

    if (!isListItem(line)) continue;

    const hasCookie = /🍪/u.test(line) || /cookie/i.test(line);
    const noteMatch = line.match(/\(([^)]+)\)/);
    const rawNote = noteMatch?.[1] ?? "";
    const { paymentStatus, note } = parsePayment(rawNote);

    // Detección del número de orden si viene al inicio (ej. "🍪 1- Jonathan", "1 · Marcio", "1- Victor")
    const orderMatch = line
      .replace(/^[\s🍪•*\-·]+/, "")
      .match(/^(\d{1,2})\s*[\).\-·:]\s*/);
    const parsedOrderNum = orderMatch ? Number(orderMatch[1]) : undefined;

    // Remover marcadores de lista y números iniciales para aislar el nombre
    const withoutMarker = line
      .replace(/^[\s🍪•*\-·]+/, "")
      .replace(/^(\d{1,2})\s*[\).\-·:]\s*/, "")
      .replace(/^[\s🍪•*\-·]+/, "")
      .trim();

    // Limpieza completa de emojis y notas del nombre
    const name = cleanPlayerName(withoutMarker);
    if (!name) continue;

    const normalizedNameKey = normalize(name);
    if (seenNames.has(normalizedNameKey)) {
      // Omitir duplicados exactos en la misma lista
      continue;
    }
    seenNames.add(normalizedNameKey);

    // Determinar estado de asistencia:
    // Si la sección es "galleta", o si tiene emoji 🍪 y no está explícitamente en "banca" ni en "out", es "galleta"
    let status: AttendanceStatus = currentSection;
    if (status !== "out" && status !== "banca") {
      if (currentSection === "galleta" || hasCookie) {
        status = "galleta";
      }
    }

    // Numeración de orden propia por categoría
    let whatsappOrder: number;
    if (status === "confirmed") {
      whatsappOrder = parsedOrderNum ?? confirmedOrder++;
    } else if (status === "galleta") {
      whatsappOrder = parsedOrderNum ?? galletaOrder++;
    } else if (status === "banca") {
      whatsappOrder = parsedOrderNum ?? bancaOrder++;
    } else {
      whatsappOrder = parsedOrderNum ?? outOrder++;
    }

    const isOut = status === "out";
    const itemNote = isOut
      ? "No puede"
      : status === "galleta"
        ? note || "Galleta abierta"
        : status === "banca"
          ? note || "Banca"
          : note;

    players.push({
      name,
      phone: "",
      attendanceStatus: status,
      paymentStatus: isOut ? "paid" : paymentStatus,
      amountDue: isOut ? 0 : amountDue,
      amountPaid: isOut || paymentStatus !== "paid" ? 0 : amountDue,
      note: itemNote,
      team: "none" as const,
      whatsappOrder,
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
      squadTarget: matchInfo.squadTarget,
      matchFormat: matchInfo.matchFormat,
    },
    players,
    errors,
  };
}

function parseSection(line: string): { status: AttendanceStatus; label: string } | undefined {
  const clean = normalize(line)
    .replace(/[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[*\-_#~•·]/gu, "")
    .replace(/\s*:\s*$/, "")
    .replace(/\s*\(\d+\/\d+\)\s*$/, "")
    .trim();

  if (/^no\s+pueden?$/i.test(clean)) return { status: "out", label: "No puede" };
  if (/^banca$/i.test(clean)) return { status: "banca", label: "Banca" };
  if (/^(?:galletas?(?:\s+abiertas?)?|lista\s+de\s+espera(?:\s+de\s+galletas?)?)$/i.test(clean)) {
    return { status: "galleta", label: "Galleta abierta" };
  }
  if (/^(?:jugadores|lista)(?:\s+(?:oficiales|confirmados))?$/i.test(clean)) {
    return { status: "confirmed", label: "" };
  }
  return undefined;
}

function isListItem(line: string) {
  // Lista con bullet, número, punto o emoji 🍪
  if (/^\s*(?:[\p{Extended_Pictographic}*•\-·]\s*\S|\d{1,2}\s*[\).\-·:]\s*\S)/u.test(line)) return true;
  if (/🍪/u.test(line)) return true;
  return false;
}

export function parseDefaultWhatsAppList(input: string) {
  return parseWhatsAppList(input, PER_MATCH_AMOUNT);
}
