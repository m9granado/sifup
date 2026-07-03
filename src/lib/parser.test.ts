import assert from "node:assert/strict";
import test from "node:test";
import { parseWhatsAppList } from "./parser";
import { matchSummaryMessage } from "./whatsapp";

const realMessage = `martes 7 julio: 21 hrs, anotarse en lista:

* Victor
* Alonso
* Caldera
* Mario Quintana Kamassu
* Marcio

No pueden:
* Mantelli
* Cooper`;

test("parseWhatsAppList parses bullets and no pueden section", () => {
  const result = parseWhatsAppList(realMessage, 3500);

  assert.deepEqual(result.errors, []);
  assert.equal(result.match.date, "2026-07-07");
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
  assert.equal(result.players[0].whatsappOrder, 1);
  assert.equal(result.players[6].whatsappOrder, 7);
  assert.equal(result.players[5].amountDue, 0);
});

test("matchSummaryMessage renders ordered call-up with 12 minimum slots", () => {
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
  );

  assert.match(text, /Partidos 07 Julio 21 horas/);
  assert.match(text, /Club de los Sordos:/);
  assert.match(text, /1- Victor/);
  assert.match(text, /5- Marcio/);
  assert.match(text, /12- $/m);
  assert.match(text, /No pueden\n- Mantelli\n- Cooper/);
  assert.match(text, /https:\/\/sifup\.vercel\.app\/m\/0707$/);
});
