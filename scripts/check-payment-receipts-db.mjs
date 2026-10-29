// Offline only: in-memory PostgreSQL, no dotenv, no network/database URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to scratch-installed PGlite.');
const { PGlite } = require(process.env.PGLITE_MODULE);
const ts = require('typescript');
const db = new PGlite();
function sqlFor(client) {
  const sql = async (parts, ...values) => (await client.query(parts.reduce((q, part, i) => q + (i ? `$${i}` : '') + part, ''), values)).rows;
  sql.begin = (fn) => db.transaction((tx) => fn(sqlFor(tx)));
  return sql;
}
const sql = sqlFor(db);
function loadTs(relative, resolve) {
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const loaded = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(resolve, loaded, loaded.exports);
  return loaded.exports;
}
const repo = loadTs('src/lib/repository.ts', (name) => {
  if (name === 'server-only') return {};
  if (name === './db') return { getSql: () => sql, hasDatabaseUrl: () => true };
  return require(path.resolve(root, 'src/lib', name));
});
const service = loadTs('src/lib/sifup-service.ts', (name) => {
  if (name === 'server-only') return {};
  if (name === 'next/cache') return { revalidatePath() {} };
  if (name === './repository') return repo;
  return require(path.resolve(root, 'src/lib', name));
});
const route = loadTs('src/app/mcp/route.ts', (name) => {
  if (name === '@/lib/sifup-service') return service;
  if (name === '@/lib/court-payment-service') return {};
  if (name.startsWith('@/lib/')) return require(path.join(root, 'src/lib', name.slice('@/lib/'.length)));
  return require(name);
});
const oldToken = process.env.SIFUP_MCP_TOKEN;
process.env.SIFUP_MCP_TOKEN = 'offline-receipt-test-only';
async function rpc(method, params, authorized = true) {
  const response = await route.POST(new Request('http://localhost/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(authorized ? { Authorization: 'Bearer offline-receipt-test-only' } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  return { status: response.status, body: await response.json() };
}
async function call(name, args, error = false) {
  const { body } = await rpc('tools/call', { name, arguments: args });
  if (error) { assert.ok(body.error || body.result?.isError, JSON.stringify(body)); return; }
  assert.ok(!body.error && !body.result?.isError, JSON.stringify(body));
  return body.result.structuredContent;
}
const monthly = (playerId) => ({ playerId, monthKey: '2026-11' });
function withoutReceipt(row) {
  const result = { ...row };
  delete result.paidAt;
  delete result.paidDate;
  return result;
}
const galleta = { playerId: 'jonathan', matchId: 'match-2026-10-27' };
const allBusiness = async () => ({
  monthly: (await db.query('select id, player_id, month_key, expected_amount, amount_paid, payment_status, note, created_at from monthly_payments order by id')).rows,
  match: (await db.query('select id, match_id, player_id, amount_due, amount_paid, payment_status, note, team, attendance_status, created_at from match_players order by id')).rows,
});
try {
  await db.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'db/migrations/20261028-court-payments.sql'), 'utf8'));
  // Exercise upgrade from the old schema, not just fresh installation.
  await db.exec('alter table monthly_payments drop column paid_date; alter table match_players drop column paid_date; alter table match_players drop column paid_at;');
  await db.exec(`insert into matches (id, match_date, match_time, location, status) values ('match-2026-10-27', '2026-10-27', '21:00', 'Synthetic', 'played');
    insert into players (id, name, payment_plan, skill_level) values
    ('marcio','Synthetic Marcio','monthly',3), ('cooper','Synthetic Cooper','monthly',3), ('jonathan','Synthetic Jonathan','perMatch',3),
    ('german','Synthetic German','perMatch',3), ('mella','Synthetic Mella','perMatch',3), ('danniels','Synthetic Danniels','monthly',3);
    insert into monthly_payments (id, player_id, month_key, amount_paid, payment_status, paid_at, note) values
    ('fee-marcio','marcio','2026-11',20000,'paid','2026-10-29T10:00Z','original'),
    ('fee-cooper','cooper','2026-11',20000,'paid','2026-10-29T10:56:28.999Z','already paid'),
    ('fee-danniels','danniels','2026-11',0,'promised',NULL,'Friday is not a payment');
    insert into match_players (id, match_id, player_id, name, attendance_status, payment_status, amount_due, amount_paid, team, note) values
    ('row-jonathan','match-2026-10-27','jonathan','Synthetic Jonathan','confirmed','paid',5000,5000,'A','Received 28/10 00:02'),
    ('row-german','match-2026-10-27','german','Synthetic German','confirmed','unpaid',5000,0,'B','original'),
    ('row-mella','match-2026-10-27','mella','Synthetic Mella','confirmed','unpaid',5000,0,'A','original');`);
  const before = await allBusiness();
  const migration = fs.readFileSync(path.join(root, 'db/migrations/20261029-payment-receipts.sql'), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual(await allBusiness(), before);
  assert.equal((await rpc('tools/list', {}, false)).status, 401);
  const list = (await rpc('tools/list', {})).body.result.tools;
  for (const name of ['get_payment_record', 'correct_payment_received_at']) assert.ok(list.some((tool) => tool.name === name));
  for (const name of ['register_monthly_payment', 'register_match_payment']) assert.ok(list.find((tool) => tool.name === name).inputSchema.properties.receivedAt);

  assert.equal((await call('get_payment_record', galleta)).receiptPrecision, 'unknown');
  for (const [selector, receivedAt, expectedAt] of [
    [monthly('marcio'), '2026-10-28', null],
    [monthly('cooper'), '2026-10-29', null],
    [galleta, '2026-10-28T00:02-03:00', '2026-10-28T03:02:00.000Z'],
  ]) {
    for (let retry = 0; retry < 2; retry++) {
      const fixed = await call('correct_payment_received_at', { ...selector, receivedAt });
      assert.equal(fixed.paidDate, receivedAt.slice(0, 10));
      assert.equal(fixed.paidAt, expectedAt);
      assert.equal(fixed.paymentStatus, 'paid');
      assert.equal(fixed.receiptPrecision, expectedAt ? 'instant' : 'date');
      assert.equal(fixed.amountPaid, selector.matchId ? 5000 : 20000);
      const read = await call('get_payment_record', selector);
      assert.deepEqual(read, fixed);
    }
  }
  assert.deepEqual(await allBusiness(), before, 'date corrections changed money/status/notes/rosters');
  const corrected = await repo.getSifupData();
  for (const playerId of ['marcio', 'cooper']) {
    const original = await call('get_payment_record', monthly(playerId));
    await call('register_monthly_payment', monthly(playerId));
    const replay = await call('get_payment_record', monthly(playerId));
    assert.equal(replay.paidAt, original.paidAt);
    assert.equal(replay.paidDate, original.paidDate);
    assert.equal(replay.amountPaid, original.amountPaid);
  }
  await call('register_match_payment', { ...galleta, amount: 5000 });
  assert.deepEqual(await allBusiness(), before);
  assert.equal((await call('get_payment_record', galleta)).paidAt, '2026-10-28T03:02:00.000Z');

  for (const receivedAt of ['2026-02-29', '2026-10-28T00:02', '2026-10-28T24:00Z', '2026-10-28T00:02+14:01']) {
    await call('correct_payment_received_at', { ...galleta, receivedAt }, true);
    await assert.rejects(service.correctPaymentReceivedAt({ ...galleta, receivedAt }));
  }
  for (const selector of [monthly('danniels'), { playerId: 'german', matchId: galleta.matchId }, { playerId: 'mella', matchId: galleta.matchId }, { playerId: 'cooper' }, { ...monthly('cooper'), matchId: galleta.matchId }, monthly('missing'), { ...galleta, matchId: 'missing' }]) {
    await call('correct_payment_received_at', { ...selector, receivedAt: '2026-10-28' }, true);
  }
  await assert.rejects(repo.correctPaymentReceipt('monthly', 'fee-danniels', '2026-10-28'));
  assert.deepEqual(await allBusiness(), before);

  // Both destructive roster rewrites retain receipts, even for older callers omitting them.
  for (const method of ['saveMatchPlayers', 'saveMatchWithPlayers']) {
    const data = await repo.getSifupData();
    const rows = data.matchPlayers.map(withoutReceipt);
    if (method === 'saveMatchPlayers') await repo[method](galleta.matchId, rows);
    else await repo[method](data.matches[0], rows);
    const read = await call('get_payment_record', galleta);
    assert.equal(read.paidAt, '2026-10-28T03:02:00.000Z');
    assert.equal(read.paidDate, '2026-10-28');
  }
  const marcioFee = corrected.monthlyPayments.find((row) => row.playerId === 'marcio');
  const oldPayload = withoutReceipt(marcioFee);
  await repo.saveMonthlyPayment(oldPayload);
  // A stale UI status payload must not replace a date-only receipt with today's clock.
  await repo.saveMonthlyPayment({ ...marcioFee, paidAt: '2026-10-29T12:00:00Z' });
  await repo.applyRosterChange({ playerId: 'marcio', monthKey: '2026-11', upsertPayment: oldPayload, rowUpdates: [] });
  assert.equal((await call('get_payment_record', monthly('marcio'))).paidDate, '2026-10-28');
  assert.equal((await call('get_payment_record', monthly('marcio'))).paidAt, null);
  await repo.markMatchPlayerPaid('row-jonathan');
  await repo.setMatchPlayerPaymentStatus('row-jonathan', 'paid');
  assert.equal((await call('get_payment_record', galleta)).paidAt, '2026-10-28T03:02:00.000Z');
  await service.updateMatchPlayer({ ...galleta, note: 'Received 28/10 00:02' });
  await service.assignPlayerTeam({ ...galleta, team: 'A' });
  assert.equal((await service.getNextMatchSummary({ matchId: galleta.matchId })).players.all.find((row) => row.id === 'row-jonathan').paidAt, '2026-10-28T03:02:00.000Z');
  assert.deepEqual(await allBusiness(), before);

  // New receipts on actual registrations, legacy timestamp retries, and partial receipts.
  for (let retry = 0; retry < 2; retry++) {
    await service.importWhatsAppMatch({ matchId: galleta.matchId, mode: 'merge', message: 'martes 27/10/2026: 21 hrs\nanotarse en lista:\n* Synthetic Jonathan\n* Synthetic German\n* Synthetic Mella' });
    assert.equal((await call('get_payment_record', galleta)).paidAt, '2026-10-28T03:02:00.000Z');
    assert.deepEqual(await allBusiness(), before);
  }
  await db.exec(`insert into players (id, name, payment_plan, skill_level) values ('new','Synthetic New','monthly',3);
    insert into monthly_payments (id, player_id, month_key, payment_status) values ('new-fee','new','2026-11','unpaid');
    insert into match_players (id, match_id, player_id, name, attendance_status, payment_status, amount_due, team) values ('new-row','match-2026-10-27','new','Synthetic New','confirmed','unpaid',5000,'B');`);
  await call('register_monthly_payment', { ...monthly('new'), receivedAt: '2026-10-28' });
  assert.equal((await call('get_payment_record', monthly('new'))).paidAt, null);
  await call('register_match_payment', { playerId: 'new', matchId: galleta.matchId, amount: 2000, receivedAt: '2026-10-28T00:02-03:00' });
  const partial = await call('get_payment_record', { playerId: 'new', matchId: galleta.matchId });
  await call('correct_payment_received_at', { playerId: 'new', matchId: galleta.matchId, receivedAt: '2026-10-28' });
  const fixedPartial = await call('get_payment_record', { playerId: 'new', matchId: galleta.matchId });
  assert.equal(fixedPartial.amountPaid, partial.amountPaid);
  assert.equal(fixedPartial.paymentStatus, partial.paymentStatus);
  assert.equal(fixedPartial.paidAt, null);
  await call('correct_payment_received_at', { playerId: 'new', matchId: galleta.matchId, receivedAt: '2026-10-28T23:59-03:00' });
  const midnight = await call('get_payment_record', { playerId: 'new', matchId: galleta.matchId });
  assert.equal(midnight.paidDate, '2026-10-28');
  assert.equal(midnight.paidAt, '2026-10-29T02:59:00.000Z');
  await db.exec("update match_players set amount_due = 0, amount_paid = 5000 where id = 'new-row'");
  await call('register_match_payment', { playerId: 'new', matchId: galleta.matchId, amount: 5000 });
  assert.equal((await call('get_payment_record', { playerId: 'new', matchId: galleta.matchId })).amountPaid, 5000);
  await db.exec("update monthly_payments set paid_date = NULL, paid_at = '2026-10-29T10:56:28.999Z' where id = 'fee-cooper'");
  await call('register_monthly_payment', monthly('cooper'));
  assert.equal((await call('get_payment_record', monthly('cooper'))).paidAt, '2026-10-29T10:56:28.999Z');
  // Actual merge SQL must preserve the sole receipt, and roll back conflicting receipts.
  await db.exec(`insert into players (id, name, payment_plan, skill_level) values ('duplicate','Synthetic Duplicate','monthly',3);
    insert into monthly_payments (id, player_id, month_key, amount_paid, payment_status, paid_date) values ('duplicate-fee','duplicate','2026-11',20000,'paid','2026-10-27');`);
  const preMerge = await allBusiness();
  await assert.rejects(repo.mergePlayers('duplicate', 'marcio'), /conciliar/);
  assert.deepEqual(await allBusiness(), preMerge, 'merge conflict must roll back');
  await db.exec("update monthly_payments set amount_paid = 0, paid_date = NULL, payment_status = 'unpaid' where id = 'duplicate-fee'");
  await repo.mergePlayers('marcio', 'duplicate');
  const merged = await call('get_payment_record', monthly('duplicate'));
  assert.equal(merged.paidDate, '2026-10-28');
  assert.equal(merged.paidAt, null);
  assert.equal(merged.amountPaid, 20000);
  await db.exec(`insert into players (id, name, payment_plan, skill_level) values ('dup-j','Synthetic J Target','perMatch',3);
    insert into match_players (id, match_id, player_id, name, attendance_status, payment_status, amount_due, team) values ('dup-j-row','match-2026-10-27','dup-j','Synthetic J Target','confirmed','unpaid',5000,'B');`);
  await repo.mergePlayers('jonathan', 'dup-j');
  const mergedGalleta = await call('get_payment_record', { playerId: 'dup-j', matchId: galleta.matchId });
  assert.equal(mergedGalleta.paidAt, '2026-10-28T03:02:00.000Z');
  assert.equal(mergedGalleta.amountPaid, 5000);
  await db.exec(`insert into match_players (id, match_id, player_id, name, attendance_status, payment_status, amount_due, amount_paid, paid_date, team)
    values ('dup-j-conflict','match-2026-10-27','dup-j','Synthetic J Target','confirmed','paid',5000,5000,'2026-10-29','B');`);
  const preDedup = await allBusiness();
  await assert.rejects(service.deduplicateMatchPlayers({ matchId: galleta.matchId }), /conciliar/);
  assert.deepEqual(await allBusiness(), preDedup);
  console.log('PASS: synthetic Marcio/Cooper/Jonathan; migration upgrade/repeatability; real repository SQL + MCP transport/list/schema/read/correct/retry; date-only/offset/UTC; no extra money/status change; German/Mella debt and Danniels promise protected; both match rewrites, monthly/roster upserts, UI payment helpers, note/team updates; new and partial receipts; legacy paidAt retry preservation. No live DB/network.');
} finally {
  if (oldToken === undefined) delete process.env.SIFUP_MCP_TOKEN;
  else process.env.SIFUP_MCP_TOKEN = oldToken;
  await db.close();
}
