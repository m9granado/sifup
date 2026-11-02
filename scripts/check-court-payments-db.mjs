// Offline PostgreSQL check. PGLITE_MODULE must point to a scratch-installed
// @electric-sql/pglite module. Never reads .env or connects to DATABASE_URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the scratch-installed PGlite module.');
const { PGlite } = require(process.env.PGLITE_MODULE);
const ts = require('typescript');
const db = new PGlite();
const migration = fs.readFileSync(path.join(root, 'db/migrations/20261028-court-payments.sql'), 'utf8');
await db.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
await db.exec(migration);
await db.exec(migration); // repeatable migration

function sqlFor(client) {
  const sql = async (parts, ...values) => {
    const text = parts.reduce((query, part, index) => query + (index ? `$${index}` : '') + part, '');
    return (await client.query(text, values)).rows;
  };
  sql.begin = (fn) => db.transaction((tx) => fn(sqlFor(tx)));
  return sql;
}
const sql = sqlFor(db);
const file = path.join(root, 'src/lib/repository.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const repositoryModule = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: file })((name) => {
  if (name === 'server-only') return {};
  if (name === './db') return { getSql: () => sql, hasDatabaseUrl: () => true };
  return require(path.resolve(root, 'src/lib', name));
}, repositoryModule, repositoryModule.exports);
const repo = repositoryModule.exports;

for (const day of ['06', '13', '20', '27']) {
  await db.query(`insert into matches (id, match_date, match_time, location, status, court_cost, court_prepaid, month_key)
    values ($1, $2, '21:00', 'Synthetic court', 'confirmed', 35000, true, '2026-10')`, [`match-2026-10-${day}`, `2026-10-${day}`]);
}
await db.exec(`insert into club_expenses (id, expense_date, label, amount, category) values ('test-expense', '2026-10-01', 'Synthetic four courts', 140000, 'court');
  insert into players (id, name, payment_plan, skill_level) values ('guest', 'Synthetic guest', 'perMatch', 3);
  insert into match_players (id, match_id, player_id, name, attendance_status, payment_status, amount_due, amount_paid, team)
    values ('row', 'match-2026-10-13', 'guest', 'Synthetic guest', 'confirmed', 'paid', 5000, 5000, 'A');
  insert into monthly_payments (id, player_id, month_key, amount_paid, payment_status) values ('fee', 'guest', '2026-10', 20000, 'paid');
  insert into match_results (id, match_id, score_a, score_b, winner) values ('oct-result', 'match-2026-10-27', 0, 1, 'B');`);
const playerRows = (await db.query('select * from match_players')).rows;
const monthlyRows = (await db.query('select * from monthly_payments')).rows;
const expenseRows = (await db.query('select * from club_expenses')).rows;
const input = { expenseId: 'test-expense', matchId: 'match-2026-10-06', targetDate: '2026-11-03' };
await repo.applyCourtPayment({ expenseId: input.expenseId, matchId: input.matchId });
const saved = await repo.applyCourtPayment(input);
assert.equal(saved.createTarget, true);
assert.equal((await repo.applyCourtPayment(input)).unchanged, true);

// An injected PostgreSQL failure after destination creation must roll back
// creation, suspension and allocation together.
await db.exec(`create function fail_test_payment() returns trigger language plpgsql as $$
  begin if new.target_match_id = 'match-2026-11-10' then raise exception 'injected failure'; end if; return new; end $$;
  create trigger fail_test_payment before insert on court_payments for each row execute function fail_test_payment();`);
await assert.rejects(repo.applyCourtPayment({ ...input, matchId: 'match-2026-10-13', targetDate: '2026-11-10' }), /injected failure/);
assert.equal((await db.query("select count(*)::int as n from matches where id = 'match-2026-11-10'")).rows[0].n, 0);
assert.equal((await db.query("select status from matches where id = 'match-2026-10-13'")).rows[0].status, 'confirmed');
await db.exec('drop trigger fail_test_payment on court_payments; drop function fail_test_payment();');
for (const [from, to] of [['13', '10'], ['20', '17']]) {
  await repo.applyCourtPayment({ ...input, matchId: `match-2026-10-${from}`, targetDate: `2026-11-${to}` });
}
await repo.applyCourtPayment({ expenseId: input.expenseId, matchId: 'match-2026-10-27' });
const { courtFinanceSummary } = require(path.join(root, 'src/lib/court-payments.ts'));
let data = await repo.getSifupData();
assert.equal(data.courtPayments.length, 4);
assert.equal(courtFinanceSummary(data, '2026-10').consumedAmount, 35000);
assert.equal(courtFinanceSummary(data, '2026-10').suspendedCount, 3);
assert.equal(courtFinanceSummary(data, '2026-11').scheduledCredit, 105000);
assert.equal(courtFinanceSummary(data, '2026-11').cashPaid, 0);
assert.deepEqual((await db.query('select * from match_players')).rows, playerRows);
assert.deepEqual((await db.query('select * from monthly_payments')).rows, monthlyRows);
assert.deepEqual((await db.query('select * from club_expenses')).rows, expenseRows);
await assert.rejects(db.exec("update matches set status = 'confirmed' where id = 'match-2026-10-06'"), /suspendida/);
await assert.rejects(db.exec("update matches set status = 'suspended' where id = 'match-2026-11-03'"), /Traslada el credito/);
await assert.rejects(db.exec("update matches set match_date = '2026-12-01' where id = 'match-2026-11-03'"), /fecha o costo/);
await assert.rejects(repo.saveMatchPlayers('match-2026-10-13', [], { id: 'bad-result', matchId: 'match-2026-10-13', scoreA: 0, scoreB: 0, winner: 'draw', notes: '' }), /suspendido/);
assert.deepEqual((await db.query('select * from match_players')).rows, playerRows);

await db.exec("insert into match_results (id, match_id, score_a, score_b, winner) values ('nov-result', 'match-2026-11-03', 1, 0, 'A')");
data = await repo.getSifupData();
assert.equal(courtFinanceSummary(data, '2026-11').consumedAmount, 35000);
assert.equal(courtFinanceSummary(data, '2026-11').scheduledCredit, 70000);
assert.equal((await repo.applyCourtPayment(input)).unchanged, true);
await assert.rejects(db.exec("update club_expenses set amount = 1 where id = 'test-expense'"), /gasto vinculado/);
await assert.rejects(db.exec("insert into match_results (id, match_id, score_a, score_b, winner) values ('bad', 'match-2026-10-06', 0, 0, 'draw')"), /suspendido/);
await db.exec("insert into match_teams (id, match_id, name) values ('test-team', 'match-2026-10-06', 'Synthetic')");
await assert.rejects(db.exec("update match_teams set final_rank = 1 where id = 'test-team'"), /suspendido/);
await assert.rejects(db.exec("insert into match_games (id, match_id, seq, home_team_id, away_team_id) values ('bad-game', 'match-2026-10-06', 1, 'test-team', 'test-team')"), /suspendido/);

function loadTs(relative, resolve) {
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(resolve, mod, mod.exports);
  return mod.exports;
}
const service = loadTs('src/lib/court-payment-service.ts', (name) => {
  if (name === 'server-only') return {};
  if (name === 'next/cache') return { revalidatePath() {} };
  if (name === './repository') return repo;
  return require(path.resolve(root, 'src/lib', name));
});
const permissionChecks = [];
let deniedPermission;
const actions = loadTs('src/app/actions.ts', (name) => {
  if (name === '@/lib/auth') return { requirePermission: async (permission) => {
    permissionChecks.push(permission);
    if (permission === deniedPermission) throw new Error('permission denied');
  } };
  if (name === '@/lib/db') return { getSql: () => sql, hasDatabaseUrl: () => true };
  if (name === '@/lib/repository') return repo;
  if (name === '@/lib/court-payment-service') return service;
  if (name === '@/lib/sifup-service') return {};
  if (name.startsWith('@/lib/')) return require(path.join(root, 'src/lib', name.slice('@/lib/'.length)));
  return require(name);
});
await actions.linkCourtPaymentAction(input);
assert.deepEqual(permissionChecks, ['payments', 'matches']);
for (const permission of ['payments', 'matches']) {
  deniedPermission = permission;
  await assert.rejects(actions.linkCourtPaymentAction({ ...input, dryRun: false }), /permission denied/);
}
const route = loadTs('src/app/mcp/route.ts', (name) => {
  if (name === '@/lib/court-payment-service') return service;
  if (name === '@/lib/sifup-service') return new Proxy({}, { get: () => async () => ({}) });
  if (name.startsWith('@/lib/')) return require(path.join(root, 'src/lib', name.slice('@/lib/'.length)));
  return require(name);
});
const oldToken = process.env.SIFUP_MCP_TOKEN;
process.env.SIFUP_MCP_TOKEN = 'offline-court-test-only';
async function request(method, params, authorized = true) {
  return route.POST(new Request('http://localhost/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(authorized ? { Authorization: 'Bearer offline-court-test-only' } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
}
try {
  assert.equal((await request('tools/list', {}, false)).status, 401);
  const listed = await (await request('tools/list', {})).json();
  for (const name of ['get_court_finances', 'link_court_payment', 'transfer_court_payment']) assert.ok(listed.result.tools.some((tool) => tool.name === name));
  const report = await (await request('tools/call', { name: 'get_court_finances', arguments: { monthKey: '2026-11' } })).json();
  assert.equal(report.result.structuredContent.scheduledCredit, 70000);
  await db.exec("insert into club_expenses (id, expense_date, label, amount, category) values ('preview-expense', '2026-10-01', 'Synthetic preview only', 35000, 'court'); insert into matches (id, match_date, match_time, location, status, court_cost) values ('preview-source', '2026-10-28', '21:00', 'Test', 'confirmed', 35000)");
  const args = { expenseId: 'preview-expense', matchId: 'preview-source', targetDate: '2026-11-24' };
  const preview = await (await request('tools/call', { name: 'transfer_court_payment', arguments: args })).json();
  assert.equal(preview.result.structuredContent.dryRun, true);
  assert.equal((await db.query("select count(*)::int as n from matches where match_date = '2026-11-24'")).rows[0].n, 0);
  const applied = await (await request('tools/call', { name: 'transfer_court_payment', arguments: { ...args, dryRun: false } })).json();
  assert.equal(applied.result.structuredContent.dryRun, false);
  assert.equal(applied.result.structuredContent.payment.targetMatchId, 'match-2026-11-24');
  const replay = await (await request('tools/call', { name: 'transfer_court_payment', arguments: { ...args, dryRun: false } })).json();
  assert.equal(replay.result.structuredContent.unchanged, true);
  // A different admin can consume credit after preview: confirmation must replan
  // inside the transaction, reject overspending, and leave no destination behind.
  await db.exec(`insert into club_expenses (id, expense_date, label, amount, category) values ('race-expense', '2026-10-01', 'Synthetic race', 35000, 'court');
    insert into matches (id, match_date, match_time, location, status, court_cost) values
    ('race-source', '2026-10-29', '21:00', 'Test', 'confirmed', 35000),
    ('race-competitor', '2026-10-30', '21:00', 'Test', 'confirmed', 35000)`);
  const raceInput = {expenseId: 'race-expense', matchId: 'race-source', targetDate: '2026-12-01'};
  const beforeRace = (await db.query("select * from matches where id = 'race-source'")).rows;
  assert.equal((await service.linkCourtPayment(raceInput)).dryRun, true);
  await repo.applyCourtPayment({expenseId: 'race-expense', matchId: 'race-competitor'});
  await assert.rejects(service.linkCourtPayment({...raceInput, dryRun: false}), /saldo suficiente/);
  assert.deepEqual((await db.query("select * from matches where id = 'race-source'")).rows, beforeRace);
  assert.equal((await db.query("select count(*)::int as n from matches where match_date = '2026-12-01'")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int as n from court_payments where source_match_id = 'race-source'")).rows[0].n, 0);
} finally {
  if (oldToken === undefined) delete process.env.SIFUP_MCP_TOKEN;
  else process.env.SIFUP_MCP_TOKEN = oldToken;
  await db.close();
}
console.log('PASS: offline PostgreSQL migration, real repository transactions, rollback, payment preservation, protected dates/results, credit consumption; real MCP HTTP transport/auth/list/report/preview/apply/retry. Synthetic amounts only.');
