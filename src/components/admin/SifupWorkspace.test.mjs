import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('./SifupWorkspace.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(`${source}\nexport { buildRankedTeamRows, applyBalancedTeams, NewMatchTeamSuggestion };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)((name) => {
  if (name === '@/lib/store') return require('../../lib/store.ts');
  if (name.startsWith('react')) return require(name);
  return {};
}, loaded, loaded.exports);
const { buildRankedTeamRows, applyBalancedTeams, NewMatchTeamSuggestion } = loaded.exports;

function fixture(keepers = []) {
  const players = Array.from({ length: 14 }, (_, i) => ({
    id: `player-${i}`, name: `Jugador ${i + 1}`, nickname: '', isGoalkeeper: keepers.includes(i),
  }));
  const rows = players.map((player, i) => ({
    id: `row-${i}`, playerId: player.id, name: player.name, whatsappOrder: i + 1,
    attendanceStatus: 'confirmed', team: 'none', amountPaid: i * 100,
  }));
  const standings = new Map(players.map((player, i) => [player.id, { rank: i + 1, points: 28 - i * 2 }]));
  return { players, rows, standings };
}

for (const keepers of [[], [13], [12, 13]]) {
  test(`browser balances 14 players with ${keepers.length} keepers in a single ranked pass`, () => {
    const { players, rows, standings } = fixture(keepers);
    const before = structuredClone({ players, rows, standings });
    const expectedOrder = keepers.length ? [...keepers, ...players.map((_, i) => i).filter(i => !keepers.includes(i))] : players.map((_, i) => i);
    const ranked = buildRankedTeamRows(rows, players, standings);
    assert.deepEqual(ranked.map(item => item.row.playerId), expectedOrder.map(i => `player-${i}`));
    assert.deepEqual(ranked.filter(item => item.suggestedTeam === 'A').map(item => ranked.indexOf(item) + 1), [1, 4, 5, 8, 9, 12, 13]);
    assert.deepEqual(ranked.filter(item => item.suggestedTeam === 'B').map(item => ranked.indexOf(item) + 1), [2, 3, 6, 7, 10, 11, 14]);
    const result = applyBalancedTeams(rows, players, standings);
    assert.equal(result.filter(row => row.team === 'A').length, 7);
    assert.equal(result.filter(row => row.team === 'B').length, 7);
    for (const item of ranked) assert.equal(result[item.index].team, item.suggestedTeam);
    assert.deepEqual(result.map((row, i) => ({ ...row, team: rows[i].team })), rows);
    assert.deepEqual({ players, rows, standings }, before);
    assert.deepEqual(applyBalancedTeams(result, players, standings), result);
  });
}

test('unranked keeper uses zero base points; bench and out never enter the draw', () => {
  const { players, rows, standings } = fixture([13]);
  standings.delete('player-13');
  rows[13].playerId = undefined;
  rows.push({ ...rows[0], id: 'bench', attendanceStatus: 'waitlist' }, { ...rows[1], id: 'out', attendanceStatus: 'out' });
  const ranked = buildRankedTeamRows(rows, players, standings);
  assert.equal(ranked[0].row.id, 'row-13');
  assert.equal(ranked.length, 14);
  assert.deepEqual(applyBalancedTeams(rows, players, standings).slice(-2).map(row => row.team), ['none', 'none']);
});

test('keeper bonus adds exactly 100 points and preserves ranking tiebreaks', () => {
  const { players, rows, standings } = fixture([13]);
  standings.set('player-0', { rank: 1, points: 150 });
  standings.set('player-1', { rank: 2, points: 100 });
  standings.set('player-13', { rank: 14, points: 0 });
  assert.deepEqual(buildRankedTeamRows(rows, players, standings).slice(0, 3).map(item => item.row.playerId), ['player-0', 'player-1', 'player-13']);
});

test('review displays draw positions and the keeper bonus without changing historical points', () => {
  const props = fixture([13]);
  const html = renderToStaticMarkup(NewMatchTeamSuggestion(props));
  assert.match(html, /#1 - Rojo/);
  assert.match(html, /2 \+ 100 pts para reparto/);
  assert.ok(html.indexOf('Jugador 14') < html.indexOf('Jugador 1<'));
  assert.equal(props.standings.get('player-13').points, 2);
});
