// Bundle the real client component for isolated browser interaction checks.
// Uses the already-installed esbuild (tsx dependency); never connects to DB/auth/network.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
const output = process.argv[2];
if (!output) throw new Error('Pass an authorized scratch HTML path.');
const result = await build({
  stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CourtPaymentControls} from './src/components/admin/CourtPaymentControls';
const qa = window.qa = {calls:[],refreshes:0,mode:'ok',release:null,checks:[]};
const data = {clubExpenses:[{id:'qa-expense',category:'court',expenseDate:'2026-10-01',label:'SYNTHETIC',amount:35000}],matches:[{id:'qa-source',date:'2026-10-06',time:'21:00',status:'confirmed'},{id:'qa-other',date:'2026-10-13',time:'21:00',status:'suspended'}]};
const root = createRoot(document.getElementById('root'));
const wait = async predicate => {for(let n=0;n<200;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out waiting for React DOM');};
const assert = (ok,label) => {if(!ok)throw Error(label);qa.checks.push(label);};
const button = text => [...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
const change = async (element,value) => {element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,20));};
const tick = () => new Promise(r=>setTimeout(r,30));
const render = async canEdit => {root.render(<CourtPaymentControls key={String(canEdit)} data={data} canEdit={canEdit}/>);await tick();};
qa.run = async () => {
 await render(false);assert(!document.querySelector('section'),'no controls without canEdit');
 await render(true);await wait(()=>button('Previsualizar'));
 assert(button('Previsualizar').disabled,'initial preview disabled');
 const selects=document.querySelectorAll('select');await change(selects[0],'qa-expense');await change(selects[1],'qa-source');
 assert(button('Previsualizar').disabled,'evidence required');
 const evidence=()=>[...document.querySelectorAll('input[type=checkbox]')].at(-1);
 evidence().click();await tick();
 qa.mode='delay';button('Previsualizar').click();await wait(()=>qa.release);
 assert([...document.querySelectorAll('select,input,button')].every(e=>e.disabled),'busy disables inputs and actions');
 qa.release();await wait(()=>button('Confirmar'));
 assert(qa.calls.length===1 && qa.calls[0].dryRun===true,'preview never writes');
 await change(selects[1],'qa-other');assert(!button('Confirmar'),'changed input invalidates preview');
 await change(selects[1],'qa-source');
 assert(!evidence().checked,'changed input requires new evidence');
 evidence().click();await tick();qa.mode='deny';button('Previsualizar').click();await wait(()=>document.querySelector('[role=status]'));
 assert(document.querySelector('[role=status]').textContent.includes('permission denied'),'denied preview shows error');
 assert(!button('Confirmar'),'failed preview cannot confirm');
 qa.mode='ok';button('Previsualizar').click();await wait(()=>button('Confirmar'));
 button('Confirmar').click();await wait(()=>qa.refreshes===1);
 assert(qa.calls.at(-1).dryRun===false,'confirmation is explicit write');
 assert(!button('Confirmar') && !evidence().checked,'successful write clears preview and evidence');
 document.querySelector('input[type=checkbox]').click();await tick();
 assert(document.querySelector('input[type=date]'),'transfer uses native date');
 evidence().click();await tick();assert(button('Previsualizar').disabled,'transfer requires destination date');
 // Native date input needs the prototype setter for React change tracking.
 const date=document.querySelector('input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(date,'2026-11-03');date.dispatchEvent(new Event('input',{bubbles:true}));date.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 if(!evidence().checked){evidence().click();await tick();}
 button('Previsualizar').click();await wait(()=>button('Confirmar'));
 assert(qa.calls.at(-1).targetDate==='2026-11-03' && qa.calls.at(-1).dryRun,'transfer preview retains exact date');
 qa.mode='deny';button('Confirmar').click();await wait(()=>document.querySelector('[role=status]')?.textContent.includes('permission denied'));
 assert(!button('Confirmar') && qa.refreshes===1,'rejected confirmation clears preview without success refresh');
 return {status:'PASS',checks:qa.checks,calls:qa.calls,refreshes:qa.refreshes,limits:'Synthetic mounted real component; mocked action/router. Not Next E2E, real account authorization or multi-session DB concurrency.'};
};
`, resolveDir: process.cwd(), sourcefile: 'court-controls-qa.tsx', loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_SITE_URL': '"https://sifup.vercel.app"' },
  plugins: [{name:'isolated-business-boundary', setup(builder) {
    builder.onResolve({filter:/^(@\/app\/actions|next\/navigation)$/},args=>({path:args.path,namespace:'qa'}));
    builder.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:args.path==='next/navigation'
      ? 'export const useRouter=()=>({refresh(){window.qa.refreshes++}});'
      : `export async function linkCourtPaymentAction(input){const qa=window.qa;qa.calls.push(input);if(qa.mode==='delay'){await new Promise(resolve=>qa.release=resolve);qa.release=null;}if(qa.mode==='deny')throw Error('permission denied (synthetic)');return {payment:{amount:35000},source:{date:'2026-10-06'},target:{date:input.targetDate||'2026-10-06'},createTarget:!!input.targetDate};}` }));
  }}],
});
fs.mkdirSync(path.dirname(output), {recursive:true});
fs.writeFileSync(output, `<!doctype html><html lang="es"><meta charset="utf-8"><title>SIFUP isolated controls QA</title><body><p>SYNTHETIC QA · No live business actions</p><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`);
console.log('Browser harness built: '+output+'; open it and await window.qa.run().');
