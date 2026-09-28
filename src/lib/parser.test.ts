import assert from "node:assert/strict";
import test from "node:test";
import { cleanPlayerName, parseWhatsAppList } from "./parser";
import { matchSummaryMessage } from "./whatsapp";
import { summarizeMatch } from "./store";
import type { MatchPlayer } from "./types";

const realMessage = `martes 7 julio: 21 hrs, anotarse en lista:

* Victor
* Alonso
* Caldera
* Mario Quintana Kamassu
* Marcio

No pueden:
* Mantelli
* Cooper`;

test("parseWhatsAppList parses bullets and no pueden section with independent sequence numbering", () => {
  const result = parseWhatsAppList(realMessage, 3500);

  assert.deepEqual(result.errors, []);
  assert.equal(result.match.date, `${new Date().getFullYear()}-07-07`);
  assert.equal(result.match.time, "21:00");
  assert.equal(result.players.length, 7);
  assert.deepEqual(
    result.players.filter((player) => player.attendanceStatus === "confirmed").map((player) => player.name),
    ["Victor", "Alonso", "Caldera", "Mario Quintana Kamassu", "Marcio"],
  );
  assert.deepEqual(
    result.players.filter((player) => player.attendanceStatus === "out").map((player) => player.name),
    ["Mantelli", "Cooper"],
  );
  // Confirmados tienen su propia secuencia (1 a 5)
  assert.equal(result.players[0].whatsappOrder, 1);
  assert.equal(result.players[4].whatsappOrder, 5);
  // No pueden tienen secuencia independiente (1 a 2)
  assert.equal(result.players[5].whatsappOrder, 1);
  assert.equal(result.players[6].whatsappOrder, 2);
  assert.equal(result.players[5].amountDue, 0);
});

test("matchSummaryMessage renders template matching exact WhatsApp spec with dynamic target", () => {
  const parsed = parseWhatsAppList(realMessage, 3500);
  const text = matchSummaryMessage(
    {
      id: "match-test",
      date: parsed.match.date,
      time: parsed.match.time,
      location: "Club de los Sordos",
      status: "confirmed",
      totalCost: 35000,
      weekLabel: "1a sem jul",
      monthKey: "2026-07",
      courtCost: 35000,
      courtPrepaid: true,
      notes: "",
      matchFormat: "clasico",
      squadTarget: 12,
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
    },
    parsed.players.map((player, index) => ({
      ...player,
      id: `row-${index + 1}`,
      matchId: "match-test",
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
    })),
    [],
    [],
  );

  assert.match(text, /⚽ \*SIFUP · Fútbol de martes\*/);
  assert.match(text, /📅 Martes 7 Julio · 🕘 21:00 hrs/);
  assert.match(text, /📍 Club de los Sordos/);
  assert.match(text, /💰 Cancha pagada ✅/);
  assert.match(text, /\*Jugadores \(5\/12\)\*/);
  assert.match(text, / 1 · Victor/);
  assert.match(text, / 5 · Marcio/);
  assert.match(text, /12 · $/m);
  assert.match(text, /🍪 \*Galletas abiertas:\* -/);
  assert.match(text, /🪑 \*Banca:\* -/);
  assert.match(text, /❌ \*No pueden:\*\n- Mantelli\n- Cooper/);
  assert.match(text, /https:\/\/sifup\.vercel\.app\/m\/0707$/);
});

test("parseWhatsAppList keeps oficiales, galletas and banca as separate categories", () => {
  const result = parseWhatsAppList(`Partidos 22 Septiembre 21 horas
Club Sordos, Av. Jose Pedro Alessandri 1251, Nunoa:

Jugadores Oficiales:
1- Marcio
2- Pitico
3- Marcelo Calderon

Lista de Espera de Galletas
1- Mella
2- Mario Quintana
3- Jonathan

Banca:
1- Eduardo Loaiza

No pueden:
- Cooper
- Daniel Nettle`, 3500);

  assert.deepEqual(result.players.filter((p) => p.attendanceStatus === "confirmed").map((p) => p.name), ["Marcio", "Pitico", "Marcelo Calderon"]);
  assert.deepEqual(result.players.filter((p) => p.attendanceStatus === "galleta").map((p) => p.name), [
    "Mella",
    "Mario Quintana",
    "Jonathan",
  ]);
  assert.deepEqual(result.players.filter((p) => p.attendanceStatus === "banca").map((p) => p.name), [
    "Eduardo Loaiza",
  ]);
  assert.deepEqual(result.players.filter((p) => p.attendanceStatus === "out").map((p) => p.name), ["Cooper", "Daniel Nettle"]);

  // Verificar secuencias independientes
  const galletas = result.players.filter((p) => p.attendanceStatus === "galleta");
  assert.equal(galletas[0].whatsappOrder, 1);
  assert.equal(galletas[1].whatsappOrder, 2);
  assert.equal(galletas[2].whatsappOrder, 3);
  const banca = result.players.filter((p) => p.attendanceStatus === "banca");
  assert.equal(banca[0].whatsappOrder, 1);
});

test("matchSummaryMessage renders categorized waiting lists with cookie emoji", () => {
  const parsed = parseWhatsAppList(`22 Septiembre 21 horas\nClub Sordos:\nJugadores Oficiales:\n1- Marcio\nLista de Espera de Galletas:\n1- Mella\nBanca:\n1- Eduardo Loaiza`);
  const text = matchSummaryMessage({
    id: "match-categories", date: parsed.match.date, time: parsed.match.time, location: parsed.match.location,
    status: "confirmed", totalCost: 0, weekLabel: "", monthKey: "2026-09", courtCost: 0, courtPrepaid: false,
    notes: "", matchFormat: "clasico", createdAt: "", updatedAt: "",
  }, parsed.players.map((player, index) => ({ ...player, id: `row-${index}`, matchId: "match-categories", createdAt: "", updatedAt: "" })), [], []);

  assert.match(text, /\*Jugadores \(1\/12\)\*\n 1 · Marcio/);
  assert.match(text, /🍪 \*Galletas abiertas\*\n1 · Mella 🍪/);
  assert.match(text, /🪑 \*Banca\*\n1 · Eduardo Loaiza/);
});

test("matchSummaryMessage keeps overflow officials in Banca", () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({
    id: `row-${index + 1}`,
    matchId: "match-overflow",
    name: `Jugador ${index + 1}`,
    phone: "",
    attendanceStatus: "confirmed" as const,
    paymentStatus: "unpaid" as const,
    amountDue: 5000,
    amountPaid: 0,
    note: "",
    team: "none" as const,
    whatsappOrder: index + 1,
    goals: 0,
    createdAt: "",
    updatedAt: "",
  }));
  const text = matchSummaryMessage({
    id: "match-overflow", date: "2026-09-22", time: "21:00", location: "Club Sordos",
    status: "confirmed", totalCost: 35000, weekLabel: "", monthKey: "2026-09", courtCost: 0,
    courtPrepaid: false, notes: "", matchFormat: "clasico", squadTarget: 12, createdAt: "", updatedAt: "",
  }, rows, [], []);
  assert.match(text, /12 · Jugador 12/);
  assert.match(text, /🪑 \*Banca\*\n1 · Jugador 13\n2 · Jugador 14/);
});

test("cleanPlayerName strips emojis, symbols and text in parentheses", () => {
  assert.equal(cleanPlayerName("✅ Marcio (pagado)"), "Marcio");
  assert.equal(cleanPlayerName("🍪 Jonathan (Abierto · puede completar el cupo)"), "Jonathan");
  assert.equal(cleanPlayerName("Juanjo 🍪"), "Juanjo");
  assert.equal(cleanPlayerName("· Marcelo Calderon [mensual]"), "Marcelo Calderon");
  assert.equal(cleanPlayerName("⭐ Diego G. (paga mañana) ✅"), "Diego G.");
});

test("parseWhatsAppList handles 🍪 before or after player name as galleta status", () => {
  const input = `Martes 29/09 21:00 hrs
Club Sordos

Jugadores:
1- Marcio
🍪 1- Jonathan (Abierto · puede completar el cupo)
2- Juanjo 🍪
3- Marcelo V 🍪`;

  const result = parseWhatsAppList(input);
  assert.equal(result.players[0].name, "Marcio");
  assert.equal(result.players[0].attendanceStatus, "confirmed");

  const galletas = result.players.filter((p) => p.attendanceStatus === "galleta");
  assert.equal(galletas.length, 3);
  assert.equal(galletas[0].name, "Jonathan");
  assert.equal(galletas[1].name, "Juanjo");
  assert.equal(galletas[2].name, "Marcelo V");
});

test("parseWhatsAppList parses dates in format 'Martes 29/09' and '29/09'", () => {
  const currentYear = new Date().getFullYear();

  const res1 = parseWhatsAppList(`Martes 29/09 21:00 hrs\nClub Sordos\n1- Marcio`);
  assert.equal(res1.match.date, `${currentYear}-09-29`);
  assert.equal(res1.match.time, "21:00");

  const res2 = parseWhatsAppList(`29/09 21 hrs\n1- Marcio`);
  assert.equal(res2.match.date, `${currentYear}-09-29`);
  assert.equal(res2.match.time, "21:00");

  const res3 = parseWhatsAppList(`Martes 29 Septiembre · 🕘 21:00 hrs\nClub Sordos\n1- Marcio`);
  assert.equal(res3.match.date, `${currentYear}-09-29`);
  assert.equal(res3.match.time, "21:00");
});

test("parseWhatsAppList prevents duplicate player rows in the same match", () => {
  const input = `Martes 29/09 21:00 hrs
1- Marcelo Calderon
2- Marcio
3- Marcelo Calderon
4- Marcio (pagado)`;

  const result = parseWhatsAppList(input);
  assert.equal(result.players.length, 2);
  assert.deepEqual(
    result.players.map((p) => p.name),
    ["Marcelo Calderon", "Marcio"],
  );
});

test("parseWhatsAppList detects 7x7 format and sets squadTarget to 14", () => {
  const input = `Fútbol 7x7 · Martes 29/09 21:00 hrs
Club Sordos
1- Marcio`;

  const result = parseWhatsAppList(input);
  assert.equal(result.match.matchFormat, "7x7");
  assert.equal(result.match.squadTarget, 14);

  const text = matchSummaryMessage(
    {
      id: "match-7x7",
      date: result.match.date,
      time: result.match.time,
      location: result.match.location,
      status: "confirmed",
      totalCost: 0,
      weekLabel: "",
      monthKey: "2026-09",
      courtCost: 0,
      courtPrepaid: false,
      notes: "",
      matchFormat: "7x7",
      squadTarget: 14,
      createdAt: "",
      updatedAt: "",
    },
    result.players.map((p, i) => ({ ...p, id: `row-${i}`, matchId: "match-7x7", createdAt: "", updatedAt: "" })),
    [],
    [],
  );

  assert.match(text, /\*Jugadores \(1\/14\)\*/);
  assert.match(text, /14 · $/m);
});

test("summarizeMatch maintains consistency between unpaidCount and pendingAmount with galletas", () => {
  const players: MatchPlayer[] = [
    {
      id: "row-1",
      matchId: "m1",
      name: "Marcio",
      phone: "",
      attendanceStatus: "confirmed",
      paymentStatus: "paid",
      amountDue: 4000,
      amountPaid: 4000,
      note: "",
      team: "none",
      whatsappOrder: 1,
      goals: 0,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "row-2",
      matchId: "m1",
      name: "Jonathan",
      phone: "",
      attendanceStatus: "galleta",
      paymentStatus: "unpaid",
      amountDue: 4000,
      amountPaid: 0,
      note: "Galleta abierta",
      team: "none",
      whatsappOrder: 1,
      goals: 0,
      createdAt: "",
      updatedAt: "",
    },
  ];

  const summary = summarizeMatch(players);
  assert.equal(summary.pendingAmount, 4000);
  // unpaidCount debe ser > 0 cuando pendingAmount > 0
  assert.equal(summary.unpaidCount, 1);
  assert.equal(summary.paidCount, 1);
  assert.equal(summary.confirmedCount, 1);
});
