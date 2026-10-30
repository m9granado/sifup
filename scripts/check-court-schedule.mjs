// New isolated regression: in-memory PostgreSQL only; never loads .env or a live URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
if (!process.env.PGLITE_MODULE) throw new Error('PGLITE_MODULE must point to scratch PGlite.');
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
await db.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
// Existing schema constraints reproduced only in the disposable memory DB, never production.
await db.exec(fs.readFileSync(path.join(root, 'db/migrations/20261028-court-payments.sql'), 'utf8'));
function sqlFor(client) {
  const sql = async (parts, ...values) => (await client.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  sql.begin = fn => db.transaction(tx => fn(sqlFor(tx)));
  return sql;
}
const sql = sqlFor(db);
function load(relative, resolver) {
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(resolver, loaded, loaded.exports);
  return loaded.exports;
}
const lib = name => require(path.resolve(root, 'src/lib', name));
const repo = load('src/lib/repository.ts', name => name === 'server-only' ? {} : name === './db' ? { getSql: () => sql, hasDatabaseUrl: () => true } : lib(name));
const service = load('src/lib/court-payment-service.ts', name => name === 'server-only' || name === 'next/cache' ? { revalidatePath() {} } : name === './repository' ? repo : lib(name));
for (const date of ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']) {
  await db.query("insert into matches (id, match_date, match_time, location, status, court_cost, court_prepaid, month_key) values ($1,$2,'21:00','Synthetic court','confirmed',35000,true,$3)", [`match-${date}`, date, date.slice(0,7)]);
}
await db.exec("insert into players (id,name,payment_plan,skill_level) values ('p','Synthetic','monthly',3); insert into match_players (id,match_id,player_id,name,attendance_status,payment_status,amount_due,amount_paid,team) values ('r','match-2026-10-06','p','Synthetic','confirmed','paid',5000,5000,'A'); insert into monthly_payments (id,player_id,month_key,amount_paid,payment_status) values ('m','p','2026-11',20000,'paid'); insert into match_results (id,match_id,score_a,score_b,winner) values ('result','match-2026-10-27',1,0,'A')");
const protectedTables = ['match_players', 'monthly_payments', 'match_results', 'match_teams', 'match_games'];
const snapshot = async () => Object.fromEntries(await Promise.all(protectedTables.map(async table => [table, (await db.query(`select * from ${table} order by id`)).rows])));
const before = await snapshot();
const original = (await repo.getSifupData()).matches.filter(row => ['2026-10-27','2026-11-03'].includes(row.date));
const note = 'Programación provisional · pendiente de confirmación del recinto';
const entries = ['2026-11-10','2026-11-17','2026-10-06','2026-10-13','2026-10-20'].map(date => ({ date, time:'21:00', location:'Club Sordos', status: date.includes('-11-') ? 'open' : 'suspended', courtCost:35000, notes:date.includes('-11-') ? note : date.endsWith('20') ? 'Recinto no disponible · fecha fuera del paquete pagado' : `Suspendido por lluvia · reprogramación provisional al ${date.endsWith('06') ? '10' : '17'}/11` }));
const expense = { expenseId:'synthetic-package', expenseDate:'2026-10-01', amount:140000, label:'Synthetic cross-month package', payer:'Synthetic payer', provider:'Synthetic venue', evidence:'Synthetic declaration, not a bank receipt' };
const route = load('src/app/mcp/route.ts', name => name === '@/lib/court-payment-service' ? service : name === '@/lib/sifup-service' ? new Proxy({}, { get: () => async () => ({}) }) : name.startsWith('@/lib/') ? require(path.join(root, 'src/lib', name.slice(6))) : require(name));
process.env.SIFUP_MCP_TOKEN = 'isolated-schedule-only';
async function rpc(method, params, authorized = true) {
  const response = await route.POST(new Request('http://localhost/mcp', { method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json, text/event-stream', ...(authorized ? {Authorization:'Bearer isolated-schedule-only'} : {})}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) }));
  if (!authorized) return response.status;
  return (await response.json()).result;
}
async function call(name, args) { const result = await rpc('tools/call', {name,arguments:args}); assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent; }
try {
  assert.equal(await rpc('tools/list',{},false),401);
  const tools = (await rpc('tools/list',{})).tools;
  for (const name of ['get_match_records','schedule_matches','register_court_expense']) assert.ok(tools.some(tool=>tool.name===name));
  assert.equal((await call('schedule_matches',{entries})).dryRun,true);
  assert.equal((await repo.getSifupData()).matches.length,5);
  // Force failure after an earlier INSERT: the entire agenda batch must roll back.
  await db.exec("create function fail_schedule() returns trigger language plpgsql as $$ begin if new.match_date='2026-11-17' then raise exception 'injected agenda failure'; end if; return new; end $$; create trigger fail_schedule before insert on matches for each row execute function fail_schedule();");
  await assert.rejects(service.scheduleMatches({entries,dryRun:false}),/injected agenda failure/);
  assert.equal((await repo.getSifupData()).matches.length,5);
  await db.exec('drop trigger fail_schedule on matches; drop function fail_schedule();');
  await call('schedule_matches',{entries,dryRun:false});
  assert.ok((await call('schedule_matches',{entries,dryRun:false})).plan.every(row=>row.unchanged));
  await assert.rejects(service.scheduleMatches({entries:[{...entries[0],date:'2026-10-27'}],dryRun:false}),/actividad/);
  await assert.rejects(service.scheduleMatches({entries:[{...entries[0],date:'2026-02-30'}]}),/invalida/);
  await assert.rejects(service.scheduleMatches({entries:[entries[0],entries[0]]}),/distintas/);
  assert.equal((await call('register_court_expense',expense)).dryRun,true);
  assert.equal((await repo.getSifupData()).clubExpenses.length,0);
  await call('register_court_expense',{...expense,dryRun:false});
  assert.equal((await call('register_court_expense',{...expense,dryRun:false})).unchanged,true);
  await assert.rejects(service.registerCourtExpense({...expense,amount:105000,dryRun:false}),/otros datos/);
  await assert.rejects(service.registerCourtExpense({...expense,expenseId:'duplicate',dryRun:false}),/duplicado/);
  const allocations = ['2026-10-27','2026-11-03','2026-10-06','2026-10-13'].map((date,i)=>({expenseId:expense.expenseId,matchId:`match-${date}`,...(i>1 ? {targetDate:`2026-11-${i===2?'10':'17'}`} : {})}));
  // Preview the whole set on an evolving disposable snapshot before any apply.
  const { planCourtPayment, courtFinanceSummary } = lib('./court-payments');
  const previewData = await repo.getSifupData();
  for (const input of allocations) { const p = planCourtPayment(previewData,input); previewData.courtPayments.push(p.payment); }
  assert.equal(previewData.courtPayments.reduce((sum,p)=>sum+p.amount,0),140000);
  for (const input of allocations) { await service.linkCourtPayment(input); await service.linkCourtPayment({...input,dryRun:false}); assert.equal((await service.linkCourtPayment({...input,dryRun:false})).unchanged,true); }
  const data = await repo.getSifupData();
  assert.equal(data.matches.length,7);
  assert.equal(data.clubExpenses.length,1);
  assert.equal(data.courtPayments.length,4);
  assert.equal(courtFinanceSummary(data,'2026-11').allocatedAmount,105000);
  assert.equal(courtFinanceSummary(data,'2026-11').cashPaid,0);
  assert.equal(courtFinanceSummary(data,'2026-10').consumedAmount,35000);
  assert.ok(data.matches.filter(row=>['2026-11-10','2026-11-17'].includes(row.date)).every(row=>row.status==='open' && row.notes===note));
  assert.equal(data.courtPayments.some(row=>row.sourceMatchId==='match-2026-10-20'),false);
  const ignore = row => { const copy={...row}; delete copy.updatedAt; delete copy.courtPrepaid; return copy; };
  assert.deepEqual(data.matches.filter(row=>original.some(old=>old.id===row.id)).map(ignore),original.map(ignore));
  assert.deepEqual(await snapshot(),before);
  const records = await call('get_match_records',{dates:entries.map(row=>row.date)});
  assert.equal(records.records.length,5);
  await assert.rejects(service.scheduleMatches({entries:[entries[0]],dryRun:false}),/vinculado/);
  // Render the real list both with original next date and provisional next date.
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MatchesList } = load('src/components/admin/MatchesList.tsx', name => name==='next/link' ? {default: props=>React.createElement('a',props)} : name.startsWith('@/lib/') ? require(path.join(root,'src/lib',name.slice(6))) : require(name));
  for (const today of ['2026-10-29','2026-11-04']) {
    const html = renderToStaticMarkup(React.createElement(MatchesList,{data,today}));
    assert.equal(html.split(note).length-1,2);
    assert.ok(html.includes('Recinto no disponible'));
    if (process.env.ARTIFACT_DIR) {
      fs.mkdirSync(process.env.ARTIFACT_DIR,{recursive:true});
      const cssDir = path.join(root,'.next/static/chunks');
      const css = fs.readdirSync(cssDir).filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync(path.join(cssDir,file),'utf8')).join('\n');
      fs.writeFileSync(path.join(process.env.ARTIFACT_DIR,`list-${today}.html`),`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body style="padding:16px;background:#05140e;color:white"><p>FIXTURE SINTÉTICA · candidato de agenda provisional</p>${html}</body></html>`);
    }
  }
  console.log('PASS: isolated PostgreSQL + actual MCP transport, atomic agenda rollback/retry, unique cross-month expense, two provisional transfers, no duplicated original reservation, protected payments/rosters/results, list/hero notices. Synthetic fixtures only.');
} finally { await db.close(); }
