import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
const options={entryPoints:['base44/shared/jobKnowledgeEntry.ts'],bundle:true,platform:'neutral',format:'esm',external:['npm:*','base44:*'],write:false,logLevel:'silent'};
const bundled=()=>buildSync(options).outputFiles[0].text;
const jobs=[{id:'job16',canonical_name:'Acme - Pine Grove lot 16',builder:'Acme',po_numbers:['0016'],oe_numbers:['OE16']},{id:'job17',canonical_name:'Acme - Pine Grove lot 17',builder:'Acme',po_numbers:['0017'],oe_numbers:['OE17']}];
function setup(user={role:'admin',email:'gabefronk@gmail.com'}) {
  let handler;const calls=[];
  const entities=new Proxy({}, {get:(_t,name)=>({list:async()=>{calls.push(name+'.list');assert.equal(name,'Jobs');return jobs;},filter:async()=>{calls.push(name+'.filter');if(name==='Jobs')return jobs;assert.equal(name,'JobKnowledgeRun');return [];},create:()=>assert.fail('write'),update:()=>assert.fail('write'),delete:()=>assert.fail('write')})});
  const source=bundled().replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source,{createClientFromRequest:()=>({auth:{me:async()=>user},asServiceRole:{entities}}),Deno:{serve:fn=>{handler=fn;}},Response,TextEncoder,structuredClone,URL,console,fetch:()=>assert.fail('network'),secrets:()=>assert.fail('secrets'),XLSX:{}});
  return {calls,invoke:async(body,method='POST')=>{const r=await handler(new Request('https://app.test/job-knowledge',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})}));return {status:r.status,data:await r.json()};}};
}
test('research endpoint refuses nonowner and wrong method before reading source data',async()=>{
  for(const user of [null,{role:'user',email:'someone@example.com'}]){const h=setup(user),r=await h.invoke({action:'plan_research'});assert.equal(r.status,403);assert.equal(h.calls.length,0);}
  const h=setup();assert.equal((await h.invoke({},'GET')).status,405);assert.equal(h.calls.length,0);
});
test('research endpoint uses exact saved identity and no provider, model or record writes',async()=>{
  const h=setup(),r=await h.invoke({action:'plan_research',query:{job_id:'job16'},research:{purpose:'documents'}});
  assert.equal(r.status,200);assert.equal(r.data.research_plan.identity.job_id,'job16');assert.equal(r.data.research_plan.identity.canonical_name,jobs[0].canonical_name);
  assert.equal(r.data.research_plan.dispatched,false);assert.equal(r.data.research_plan.automatic_send_allowed,false);
  assert.deepEqual(h.calls,['Jobs.filter','JobKnowledgeRun.filter']);
});
test('conflicting order never causes a preparation read or source research',async()=>{
  const h=setup(),r=await h.invoke({action:'plan_research',query:{job_id:'job16',po:'0017'},research:{purpose:'documents'}});
  assert.equal(r.data.lookup.status,'conflict');assert.equal(r.data.research_plan.status,'blocked');assert.equal(r.data.research_plan.steps.length,0);assert.deepEqual(h.calls,['Jobs.filter']);
});
test('fully specified missing lot can be researched provisionally without creating a job',async()=>{
  const h=setup(),r=await h.invoke({action:'plan_research',query:{builder:'Acme',subdivision:'Pine Grove',lot:'999'},research:{purpose:'documents'}});
  assert.equal(r.data.research_plan.status,'provisional_lookup');assert.equal(r.data.research_plan.identity.job_id,null);assert.equal(r.data.research_plan.auto_attach_to_job,false);assert.deepEqual(h.calls,['Jobs.filter']);
});
test('existing lookup response remains separate and research dates do not alter identity query',async()=>{
  const h=setup(),r=await h.invoke({action:'lookup_prepared',query:{job_id:'job16'}});
  assert.equal(r.data.status,'not_prepared');assert.equal(r.data.research_plan,undefined);
  const p=await h.invoke({action:'plan_research',query:{job_id:'job16'},research:{purpose:'installation_schedule',start_date:'2026-08-01',end_date:'2026-08-05'}});
  assert.equal(p.data.research_plan.date_scope.start_date,'2026-08-01');assert.equal(p.data.research_plan.identity.job_id,'job16');
});
test('published job-knowledge entry includes the tested source bundle',()=>assert.ok(fs.readFileSync('base44/functions/job-knowledge/entry.ts','utf8').includes(bundled())));
