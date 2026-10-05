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
  const match = { id: 'test-match', date: '2026-10-06', time: '21:00', location: 'Test', monthKey: '2026-10', status: 'confirmed', weekLabel: 'Test', courtCost: 35000, courtPrepaid: true, totalCost: 35000, notes: '', matchFormat: 'clasico' };
  const players = [
    { id: 'monthly', name: 'Mensual Test', nickname: 'Mensual', paymentPlan: 'perMatch', active: true },
    { id: 'guest', name: 'Galleta Test', nickname: 'Galleta', paymentPlan: 'perMatch', active: true },
  ];
  const data = { matches: [match], players, matchPlayers: [], results: [], monthlyPayments: [{ id: 'monthly-fee', playerId: 'monthly', monthKey: '2026-10', paymentStatus: 'paid', expectedAmount: 20000, amountPaid: 20000 }] };
  const repository = {
    getSifupData: async () => data,
    saveMatchPlayers: async (matchId, rows) => {
      assert.equal(matchId, match.id);
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
  return { data, service: fixtureModule.exports, matchId: match.id };
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

test('monthly membership applies only to the match month; paid monthly fallback is not fabricated', async () => {
  const { data, service, matchId } = fixture();
  data.monthlyPayments[0].monthKey = '2026-09';
  await service.addPlayerToMatch({ matchId, name: 'Mensual Test', attendanceStatus: 'confirmed' });
  assert.equal(data.matchPlayers[0].amountDue, 5000);
  assert.equal(data.players[0].paymentPlan, 'perMatch');
});
