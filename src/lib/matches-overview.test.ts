import assert from "node:assert/strict";
import test from "node:test";
import { matchesOverview } from "./matches-overview";
import type { Match } from "./types";
const match = (id: string, date: string, status: Match["status"]): Match => ({ id, date, status, time: "21:00" } as Match);
test("one next card, next and last active months open, complete history once", () => {
  const matches = [match("old", "2026-08-18", "played"), match("last", "2026-10-27", "played"), match("suspended", "2026-11-02", "suspended"), match("next", "2026-11-03", "roster_locked"), match("later", "2026-11-10", "confirmed")];
  const before = structuredClone(matches);
  const view = matchesOverview(matches, "2026-10-29");
  assert.equal(view.next?.id, "next");
  assert.deepEqual(view.months.map(group => [group.key, group.open]), [["2026-11",true],["2026-10",true],["2026-08",false]]);
  const ids = [view.next!.id, ...view.months.flatMap(group => group.matches.map(item => item.id))];
  assert.deepEqual(ids.sort(), matches.map(item => item.id).sort());
  assert.equal(new Set(ids).size, matches.length);
  assert.deepEqual(matches,before);
});
test("empty or completed-only history never invents a next match", () => {
  assert.equal(matchesOverview([], "2026-10-29").next, undefined);
  const view = matchesOverview([match("played", "2026-11-03", "played"),match("suspended", "2026-11-10", "suspended")], "2026-10-29");
  assert.equal(view.next,undefined);
  assert.equal(view.months[0].matches.length,2);
});
