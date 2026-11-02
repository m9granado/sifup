// Actual MatchesList rendered with explicit synthetic fixtures; no live DB/auth/network.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const root = process.cwd();
const require = createRequire(path.join(root,'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  if(cache.has(file)) return cache.get(file);
  const target={exports:{}};
  cache.set(file,target.exports);
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`,{filename:file})(name=>{
    if(name==='next/link') return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
    if(name==='next/navigation') return {useRouter:()=>({refresh(){}})};
    if(name==='@/app/actions') return {linkCourtPaymentAction:()=>{throw new Error('Business action forbidden in render check.');}};
    if(name.startsWith('@/') || name.startsWith('.')) {
      const base=name.startsWith('@/')?path.join(root,'src',name.slice(2)):path.resolve(path.dirname(file),name);
      return load(['.ts','.tsx'].map(ext=>base+ext).find(fs.existsSync));
    }
    return require(name);
  },target,target.exports);
  cache.set(file,target.exports);return target.exports;
}
const {MatchesList}=load(path.join(root,'src/components/admin/MatchesList.tsx'));
const dates=[['next','2026-11-03','confirmed'],['last','2026-10-27','played'],['suspended','2026-10-13','suspended'],['locked','2026-10-06','roster_locked'],['older','2026-09-29','played'],['oldest','2026-08-25','played']];
const data={matches:dates.map(([id,date,status])=>({id,date,status,time:'21:00',location:'Cancha sintética de QA',squadTarget:12,notes:status==='suspended'?'Suspendido por lluvia (fixture)':''})),matchPlayers:Array.from({length:8},(_,i)=>({id:`p${i}`,matchId:'next',attendanceStatus:'confirmed',amountDue:0,amountPaid:0})),results:[{matchId:'last',winner:'B'}]};
const html=renderToStaticMarkup(React.createElement(MatchesList,{data,today:'2026-10-29'}));
const financialData={...data,monthlyPayments:[{id:'synthetic-fee',monthKey:'2026-11',amountPaid:20000,paidDate:'2026-10-28'}],clubExpenses:[{id:'synthetic-court',category:'court',label:'Gasto sintético',expenseDate:'2026-10-01',amount:35000}]};
const {ClubCashCard}=load(path.join(root,'src/components/admin/ClubCashCard.tsx'));
const {CourtPaymentControls}=load(path.join(root,'src/components/admin/CourtPaymentControls.tsx'));
const cashHtml=renderToStaticMarkup(React.createElement(ClubCashCard,{data:financialData,cutoff:'2026-10-29'}));
assert.match(cashHtml,/Subtotal registrado del club · no conciliado/);
assert.ok(!cashHtml.includes('Plata disponible'));
assert.match(cashHtml,/No conciliada/);assert.match(cashHtml,/2026-10-29/);assert.match(cashHtml,/synthetic-fee/);
assert.equal(renderToStaticMarkup(React.createElement(CourtPaymentControls,{data:financialData,canEdit:false})), '');
const controlsHtml=renderToStaticMarkup(React.createElement(CourtPaymentControls,{data:financialData,canEdit:true}));
for(const label of ['Confirmado','Jugado','Suspendido','Lista cerrada']) assert.ok(controlsHtml.includes(label));
assert.ok(!controlsHtml.includes(' · confirmed') && !controlsHtml.includes(' · roster_locked'));
const workspaceSource=fs.readFileSync(path.join(root,'src/components/admin/SifupWorkspace.tsx'),'utf8');
assert.match(workspaceSource,/\{matchStatusLabel\(currentMatch.status\)\}<\/p>\s*<p[^>]+>Resultado pendiente/);
assert.match(controlsHtml,/Previsualizar sin escribir/);assert.ok(!controlsHtml.includes('Confirmar asignación previsualizada'));
for(const [id] of dates) assert.equal(html.split(`href="/matches/${id}"`).length-1,1);
assert.equal((html.match(/<details[^>]*open=""/g)||[]).length,2);
assert.equal((html.match(/<details/g)||[]).length,4);
assert.match(html,/8 \/ 12 jugadores/);
assert.match(html,/Lista cerrada/);assert.match(html,/Suspendido por lluvia/);
assert.ok(!/inscrib/i.test(html));
const cssDir=path.join(root,'.next/static/chunks');
const css=fs.readdirSync(cssDir).filter(name=>name.endsWith('.css')).map(name=>fs.readFileSync(path.join(cssDir,name),'utf8')).join('\n');
const out=process.argv[2];
if(!out)throw new Error('Pass an authorized scratch output HTML path.');
fs.writeFileSync(out,`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SIFUP matches — QA sintético local</title><style>${css}</style></head><body style="background:#030706;color:white;font-family:Arial,sans-serif"><main style="max-width:1100px;margin:auto;padding:24px"><p style="margin-bottom:20px;color:#fcd34d">QA LOCAL · Fixtures sintéticos · No captura de producción</p><h1 style="font-size:28px;font-weight:900;margin-bottom:8px">PARTIDOS</h1><p style="color:#cbd5e1;margin-bottom:24px">Tu próxima fecha y el historial del equipo, por mes.</p>${html}</main></body></html>`);
console.log('PASS: actual MatchesList static render; every fixture once; 2 open/4 accessible native months; status/notes; no enrollment CTA. Synthetic QA HTML: '+out);
const financialOut=out.replace(/\.html$/, '-payments.html');
assert.notEqual(financialOut,out);
fs.writeFileSync(financialOut,`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SIFUP pagos — QA sintético local</title><style>${css}</style></head><body style="background:#030706;color:white;font-family:Arial,sans-serif"><main style="max-width:1100px;margin:auto;padding:24px"><p style="margin-bottom:20px;color:#fcd34d">QA LOCAL · Fixtures sintéticos · Brief financiero no validado por Faro/Erina · No producción</p>${cashHtml}${controlsHtml}</main></body></html>`);
console.log('PASS: cash source/cutoff/provisional labels and permission-gated initial controls render. Interactions and real authorization are not certified. '+financialOut);
