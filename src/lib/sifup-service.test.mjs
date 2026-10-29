import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

const repo = process.env.SIFUP_REPO_ROOT || path.resolve(testDirectory, '../..');
const serviceFile = process.env.SIFUP_SERVICE_UNDER_TEST || path.join(repo, 'src/lib/sifup-service.ts');
const serviceRequire = createRequire(path.join(repo, 'src/lib/sifup-service.ts'));
const ts = serviceRequire('typescript');
const compiled = ts.transpileModule(fs.readFileSync(serviceFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture() {
  const match = { id: 'test-match', date: '2026-10-06', time: '21:00', location: 'Test', monthKey: '2026-10', status: 'confirmed', weekLabel: 'Test', courtCost: 35000, courtPrepaid: true, totalCost: 35000, notes: '', matchFormat: 'clasico', squadTarget: 12 };
  const players = [
    { id: 'monthly', name: 'Mensual Test', nickname: 'Mensual', paymentPlan: 'perMatch', active: true },
    { id: 'guest', name: 'Galleta Test', nickname: 'Galleta', paymentPlan: 'perMatch', active: true },
  ];
  const data = { matches: [match], players, matchPlayers: [], results: [], monthlyPayments: [{ id: 'monthly-fee', playerId: 'monthly', monthKey: '2026-10', paymentStatus: 'paid', expectedAmount: 20000, amountPaid: 20000 }] };
  const repository = {
    getSifupData: async () => structuredClone(data),
    savePlayer: async (player) => {
      const idx = data.players.findIndex((item) => item.id === player.id);
      if (idx >= 0) data.players[idx] = structuredClone(player);
      else data.players.push(structuredClone(player));
    },
    saveMatchPlayers: async (matchId, rows) => {
      assert.equal(matchId, match.id);
      data.matchPlayers = structuredClone(rows);
    },
    saveMatchWithPlayers: async (newMatch, rows) => {
      const idx = data.matches.findIndex((item) => item.id === newMatch.id);
      if (idx >= 0) data.matches[idx] = structuredClone(newMatch);
      else data.matches = [structuredClone(newMatch), ...data.matches];
      data.matchPlayers = structuredClone(rows);
    },
  };
  const fixtureModule = { exports: {} };
  const run = vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: serviceFile });
  // Load the real pure TypeScript dependencies; repository and cache stay isolated.
  const previousTsLoader = serviceRequire.extensions['.ts'];
  serviceRequire.extensions['.ts'] = (loaded, filename) => loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  try {
  run((name) => {
    if (name === 'server-only') return {};
    if (name === 'next/cache') return { revalidatePath() {} };
    if (name === './repository') return repository;
    return serviceRequire(name);
  }, fixtureModule, fixtureModule.exports);
  } finally {
    if (previousTsLoader) serviceRequire.extensions['.ts'] = previousTsLoader;
    else delete serviceRequire.extensions['.ts'];
  }
  return { data, service: fixtureModule.exports, matchId: match.id, repository };
}

test('monthly additions remain free, including explicit per-match tariff and repeated calls', async () => {
  const { data, service, matchId } = fixture();
  const input = { matchId, name: 'Mensual Test', attendanceStatus: 'confirmed', amountDue: 5000 };
  await service.addPlayerToMatch(input);
  const id = data.matchPlayers[0].id;
  await service.addPlayerToMatch(input);
  assert.equal(data.matchPlayers.length, 1);
  assert.equal(data.matchPlayers[0].id, id);
  assert.equal(data.matchPlayers[0].amountDue, 0);
  assert.equal(data.matchPlayers[0].paymentStatus, 'paid');
  assert.equal(data.monthlyPayments[0].amountPaid, 20000);
});

test('monthly existing rows lose stale debt on either incremental tool without touching others', async () => {
  for (const method of ['addPlayerToMatch', 'updateMatchPlayer']) {
    const { data, service, matchId } = fixture();
    await service.addPlayerToMatch({ matchId, name: 'Mensual Test' });
    await service.addPlayerToMatch({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed' });
    const other = structuredClone(data.matchPlayers[1]);
    Object.assign(data.matchPlayers[0], { amountDue: 5000, paymentStatus: 'unpaid', team: 'A', note: 'manual' });
    await service[method]({ matchId, name: 'Mensual Test', attendanceStatus: 'confirmed' });
    assert.equal(data.matchPlayers[0].amountDue, 0, method);
    assert.equal(data.matchPlayers[0].paymentStatus, 'paid', method);
    assert.equal(data.matchPlayers[0].team, 'A');
    assert.equal(data.matchPlayers[0].note, 'manual');
    assert.deepEqual(data.matchPlayers[1], other);
    assert.equal(data.matchPlayers.length, 2);
  }
});

test('monthly edits cannot create a second charge or invent a per-match payment', async () => {
  const { data, service, matchId } = fixture();
  await service.addPlayerToMatch({ matchId, name: 'Mensual Test' });
  for (let i = 0; i < 2; i++) {
    await service.updateMatchPlayer({ matchId, name: 'Mensual Test', attendanceStatus: 'confirmed', amountDue: 5000, paymentStatus: 'unpaid' });
  }
  assert.equal(data.matchPlayers.length, 1);
  assert.equal(data.matchPlayers[0].amountDue, 0);
  assert.equal(data.matchPlayers[0].amountPaid, 0);
  assert.equal(data.matchPlayers[0].paymentStatus, 'paid');
  assert.equal(data.monthlyPayments[0].amountPaid, 20000);
});

test('monthly normalization preserves an actual prior payment', async () => {
  const { data, service, matchId } = fixture();
  await service.addPlayerToMatch({ matchId, name: 'Mensual Test' });
  data.matchPlayers[0].amountPaid = 2500;
  await service.updateMatchPlayer({ matchId, name: 'Mensual Test', amountDue: 5000 });
  assert.equal(data.matchPlayers[0].amountDue, 0);
  assert.equal(data.matchPlayers[0].amountPaid, 2500);
});

test('confirmed guests owe 5000 once; paid amounts and teams survive repeated calls', async () => {
  const { data, service, matchId } = fixture();
  const input = { matchId, name: 'Galleta Test', attendanceStatus: 'confirmed' };
  await service.addPlayerToMatch(input);
  Object.assign(data.matchPlayers[0], { amountPaid: 5000, paymentStatus: 'paid', team: 'B' });
  const id = data.matchPlayers[0].id;
  await service.addPlayerToMatch(input);
  await service.updateMatchPlayer(input);
  assert.equal(data.matchPlayers.length, 1);
  assert.equal(data.matchPlayers[0].id, id);
  assert.equal(data.matchPlayers[0].amountDue, 5000);
  assert.equal(data.matchPlayers[0].amountPaid, 5000);
  assert.equal(data.matchPlayers[0].paymentStatus, 'paid');
  assert.equal(data.matchPlayers[0].team, 'B');
});

test('guest promotion from a free reserve uses 5000; an explicit free amount is respected', async () => {
  const { data, service, matchId } = fixture();
  await service.addPlayerToMatch({ matchId, name: 'Galleta Test', attendanceStatus: 'galleta', amountDue: 0 });
  await service.updateMatchPlayer({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed' });
  assert.equal(data.matchPlayers[0].amountDue, 5000);
  await service.updateMatchPlayer({ matchId, name: 'Galleta Test', amountDue: 0 });
  assert.equal(data.matchPlayers[0].amountDue, 0);
});

test('add_player_to_match reprices an out guest with a prior payment back to confirmed exactly like update_match_player: 5000 when omitted (payment kept, same id, retry stable), 0 when explicit, 3500 when explicit (retry preserves it)', async () => {
  for (const method of ['addPlayerToMatch', 'updateMatchPlayer']) {
    const { data, service, matchId } = fixture();
    await service.addPlayerToMatch({ matchId, name: 'Galleta Test', attendanceStatus: 'out' });
    Object.assign(data.matchPlayers[0], { amountPaid: 2000 });
    const rowId = data.matchPlayers[0].id;

    await service[method]({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed' });
    assert.equal(data.matchPlayers.length, 1, method);
    assert.equal(data.matchPlayers[0].id, rowId, method);
    assert.equal(data.matchPlayers[0].amountDue, 5000, method);
    assert.equal(data.matchPlayers[0].amountPaid, 2000, method);
    assert.equal(data.matchPlayers[0].paymentStatus, 'unpaid', method);

    await service[method]({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed' });
    assert.equal(data.matchPlayers.length, 1, method);
    assert.equal(data.matchPlayers[0].id, rowId, method);
    assert.equal(data.matchPlayers[0].amountDue, 5000, method);

    await service[method]({ matchId, name: 'Galleta Test', amountDue: 0 });
    assert.equal(data.matchPlayers[0].amountDue, 0, method);

    await service[method]({ matchId, name: 'Galleta Test', amountDue: 3500 });
    assert.equal(data.matchPlayers[0].amountDue, 3500, method);
    await service[method]({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed', amountDue: 3500 });
    assert.equal(data.matchPlayers.length, 1, method);
    assert.equal(data.matchPlayers[0].id, rowId, method);
    assert.equal(data.matchPlayers[0].amountDue, 3500, method);
  }
});

test('monthly membership applies only to the match month; paid monthly fallback is not fabricated', async () => {
  const { data, service, matchId } = fixture();
  data.monthlyPayments[0].monthKey = '2026-09';
  await service.addPlayerToMatch({ matchId, name: 'Mensual Test', attendanceStatus: 'confirmed' });
  assert.equal(data.matchPlayers[0].amountDue, 5000);
  assert.equal(data.players[0].paymentPlan, 'perMatch');
});

test('add_player_to_match: monthly players always owe 0 whether amountDue is omitted, zero, or a forced positive value', async () => {
  for (const amountDue of [undefined, 0, 5000, 12345]) {
    const { data, service, matchId } = fixture();
    const input = { matchId, name: 'Mensual Test', attendanceStatus: 'confirmed' };
    if (amountDue !== undefined) input.amountDue = amountDue;
    await service.addPlayerToMatch(input);
    assert.equal(data.matchPlayers[0].amountDue, 0, `amountDue input ${amountDue}`);
    assert.equal(data.matchPlayers[0].paymentStatus, 'paid', `amountDue input ${amountDue}`);
  }
});

test('add_player_to_match: a guest with an unresolved roster-unpaid monthly entry is still charged 0 (roster membership, not payment status, drives it)', async () => {
  const { data, service, matchId } = fixture();
  data.monthlyPayments[0].paymentStatus = 'unpaid';
  data.monthlyPayments[0].amountPaid = 0;
  await service.addPlayerToMatch({ matchId, name: 'Mensual Test', attendanceStatus: 'confirmed' });
  assert.equal(data.matchPlayers[0].amountDue, 0);
  assert.equal(data.matchPlayers[0].paymentStatus, 'paid');
});

test('add_player_to_match and update_match_player reject negative, fractional, NaN, and Infinity amountDue before persisting anything', async () => {
  for (const bad of [-1, 2.5, NaN, Infinity, -Infinity]) {
    const { data, service, matchId } = fixture();
    await assert.rejects(() => service.addPlayerToMatch({ matchId, name: 'Galleta Test', amountDue: bad }), `addPlayerToMatch amountDue=${bad}`);
    assert.equal(data.matchPlayers.length, 0, `addPlayerToMatch amountDue=${bad} must not write`);

    await service.addPlayerToMatch({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed' });
    await assert.rejects(() => service.updateMatchPlayer({ matchId, name: 'Galleta Test', amountDue: bad }), `updateMatchPlayer amountDue=${bad}`);
    await assert.rejects(() => service.updateMatchPlayer({ matchId, name: 'Galleta Test', amountPaid: bad }), `updateMatchPlayer amountPaid=${bad}`);
    assert.equal(data.matchPlayers[0].amountDue, 5000, `amountDue=${bad} must leave the row untouched`);
  }
});

test('add_player_to_match transitioning an already-listed guest to "out" clears debt/team but preserves a real prior payment, matches update_match_player, and survives retries', async () => {
  for (const method of ['addPlayerToMatch', 'updateMatchPlayer']) {
    const { data, service, matchId } = fixture();
    await service.addPlayerToMatch({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed', team: 'A' });
    Object.assign(data.matchPlayers[0], { amountPaid: 2000 });
    await service[method]({ matchId, name: 'Galleta Test', attendanceStatus: 'out' });
    await service[method]({ matchId, name: 'Galleta Test', attendanceStatus: 'out' });
    const row = data.matchPlayers[0];
    assert.equal(row.amountDue, 0, method);
    assert.equal(row.amountPaid, 2000, method);
    assert.equal(row.team, 'none', method);
    assert.equal(row.paymentStatus, 'paid', method);
    assert.equal(row.note, 'No puede', method);
  }
});

test('add_player_to_match: retrying via a nickname alias resolves to the same existing player and row instead of duplicating it', async () => {
  const { data, service, matchId } = fixture();
  await service.addPlayerToMatch({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed' });
  const rowId = data.matchPlayers[0].id;
  const playerId = data.matchPlayers[0].playerId;
  await service.addPlayerToMatch({ matchId, name: 'Galleta', attendanceStatus: 'confirmed' });
  assert.equal(data.matchPlayers.length, 1);
  assert.equal(data.matchPlayers[0].id, rowId);
  assert.equal(data.matchPlayers[0].playerId, playerId);
});

test('add_player_to_match: a new guest row rejects invalid amountDue at the service boundary even when the player would be monthly', async () => {
  const { data, service, matchId } = fixture();
  await assert.rejects(() => service.addPlayerToMatch({ matchId, name: 'Mensual Test', amountDue: -5000 }));
  assert.equal(data.matchPlayers.length, 0);
});

test('resolveMatch: an unknown matchId never falls back to the next match for reads or writes', async () => {
  const { service, matchId } = fixture();
  await assert.rejects(() => service.addPlayerToMatch({ matchId: `${matchId}-does-not-exist`, name: 'Galleta Test' }));
  await assert.rejects(() => service.getNextMatchSummary({ matchId: `${matchId}-does-not-exist` }));
});

test('find_player exposes effectivePaymentPlan/monthKey driven by the roster for an explicit matchId, date, or monthKey, and never silently resolves an unknown matchId', async () => {
  const { service, matchId } = fixture();

  const byMatchId = await service.findPlayer({ query: 'Mensual', matchId });
  assert.equal(byMatchId.effectiveContext.monthKey, '2026-10');
  assert.equal(byMatchId.matches[0].effectivePaymentPlan, 'monthly');
  assert.equal(byMatchId.matches[0].effectiveSource, 'roster');

  const byDate = await service.findPlayer({ query: 'Mensual', date: '2026-10-06' });
  assert.equal(byDate.effectiveContext.monthKey, '2026-10');
  assert.equal(byDate.matches[0].effectivePaymentPlan, 'monthly');

  // Another month with no roster snapshot at all: falls back to the player's global
  // paymentPlan, which the fixture sets to 'perMatch' for both players.
  const otherMonth = await service.findPlayer({ query: 'Mensual', monthKey: '2026-09' });
  assert.equal(otherMonth.matches[0].effectivePaymentPlan, 'perMatch');
  assert.equal(otherMonth.matches[0].effectiveSource, 'global');

  await assert.rejects(() => service.findPlayer({ query: 'Mensual', matchId: `${matchId}-does-not-exist` }));
  await assert.rejects(() => service.findPlayer({ query: 'Mensual', date: 'not-a-date' }));
  await assert.rejects(() => service.findPlayer({ query: 'Mensual', monthKey: 'not-a-month' }));
  // Calendar roundtrip, not just a digit-shaped regex: Feb 30 and month 13 don't exist.
  await assert.rejects(() => service.findPlayer({ query: 'Mensual', date: '2026-02-30' }));
  await assert.rejects(() => service.findPlayer({ query: 'Mensual', date: '2026-13-01' }));
  await assert.rejects(() => service.findPlayer({ query: 'Mensual', monthKey: '2026-99' }));
  await assert.rejects(() => service.findPlayer({ query: 'Mensual', monthKey: '2026-00' }));
});

test('find_player and the match summary payload agree on effectivePaymentPlan for the same player and month', async () => {
  const { service, matchId } = fixture();
  await service.addPlayerToMatch({ matchId, name: 'Mensual Test', attendanceStatus: 'confirmed' });

  const summary = await service.getNextMatchSummary({ matchId });
  const rowInSummary = summary.players.all.find((row) => row.name === 'Mensual Test');
  const found = await service.findPlayer({ query: 'Mensual', matchId });

  assert.equal(rowInSummary.effectivePaymentPlan, 'monthly');
  assert.equal(found.matches[0].effectivePaymentPlan, 'monthly');
});

test('a stored match.monthKey desynced from match.date is normalized from date everywhere: add/update/find/summary all see the October roster', async () => {
  const { data, service, matchId } = fixture();
  // Simulate stale/corrupted storage: date stays 2026-10-06 (October roster has
  // the monthly player), but the stored monthKey wrongly says September.
  data.matches[0].monthKey = '2026-09';

  await service.addPlayerToMatch({ matchId, name: 'Mensual Test', attendanceStatus: 'confirmed' });
  assert.equal(data.matchPlayers[0].amountDue, 0, 'addPlayerToMatch must follow the date-derived month');

  await service.updateMatchPlayer({ matchId, name: 'Mensual Test', amountDue: 5000, attendanceStatus: 'confirmed' });
  assert.equal(data.matchPlayers[0].amountDue, 0, 'updateMatchPlayer must follow the date-derived month too');

  const found = await service.findPlayer({ query: 'Mensual', matchId });
  assert.equal(found.effectiveContext.monthKey, '2026-10');
  assert.equal(found.matches[0].effectivePaymentPlan, 'monthly');

  const summary = await service.getNextMatchSummary({ matchId });
  assert.equal(summary.match.monthKey, '2026-10', 'the summary payload must expose the normalized monthKey');
  const rowInSummary = summary.players.all.find((row) => row.name === 'Mensual Test');
  assert.equal(rowInSummary.effectivePaymentPlan, 'monthly');
});

test('setMonthlyRoster and registerMonthlyPayment reject a malformed monthKey (wrong separator or out-of-range month) instead of writing', async () => {
  const { data, service } = fixture();
  await assert.rejects(() => service.setMonthlyRoster({ name: 'Galleta Test', monthly: true, monthKey: '2026/10' }));
  await assert.rejects(() => service.setMonthlyRoster({ name: 'Galleta Test', monthly: true, monthKey: '2026-99' }));
  await assert.rejects(() => service.setMonthlyRoster({ name: 'Galleta Test', monthly: true, monthKey: '2026-00' }));
  assert.equal(data.monthlyPayments.length, 1);
  await assert.rejects(() => service.registerMonthlyPayment({ name: 'Mensual Test', monthKey: 'bogus' }));
});

test('assertValidAmount rejects values above Number.MAX_SAFE_INTEGER', async () => {
  const { data, service, matchId } = fixture();
  await assert.rejects(() => service.addPlayerToMatch({ matchId, name: 'Galleta Test', amountDue: Number.MAX_SAFE_INTEGER + 2 }));
  assert.equal(data.matchPlayers.length, 0);
});

test('MCP contract: add_player_to_match.amountDue is a real zod schema — optional, 0 and positive allowed, negative/fractional/non-finite rejected, JSON schema has minimum:0 with no exclusiveMinimum', async () => {
  const routeFile = path.join(repo, 'src/app/mcp/route.ts');
  const routeCompiled = ts.transpileModule(fs.readFileSync(routeFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // createServer() isn't exported by route.ts; expose it only inside this compiled
  // in-memory copy (the real file on disk is never touched).
  const patchedRouteCompiled = `${routeCompiled}\nif (typeof createServer === "function") { exports.__createServerForTest = createServer; }\n`;

  class FakeMcpServer {
    constructor(opts) { this.opts = opts; this.tools = new Map(); }
    registerTool(name, config, handler) { this.tools.set(name, { config, handler }); }
  }
  class FakeTransport {}
  const noopToolStub = new Proxy({}, { get: () => async () => ({}) });

  const routeModule = { exports: {} };
  const runRoute = vm.runInThisContext(`(function(require,module,exports){${patchedRouteCompiled}\n})`, { filename: routeFile });
  runRoute((name) => {
    if (name === '@modelcontextprotocol/sdk/server/mcp.js') return { McpServer: FakeMcpServer };
    if (name === '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js') return { WebStandardStreamableHTTPServerTransport: FakeTransport };
    if (name === 'zod') return serviceRequire('zod');
    if (name === '@/lib/sifup-service' || name === '@/lib/court-payment-service') return noopToolStub;
    if (name === '@/lib/sifup-constants') return { PER_MATCH_AMOUNT: 5000, PUBLIC_BASE_URL: 'https://example.test' };
    if (name === '@/lib/oauth-policy') return { buildResourceMetadataChallenge: () => '' };
    return serviceRequire(name);
  }, routeModule, routeModule.exports);

  const createServerForTest = routeModule.exports.__createServerForTest;
  assert.equal(typeof createServerForTest, 'function');
  const server = createServerForTest();
  const tool = server.tools.get('add_player_to_match');
  assert.ok(tool, 'add_player_to_match must be registered');

  const amountDueSchema = tool.config.inputSchema.amountDue;
  assert.equal(amountDueSchema.safeParse(undefined).success, true);
  assert.equal(amountDueSchema.safeParse(0).success, true);
  assert.equal(amountDueSchema.safeParse(5000).success, true);
  assert.equal(amountDueSchema.safeParse(-1).success, false);
  assert.equal(amountDueSchema.safeParse(2.5).success, false);
  assert.equal(amountDueSchema.safeParse(NaN).success, false);
  assert.equal(amountDueSchema.safeParse(Infinity).success, false);

  const { z } = serviceRequire('zod');
  const jsonSchema = z.toJSONSchema(amountDueSchema.unwrap());
  assert.equal(jsonSchema.minimum, 0);
  assert.equal('exclusiveMinimum' in jsonSchema, false);

  const provisionalGuestSchema = tool.config.inputSchema.provisionalGuest;
  assert.ok(provisionalGuestSchema, 'provisionalGuest must be registered');
  assert.equal(provisionalGuestSchema.safeParse(undefined).success, true);
  assert.equal(provisionalGuestSchema.safeParse(true).success, true);
  assert.equal(provisionalGuestSchema.safeParse(false).success, true);
  assert.equal(provisionalGuestSchema.safeParse('true').success, false);
  assert.equal(provisionalGuestSchema.safeParse(1).success, false);
  assert.equal(typeof provisionalGuestSchema.description, 'string');
  assert.ok(provisionalGuestSchema.description.length > 0);

  // Test exact resolution: provisionalGuest exact resolution does not match Cooper and is distinct from Hans.
  const playersForFuzzyCheck = [
    { id: 'player-cooper', name: 'Cooper', nickname: 'Cooper', paymentPlan: 'perMatch', active: true },
    { id: 'player-hans', name: 'Hans', nickname: 'Hans', paymentPlan: 'perMatch', active: true },
  ];
  const { service } = fixture();
  const exactCooperMatch = playersForFuzzyCheck.filter((p) => service.normalizeName(p.name) === service.normalizeName('H galleta cooper'));
  assert.equal(exactCooperMatch.length, 0, 'Exact normalized name must not match Cooper');
  const exactHansMatch = playersForFuzzyCheck.filter((p) => service.normalizeName(p.name) === service.normalizeName('H galleta cooper'));
  assert.equal(exactHansMatch.length, 0, 'Exact normalized name must not match Hans');
});

test('UI helper isMonthlyMatchRow (extracted from the real SifupWorkspace.tsx source, no React loaded): roster is canonical for known players; a stale "mensualidad" note only applies to unresolved rows', async () => {
  const workspaceFile = path.join(repo, 'src/components/admin/SifupWorkspace.tsx');
  const workspaceSource = fs.readFileSync(workspaceFile, 'utf8');

  function extractFunctionSource(source, name) {
    const marker = `function ${name}`;
    const start = source.indexOf(marker);
    if (start === -1) throw new Error(`function ${name} not found in ${workspaceFile}`);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    return source.slice(start, i);
  }

  const factorySource = `
    function __createIsMonthlyMatchRowForTest(findKnownPlayer, isPlayerMonthlyForMonth) {
      ${extractFunctionSource(workspaceSource, 'playerForMatchRow')}
      ${extractFunctionSource(workspaceSource, 'isMonthlyMatchRow')}
      return isMonthlyMatchRow;
    }
    module.exports.__createIsMonthlyMatchRowForTest = __createIsMonthlyMatchRowForTest;
  `;
  const compiledFactory = ts.transpileModule(factorySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const factoryModule = { exports: {} };
  const runFactory = vm.runInThisContext(`(function(require,module,exports){${compiledFactory}\n})`, { filename: workspaceFile });
  runFactory(() => ({}), factoryModule, factoryModule.exports);

  const { service } = fixture();
  const previousTsLoader = serviceRequire.extensions['.ts'];
  serviceRequire.extensions['.ts'] = (loaded, filename) => loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  let isPlayerMonthlyForMonth;
  try {
    isPlayerMonthlyForMonth = serviceRequire('./store').isPlayerMonthlyForMonth;
  } finally {
    if (previousTsLoader) serviceRequire.extensions['.ts'] = previousTsLoader;
    else delete serviceRequire.extensions['.ts'];
  }

  const isMonthlyMatchRow = factoryModule.exports.__createIsMonthlyMatchRowForTest(service.findKnownPlayer, isPlayerMonthlyForMonth);

  const players = [
    { id: 'monthly', name: 'Mensual Test', nickname: 'Mensual', paymentPlan: 'perMatch', active: true },
    { id: 'guest', name: 'Galleta Test', nickname: 'Galleta', paymentPlan: 'perMatch', active: true },
  ];
  const monthlyPayments = [{ id: 'fee', playerId: 'monthly', monthKey: '2026-10', paymentStatus: 'paid', expectedAmount: 20000, amountPaid: 20000 }];

  const knownMonthlyRow = { playerId: 'monthly', name: 'Mensual Test', note: '' };
  assert.equal(isMonthlyMatchRow(knownMonthlyRow, players, '2026-10', monthlyPayments), true);

  // Known player, roster says galleta (unpaid) this month, but a stale note says
  // "mensualidad": the roster must win, not the note (this was the bug being fixed).
  const staleNoteRow = { playerId: 'guest', name: 'Galleta Test', note: 'mensualidad (nota vieja)' };
  assert.equal(isMonthlyMatchRow(staleNoteRow, players, '2026-10', monthlyPayments), false);

  // Unresolved row (no known player): the note is the only fallback signal.
  const unknownWithNoteRow = { playerId: undefined, name: 'Invitado Desconocido', note: 'mensualidad' };
  assert.equal(isMonthlyMatchRow(unknownWithNoteRow, players, '2026-10', monthlyPayments), true);
  const unknownWithoutNoteRow = { playerId: undefined, name: 'Invitado Desconocido', note: '' };
  assert.equal(isMonthlyMatchRow(unknownWithoutNoteRow, players, '2026-10', monthlyPayments), false);
});

test('provisionalGuest creates independent player "H galleta cooper" without fuzzy-matching Cooper or Hans; preserves Cooper monthly and Hans perMatch rows, fees, teams, notes, match squadTarget 12 and date format', async () => {
  const { data, service, matchId } = fixture();
  assert.equal(data.matches[0].squadTarget, 12);
  const originalDate = data.matches[0].date;

  const cooper = { id: 'player-cooper', name: 'Cooper', nickname: 'Cooper', paymentPlan: 'perMatch', active: true };
  const hans = { id: 'player-hans', name: 'Hans', nickname: 'Hans', paymentPlan: 'perMatch', active: true };
  data.players.push(cooper, hans);
  data.monthlyPayments.push({
    id: 'monthly-cooper',
    playerId: 'player-cooper',
    monthKey: '2026-10',
    paymentStatus: 'paid',
    expectedAmount: 20000,
    amountPaid: 20000,
  });

  const cooperRow = {
    id: 'mp-cooper',
    matchId,
    playerId: 'player-cooper',
    name: 'Cooper',
    phone: '111',
    attendanceStatus: 'confirmed',
    paymentStatus: 'paid',
    amountDue: 0,
    amountPaid: 0,
    note: 'mensualidad',
    team: 'A',
    whatsappOrder: 1,
    goals: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const hansRow = {
    id: 'mp-hans',
    matchId,
    playerId: 'player-hans',
    name: 'Hans',
    phone: '222',
    attendanceStatus: 'confirmed',
    paymentStatus: 'paid',
    amountDue: 5000,
    amountPaid: 5000,
    note: 'pagado Hans',
    team: 'B',
    whatsappOrder: 2,
    goals: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  data.matchPlayers = [structuredClone(cooperRow), structuredClone(hansRow)];

  await service.addPlayerToMatch({
    matchId,
    name: 'H galleta cooper',
    provisionalGuest: true,
  });

  const guestPlayer = data.players.find((p) => p.name === 'H galleta cooper');
  assert.ok(guestPlayer, 'Independent player must be created in data.players');
  assert.notEqual(guestPlayer.id, 'player-cooper');
  assert.notEqual(guestPlayer.id, 'player-hans');
  assert.equal(guestPlayer.paymentPlan, 'perMatch');

  const guestRow = data.matchPlayers.find((r) => r.name === 'H galleta cooper');
  assert.ok(guestRow, 'Guest row must exist in data.matchPlayers');
  assert.equal(guestRow.playerId, guestPlayer.id);
  assert.equal(guestRow.attendanceStatus, 'galleta');
  assert.equal(guestRow.amountDue, 5000);
  assert.equal(guestRow.amountPaid, 0);
  assert.equal(guestRow.paymentStatus, 'unpaid');

  const foundCooperRow = data.matchPlayers.find((r) => r.id === 'mp-cooper');
  assert.deepEqual(foundCooperRow, cooperRow);
  const foundHansRow = data.matchPlayers.find((r) => r.id === 'mp-hans');
  assert.deepEqual(foundHansRow, hansRow);
  assert.equal(data.monthlyPayments.find((m) => m.playerId === 'player-cooper')?.amountPaid, 20000);

  assert.equal(data.matches[0].squadTarget, 12);
  assert.equal(data.matches[0].date, originalDate);
});

test('provisionalGuest supports explicit waitlist status and explicit amountDue 3500', async () => {
  const { data, service, matchId } = fixture();
  await service.addPlayerToMatch({
    matchId,
    name: 'H galleta cooper',
    provisionalGuest: true,
    attendanceStatus: 'waitlist',
    amountDue: 3500,
  });

  const guestRow = data.matchPlayers.find((r) => r.name === 'H galleta cooper');
  assert.ok(guestRow);
  assert.equal(guestRow.attendanceStatus, 'waitlist');
  assert.equal(guestRow.amountDue, 3500);
  assert.equal(guestRow.amountPaid, 0);
  assert.equal(guestRow.paymentStatus, 'unpaid');
});

test('provisionalGuest retry preserves same identity, row, amountDue, team, and prior payment 1000 without duplicating rows or players', async () => {
  const { data, service, matchId } = fixture();
  await service.addPlayerToMatch({
    matchId,
    name: 'H galleta cooper',
    provisionalGuest: true,
    team: 'A',
  });

  assert.equal(data.matchPlayers.length, 1);
  const guestRow = data.matchPlayers[0];
  const originalRowId = guestRow.id;
  const originalPlayerId = guestRow.playerId;

  guestRow.amountPaid = 1000;
  guestRow.note = 'Pago parcial';

  const playersCountBefore = data.players.length;

  await service.addPlayerToMatch({
    matchId,
    name: 'H galleta cooper',
    provisionalGuest: true,
  });

  assert.equal(data.players.length, playersCountBefore);
  assert.equal(data.matchPlayers.length, 1);

  const updatedRow = data.matchPlayers[0];
  assert.equal(updatedRow.id, originalRowId);
  assert.equal(updatedRow.playerId, originalPlayerId);
  assert.equal(updatedRow.amountPaid, 1000);
  assert.equal(updatedRow.amountDue, 5000);
  assert.equal(updatedRow.team, 'A');
  assert.equal(updatedRow.note, 'Pago parcial');
  assert.equal(updatedRow.attendanceStatus, 'galleta');
});

test('failure in saveMatchPlayers after successful savePlayer reuses exact identity on retry without duplicating players', async () => {
  const { data, service, matchId, repository } = fixture();

  let failOnce = true;
  const originalSaveMatchPlayers = repository.saveMatchPlayers;
  repository.saveMatchPlayers = async (mId, rows) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('Simulated saveMatchPlayers failure');
    }
    return originalSaveMatchPlayers(mId, rows);
  };

  await assert.rejects(
    () => service.addPlayerToMatch({ matchId, name: 'H galleta cooper', provisionalGuest: true }),
    { message: 'Simulated saveMatchPlayers failure' }
  );

  const playersAfterFail = data.players.filter((p) => p.name === 'H galleta cooper');
  assert.equal(playersAfterFail.length, 1, 'Player was created by savePlayer before match players failed');

  await service.addPlayerToMatch({ matchId, name: 'H galleta cooper', provisionalGuest: true });

  const playersAfterRetry = data.players.filter((p) => p.name === 'H galleta cooper');
  assert.equal(playersAfterRetry.length, 1, 'Retry must reuse exact identity and not duplicate the player');
  assert.equal(data.matchPlayers.length, 1);
  assert.equal(data.matchPlayers[0].playerId, playersAfterFail[0].id);
});

test('provisionalGuest rejects attendanceStatus confirmed before persisting anything', async () => {
  const { data, service, matchId } = fixture();
  const playersCountBefore = data.players.length;
  const rowsCountBefore = data.matchPlayers.length;

  await assert.rejects(
    () => service.addPlayerToMatch({ matchId, name: 'H galleta cooper', provisionalGuest: true, attendanceStatus: 'confirmed' }),
    (err) => {
      assert.match(err.message, /confirmed/i);
      return true;
    }
  );

  assert.equal(data.players.length, playersCountBefore, 'No new player must be persisted');
  assert.equal(data.matchPlayers.length, rowsCountBefore, 'No new row must be persisted');
});

test('exact name row collision linked to Cooper or Hans rejects without writing', async () => {
  const { data, service, matchId } = fixture();
  data.matchPlayers.push({
    id: 'mp-corrupt',
    matchId,
    playerId: 'player-cooper',
    name: 'H galleta cooper',
    phone: '',
    attendanceStatus: 'galleta',
    paymentStatus: 'unpaid',
    amountDue: 5000,
    amountPaid: 0,
    note: '',
    team: 'none',
    whatsappOrder: 1,
  });

  const playersCountBefore = data.players.length;
  const originalRows = structuredClone(data.matchPlayers);

  await assert.rejects(
    () => service.addPlayerToMatch({ matchId, name: 'H galleta cooper', provisionalGuest: true }),
    (err) => {
      assert.match(err.message, /colisi[oó]n/i);
      return true;
    }
  );

  assert.equal(data.players.length, playersCountBefore, 'Must not persist new player on collision');
  assert.deepEqual(data.matchPlayers, originalRows, 'Match players must remain unmodified on collision');
});

test('provisionalGuest rejects player with perMatch global plan who is in monthly roster for the match month', async () => {
  const { data, service, matchId } = fixture();
  const targetGuest = { id: 'player-guest-roster', name: 'Invitado Especial', nickname: 'Invitado', paymentPlan: 'perMatch', active: true };
  data.players.push(targetGuest);
  data.monthlyPayments.push({
    id: 'monthly-guest',
    playerId: 'player-guest-roster',
    monthKey: '2026-10',
    paymentStatus: 'unpaid',
    expectedAmount: 20000,
    amountPaid: 0,
  });

  const playersBefore = data.players.length;
  await assert.rejects(
    () => service.addPlayerToMatch({ matchId, name: 'Invitado Especial', provisionalGuest: true }),
    (err) => {
      assert.match(err.message, /roster mensual|colisi[oó]n/i);
      return true;
    }
  );
  assert.equal(data.players.length, playersBefore, 'Must not create or modify players on collision');
  assert.equal(data.matchPlayers.length, 0, 'Must not create match player rows');
});

test('linked provisional confirmed by match closure is preserved on retry without attendanceStatus, and rejects demotion', async () => {
  const { data, service, matchId } = fixture();
  const guest = { id: 'player-h-galleta-cooper', name: 'H galleta cooper', nickname: 'H', paymentPlan: 'perMatch', active: true };
  data.players.push(guest);
  data.matchPlayers.push({
    id: 'mp-provisional-1',
    matchId,
    playerId: guest.id,
    name: 'H galleta cooper',
    phone: '',
    attendanceStatus: 'confirmed',
    paymentStatus: 'paid',
    amountDue: 5000,
    amountPaid: 5000,
    note: 'confirmado en cierre',
    team: 'A',
    whatsappOrder: 1,
    goals: 0,
  });

  // Retry without attendanceStatus: keeps confirmed and preserved amount
  await service.addPlayerToMatch({ matchId, name: 'H galleta cooper', provisionalGuest: true });
  assert.equal(data.matchPlayers.length, 1);
  assert.equal(data.matchPlayers[0].attendanceStatus, 'confirmed');
  assert.equal(data.matchPlayers[0].amountDue, 5000);
  assert.equal(data.matchPlayers[0].amountPaid, 5000);
  assert.equal(data.matchPlayers[0].team, 'A');

  // Attempted demotion: rejects before persisting
  await assert.rejects(
    () => service.addPlayerToMatch({ matchId, name: 'H galleta cooper', provisionalGuest: true, attendanceStatus: 'waitlist' }),
    (err) => {
      assert.match(err.message, /confirmado/i);
      return true;
    }
  );
  assert.equal(data.matchPlayers[0].attendanceStatus, 'confirmed');
});

test('unlinked row with exact name links to new independent identity without duplicating row', async () => {
  const { data, service, matchId } = fixture();
  data.matchPlayers.push({
    id: 'mp-unlinked',
    matchId,
    playerId: undefined,
    name: 'H galleta cooper',
    phone: '555',
    attendanceStatus: 'galleta',
    paymentStatus: 'unpaid',
    amountDue: 5000,
    amountPaid: 0,
    note: '',
    team: 'none',
    whatsappOrder: 1,
  });

  const playersBefore = data.players.length;
  await service.addPlayerToMatch({ matchId, name: 'H galleta cooper', provisionalGuest: true });

  assert.equal(data.players.length, playersBefore + 1);
  const newPlayer = data.players.find((p) => p.name === 'H galleta cooper');
  assert.ok(newPlayer);

  assert.equal(data.matchPlayers.length, 1);
  assert.equal(data.matchPlayers[0].id, 'mp-unlinked');
  assert.equal(data.matchPlayers[0].playerId, newPlayer.id);
  assert.equal(data.matchPlayers[0].name, 'H galleta cooper');
});

test('importWhatsAppMatch merge preserves prior payments, manual notes, teams, row IDs and monthly debt zeroing across repeated calls', async () => {
  const { data, service, matchId } = fixture();

  await service.addPlayerToMatch({ matchId, name: 'Mensual Test', team: 'A' });
  await service.addPlayerToMatch({ matchId, name: 'Galleta Test', attendanceStatus: 'confirmed', amountDue: 3500, team: 'B' });

  // Simula monthly amountDue 5000 / amountPaid 2000 / unpaid y guest paid 1000 / note manual
  Object.assign(data.matchPlayers[0], { amountDue: 5000, amountPaid: 2000, paymentStatus: 'unpaid' });
  Object.assign(data.matchPlayers[1], { amountPaid: 1000, note: 'manual' });

  const monthlyRowId = data.matchPlayers[0].id;
  const guestRowId = data.matchPlayers[1].id;
  const savedMonthlyPayments = structuredClone(data.monthlyPayments);

  const message = [
    'martes 6/10/2026: 21 hrs',
    'anotarse en lista:',
    '* Mensual Test',
    '* Galleta Test',
  ].join('\n');

  for (let rep = 0; rep < 2; rep++) {
    const res = await service.importWhatsAppMatch({
      matchId,
      message,
      mode: 'merge',
    });

    assert.equal(data.matchPlayers.length, 2);

    const mRow = data.matchPlayers.find((r) => r.name === 'Mensual Test');
    assert.ok(mRow);
    assert.equal(mRow.id, monthlyRowId);
    assert.equal(mRow.amountDue, 0);
    assert.equal(mRow.amountPaid, 2000);
    assert.equal(mRow.paymentStatus, 'paid');
    assert.equal(mRow.team, 'A');

    const gRow = data.matchPlayers.find((r) => r.name === 'Galleta Test');
    assert.ok(gRow);
    assert.equal(gRow.id, guestRowId);
    assert.equal(gRow.amountDue, 3500);
    assert.equal(gRow.amountPaid, 1000);
    assert.equal(gRow.paymentStatus, 'unpaid');
    assert.equal(gRow.team, 'B');
    assert.equal(gRow.note, 'manual');

    assert.deepEqual(data.monthlyPayments, savedMonthlyPayments);
    assert.equal(res.summary.pendingAmount, 2500);
  }
});
