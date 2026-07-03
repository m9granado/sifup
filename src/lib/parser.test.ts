import assert from "node:assert/strict";
import test from "node:test";
import { parseWhatsAppList } from "./parser";

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

