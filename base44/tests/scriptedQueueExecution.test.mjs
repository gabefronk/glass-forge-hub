import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createScriptedQueueExecution, needsOnlineQuote } from '../shared/scriptedQueueExecution.js';
import { createScriptedRunnerHandler } from '../shared/scriptedRunnerHandler.js';
import { sha256, publicQuote, publicMessages } from '../shared/windowQuotesCore.js';
import { buildQuotePlan, verifyObservedQuote } from '../shared/amscoQuotePlan.js';
import { normalizeEasyRequest } from '../shared/easyRequest.js';
globalThis.crypto ??= webcrypto;
const KEY = 'synthetic-queue-test-key-never-live';
const clone = value => structuredClone(value);
const matches = (row, query) => Object.entries(query).every(([key, value]) => { const actual = key.split('.').reduce((item, part) => item?.[part], row); return value && typeof value === 'object' && '$gte' in value ? actual >= value.$gte : actual === value; });
async function fixture(options = {}) {
  let time = Date.parse('2026-09-07T08:00:00Z'), sequence = 0;
  const input = JSON.parse(fs.readFileSync(new URL('./fixtures/amsco-scripted-benchmark.json', import.meta.url), 'utf8'));
  const make = id => ({ ...clone(input), id, request_id: 'new-' + id, requester_email: 'gabefronk@gmail.com', created_date: new Date(time).toISOString(), input_revision: 1, state_version: 0, worker_status: 'draft', sales_status: 'open', history: [], conversation: [] });
  const config = { enabled: true, mode: 'queue', queue_allow: { requester_email: 'gabefronk@gmail.com', dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', created_after: '2026-09-07T07:00:00Z' }, worker_id: 'new-worker', browser_slot_id: 'shared-slot', worker_key_hash: await sha256(KEY), ...options.config };
  const rows = { QuoteRequests: [make('first')], QuoteWorkers: [{ id: config.worker_id, enabled: true, token_hash: config.worker_key_hash, allowed_dealers: ['BFS'] }, { id: config.browser_slot_id, name: 'Base44 Window Quotes browser', busy_token: '', active_quote_id: '', poll_generation: 0 }] };
  const db = Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, {
    async filter(query, sort, limit = 1000) { let found = records.filter(row => matches(row, query)); if (sort) found = [...found].sort((a,b) => String(a[sort] || '').localeCompare(String(b[sort] || ''))); return clone(found.slice(0,limit)); },
    async updateMany(query, patch) { let updated=0; for (const row of records) if(matches(row,query)){Object.assign(row,clone(patch.$set));updated++;}return{updated}; }
  }]));
  const execution = createScriptedQueueExecution({ config, normalizeRequest: buildQuotePlan, validateReady: verifyObservedQuote, now: () => new Date(time), uuid: () => 'nonce-' + ++sequence, ...options });
  const user = { role: 'admin', email: config.queue_allow.requester_email }, worker = rows.QuoteWorkers[0];
  const q = (id='first') => rows.QuoteRequests.find(row=>row.id===id);
  const prepare = (id='first', action='create') => execution.afterInput({db,q:clone(q(id)),user,action});
  const claim = (id='first', claim_id='claim-'+id) => execution.claim({db,worker,body:{quote_id:id,input_revision:q(id).input_revision,claim_id}});
  const poll = (extra={}) => execution.poll({db,worker,body:{action:'poll',runner_id:'daemon-one',runner_status:'idle',browser:{state:'authenticated',dealer:'BFS'},...extra}});
  const body = (id='first',extra={}) => ({quote_id:id,input_revision:q(id).input_revision,operation_id:q(id).agent_run.operation_id,execution_token:q(id).agent_run.execution_token,plan_hash:q(id).agent_run.plan_hash,event_id:'event-'+ ++sequence,...extra});
  const handler = createScriptedRunnerHandler({getClient:async()=>({asServiceRole:{entities:db}}),execution});
  const http = (payload,key=KEY) => handler(new Request('https://example.test/runner',{method:'POST',headers:{'Content-Type':'application/json',...(key?{'X-Quote-Worker-Key':key}:{})},body:JSON.stringify(payload)}));
  return {execution,config,rows,db,worker,user,q,make,prepare,claim,poll,body,http,advance:ms=>time+=ms};
}

test('queue remains disabled by default and requires fixed authorized owner/yard/cutover', async()=>{
  const disabled=createScriptedQueueExecution(); assert.equal(disabled.configured,false);
  for(const queue_allow of [{},{requester_email:'other@example.test',dealer:'BFS',yard:'BFS-UTAH DESIGN (11)',created_after:'2026-09-07'}]) await assert.rejects(fixture({config:{enabled:true,mode:'queue',queue_allow}}),error=>error.status===503);
});
test('fresh requests prepare separate immutable plans; poll returns one without claiming or leaking capabilities', async()=>{
  const f=await fixture();f.rows.QuoteRequests.push(f.make('second'));await f.prepare();await f.prepare('second');
  assert.notEqual(f.q().agent_run.plan_hash,f.q('second').agent_run.plan_hash);
  const picked=await f.poll();assert.equal(picked.status,'queued');assert.equal(picked.quote.quote_id,'first');assert.equal(picked.quote.execution_token,undefined);assert.equal(f.q().worker_status,'queued');assert.equal(f.rows.QuoteWorkers[1].busy_token,'');
  assert.equal(publicQuote(f.q()).agent_run,undefined);const version=f.q().state_version;await f.prepare();assert.equal(f.q().state_version,version);
});
test('poll is authenticated and validates bounded nonsensitive browser/attention status',async()=>{
  const f=await fixture();const payload={action:'poll',runner_id:'one',browser:{state:'authenticated',dealer:'BFS'}};
  for(const key of [null,'short','another-sufficiently-long-wrong-key'])assert.equal((await f.http(payload,key)).status,401);
  assert.equal(f.worker.runner_presence,undefined);
  for(const change of [{browser:{state:'authenticated',dealer:'BTB'}},{browser:{state:'unknown',url:'https://example.test'}},{runner_status:'arbitrary'}])assert.equal((await f.http({...payload,...change})).status,400);
  assert.equal((await f.http(payload)).status,200);assert.equal(f.worker.runner_presence.runner_id,'one');
});
test('pre-cutover, different owner, failed/native/history, and other provider requests cannot enter queue',async()=>{
  for(const change of [q=>q.created_date='2026-09-01T00:00:00Z',q=>q.created_date=null,q=>q.requester_email='other@example.test',q=>q.worker_status='failed',q=>q.execution_provider='superagent',q=>q.checkpoint={native_quote_number:'3516424'},q=>q.history=[{worker_status:'running'}],q=>q.result={verified:true}]){const f=await fixture();change(f.q());await assert.rejects(f.prepare(),e=>[403,409].includes(e.status));assert.equal(f.rows.QuoteWorkers[1].busy_token,'');}
});
test('missing or unsupported product choices and unsupported dealer/yard require clarification without browser ownership',async()=>{
  for(const change of [q=>delete q.lines[0].options.glass,q=>q.lines[0].style='casement',q=>q.settings.dealer='BTB',q=>q.settings.yard='OTHER (12)']){const f=await fixture();change(f.q());await f.prepare();assert.equal(f.q().worker_status,'needs_details');assert.ok(f.q().missing_details[0].length>20);assert.equal((await f.poll()).quote,null);assert.equal(f.rows.QuoteWorkers[1].busy_token,'');}
});
test('intake normalization persists only validated settings/lines before freeze and preserves original source',async()=>{
  const f=await fixture({normalizeIntake:quote=>({ok:true,quote:{...quote,settings:{...quote.settings,gross_margin:20},source:{changed:true}}})});f.q().source={original:true};await f.prepare();assert.equal(f.q().settings.gross_margin,20);assert.equal(f.q().agent_run.plan.settings.gross_margin,20);assert.deepEqual(f.q().source,{original:true});
  const g=await fixture({normalizeIntake:quote=>({ok:false,quote,questions:['Please choose CozE or LowE glass.']})});await g.prepare();assert.equal(g.q().worker_status,'needs_details');assert.equal(g.q().agent_run,undefined);
});
test('tampered queued inputs/plans are blocked before native claim',async()=>{
  const f=await fixture();await f.prepare();f.q().lines[0].width=39;assert.equal((await f.poll()).status,'blocked');await assert.rejects(f.claim(),e=>e.status===409);assert.equal(f.rows.QuoteWorkers[1].busy_token,'');
  const g=await fixture();await g.prepare();g.q().agent_run.plan.lines[0].qty=99;await assert.rejects(g.claim(),e=>e.status===409);
});
test('concurrent different-request claims share one browser and never take over an expired execution',async()=>{
  const f=await fixture();f.rows.QuoteRequests.push(f.make('second'));await f.prepare();await f.prepare('second');
  const both=await Promise.allSettled([f.claim(),f.claim('second')]);assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
  f.advance(700000);assert.equal((await f.poll()).status,'blocked');await assert.rejects(f.claim('second','new-process'),e=>e.status===409);
});
test('idle status reports actual authenticated check-in and expires browser report separately from operation heartbeat',async()=>{
  const f=await fixture();assert.equal((await f.execution.getStatus({db:f.db})).online,false);await f.poll();let status=await f.execution.getStatus({db:f.db});assert.equal(status.online,true);assert.equal(status.browser_authenticated,true);assert.equal(status.browser_state_source,'runner_report');
  await f.prepare();await f.claim();f.advance(110000);await f.execution.heartbeat({db:f.db,worker:f.worker,body:f.body()});status=await f.execution.getStatus({db:f.db});assert.equal(status.online,true);assert.equal(status.runner_status,'running');assert.equal(status.browser_authenticated,null);f.advance(110000);assert.equal((await f.execution.getStatus({db:f.db})).online,false);
});
test('attention/stopping/sign-in polls cannot pick a job and never clear the shared lock',async()=>{
  const f=await fixture();await f.prepare();for(const runner_status of ['attention','stopping','running'])assert.equal((await f.poll({runner_status,attention:{quote_id:'first',input_revision:1,code:'native_state_uncertain'}})).status,'blocked');
  await f.poll({runner_status:'stopping',browser:{state:'unknown'}});const stopped=await f.execution.getStatus({db:f.db});assert.equal(stopped.online,false);assert.equal(stopped.runner_status,'stopping');assert.ok(stopped.last_seen_at);
  assert.equal((await f.poll({browser:{state:'needs_sign_in'}})).status,'needs_sign_in');assert.equal(f.q().worker_status,'queued');
});
test('explicit pre-native sign-in retry advances revision and rejects old capabilities; missing evidence does not retry',async()=>{
  const f=await fixture();await f.prepare();await f.claim();const terminal=f.body('first',{action:'report',status:'needs_sign_in',native_started:false,message:'Sign in to the configured browser.'});await f.execution.report({db:f.db,worker:f.worker,body:terminal});
  assert.equal(f.rows.QuoteWorkers[1].busy_token,'');await f.prepare('first','queue');assert.equal(f.q().input_revision,2);assert.equal(f.q().worker_status,'queued');await f.claim('first','new-revision-claim');await assert.rejects(f.execution.report({db:f.db,worker:f.worker,body:terminal}),e=>e.status===403);
  const g=await fixture();await g.prepare();await g.claim();await g.execution.report({db:g.db,worker:g.worker,body:g.body('first',{status:'needs_sign_in',message:'Sign in.'})});await assert.rejects(g.prepare('first','queue'),e=>e.status===409);
});
test('safe sign-in retry requires released ownership and cannot be triggered by message or normal create',async()=>{
  const f=await fixture();await f.prepare();await f.claim();await f.execution.report({db:f.db,worker:f.worker,body:f.body('first',{status:'needs_sign_in',native_started:false,message:'Sign in.'})});
  await assert.rejects(f.prepare('first','message'),e=>e.status===409);f.rows.QuoteWorkers[1].busy_token='unresolved-operation';await assert.rejects(f.prepare('first','queue'),e=>e.status===409);assert.equal(f.q().input_revision,1);
});

test('queue Ready still needs a saved checkpoint and verified observed prices; completed quote stays readable while next request is isolated',async()=>{
  const f=await fixture();await f.prepare();await f.claim();
  const nativeId='12345678-1234-1234-1234-123456789abc',url='https://amsco.wtsparadigm.com/quotes/'+nativeId+'/line-items';
  const identities=f.q().agent_run.plan.lines.map((line,index)=>({source_index:index,native_line_id:'line-'+index,native_line_number:String((index+1)*100)}));
  const lines=f.q().agent_run.plan.lines.map((line,index)=>({...clone(line),...identities[index],gross_margin:29.71,unit_prices:{list:200,dealer:100,customer:142.27},line_totals:{list:200*line.qty,dealer:100*line.qty,customer:142.27*line.qty}}));
  const observed={quote_id:'first',input_revision:1,native_quote_id:nativeId,native_quote_number:'NEW-TEST',native_quote_url:url,reopened:true,checked_at:'2026-09-07T08:00:00Z',dealer:'BFS',yard:f.q().settings.yard,gross_margin:29.71,lines,totals:{list_total:400,dealer_cost:200,customer_total:284.54,currency:'USD',tax:0,freight:0,labor:0}};
  await assert.rejects(f.execution.report({db:f.db,worker:f.worker,body:f.body('first',{status:'ready',observed})}),e=>e.status===400);
  await f.execution.checkpoint({db:f.db,worker:f.worker,body:f.body('first',{action:'checkpoint',checkpoint:{native_quote_id:nativeId,native_quote_number:'NEW-TEST',native_quote_url:url,saved_lines:identities}})});
  const wrong=clone(observed);wrong.lines[0].unit_prices.customer=1;await assert.rejects(f.execution.report({db:f.db,worker:f.worker,body:f.body('first',{status:'ready',observed:wrong})}),e=>e.status===400);
  const terminal=f.body('first',{action:'report',status:'ready',observed});await f.execution.report({db:f.db,worker:f.worker,body:terminal});assert.equal(publicQuote(f.q()).worker_status,'ready');assert.equal(publicQuote(f.q()).result.totals.customer_total,284.54);
  f.rows.QuoteRequests.push(f.make('second'));await f.prepare('second');await f.claim('second');const secondOwner=f.rows.QuoteWorkers[1].busy_token;await f.execution.report({db:f.db,worker:f.worker,body:terminal});assert.equal(f.rows.QuoteWorkers[1].busy_token,secondOwner);
  await assert.rejects(f.execution.report({db:f.db,worker:f.worker,body:{...terminal,quote_id:'second'}}),e=>e.status===403);
});

test('real easy-request helper converts confirmed size notes into persisted strict queue lines',async()=>{
  const f=await fixture({normalizeIntake:normalizeEasyRequest});
  f.q().lines=[];f.q().settings={...f.q().settings,color:'Taupe',glass:'CozE (LowE)'};
  f.q().source={easy_request:{profile_id:'studio-sh-standard',profile_revision:1,confirmed:true,dimension_basis:'call',units:'in'}};
  f.q().conversation=[{role:'user',content:'1 3050; 1 3060',revision:1,kind:'initial_request'}];
  await f.prepare();assert.equal(f.q().worker_status,'queued',JSON.stringify(f.q().missing_details));assert.deepEqual(f.q().lines.map(line=>[line.width,line.height,line.qty]),[[36,60,1],[36,72,1]]);
  assert.equal(f.q().agent_run.plan.lines[0].options.color,'Taupe');assert.equal((await f.poll()).status,'queued');
});

test('a fresh explicit clarification reply fills missing color and queues its new revision without losing parsed dimensions',async()=>{
  const f=await fixture({normalizeIntake:normalizeEasyRequest});f.q().lines=[];f.q().settings={...f.q().settings,glass:'CozE (LowE)'};
  f.q().source={easy_request:{profile_id:'studio-sh-standard',profile_revision:1,confirmed:true,dimension_basis:'call',units:'in'}};
  f.q().conversation=[{role:'user',content:'1 3050',revision:1,kind:'initial_request'}];await f.prepare();assert.equal(f.q().worker_status,'needs_details');assert.equal(f.q().lines[0].width,36);
  f.q().input_revision=2;f.q().state_version++;f.q().worker_status='draft';f.q().conversation.push({role:'user',content:'Taupe',revision:2,kind:'clarification_reply'});
  await f.prepare('first','message');assert.equal(f.q().worker_status,'queued',JSON.stringify(f.q().missing_details));assert.equal(f.q().agent_run.plan.input_revision,2);assert.equal(f.q().agent_run.plan.lines[0].options.color,'Taupe');assert.equal(f.q().lines[0].height,60);
});

test('invalid partially parsed rows preserve original input and still return clarification',async()=>{
  const f=await fixture({normalizeIntake:quote=>({ok:false,quote:{...quote,lines:[{qty:0,width:36,height:60}]},questions:['Supply a positive whole-number quantity for the first line.']})});
  const original=clone(f.q().lines);await f.prepare();assert.equal(f.q().worker_status,'needs_details');assert.deepEqual(f.q().lines,original);assert.equal(f.q().missing_details.length,1);
});
test('combined scope and parser questions are deduplicated and capped rather than failing intake',async()=>{
  const f=await fixture({normalizeIntake:quote=>({ok:false,quote,questions:Array.from({length:30},(_,i)=>'Clarify required field '+i+'.')})});
  f.q().settings.yard='OTHER (12)';await f.prepare();assert.equal(f.q().worker_status,'needs_details');assert.equal(f.q().missing_details.length,30);assert.match(f.q().missing_details[29],/complete schedule preview/);
});

test('conversational review persists interpreted lines and readable assessment without claiming the browser',async()=>{
  const assessment={input_revision:1,status:'product_review',summary:'Two sliders with different fins and a tempered picture window.',assumptions:[],questions:['Are these call sizes?'],product_review:['Slider and picture configurations need AMSCO product support.']};
  const f=await fixture({normalizeIntake:quote=>({ok:false,quote:{...quote,lines:[{qty:1,width:60,height:60,style:'XO Slider',units:'in',options:{fin:'Flush Fin'}}]},questions:[...assessment.questions,...assessment.product_review],intake_assessment:assessment,assistant_message:assessment.summary+'\n'+assessment.questions[0]})});
  await f.prepare();assert.equal(f.q().worker_status,'needs_details');assert.equal(f.q().lines[0].style,'XO Slider');assert.deepEqual(publicQuote(f.q()).intake_assessment,assessment);assert.match(publicMessages(f.q())[0].content,/Two sliders/);assert.equal(f.rows.QuoteWorkers[1].busy_token,'');assert.equal(f.q().agent_run,undefined);
});

test('supported conversational intake records an interpretation then freezes the checked plan',async()=>{
  const f=await fixture({normalizeIntake:quote=>({ok:true,quote,questions:[],intake_assessment:{input_revision:1,status:'ready',summary:'I understand the two single hung windows.',assumptions:[],questions:[],product_review:[]},assistant_message:'I understand the two single hung windows. Pricing will be checked in AMSCO.'})});
  await f.prepare();assert.equal(f.q().worker_status,'queued');assert.equal(f.q().result,undefined);assert.equal(f.q().agent_run.plan.lines.length,2);assert.equal(publicMessages(f.q())[0].kind,'intake_summary');
});

test('slow AI result cannot overwrite a newer reply or manually edited revision',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve);let started;const began=new Promise(resolve=>started=resolve);
  const f=await fixture({normalizeIntake:async quote=>{started();await pending;return{ok:false,quote:{...quote,lines:[{qty:5,width:60,height:60}]},questions:['Confirm the window style.'],intake_assessment:{input_revision:1,status:'needs_details',summary:'Old result',assumptions:[],questions:[],product_review:[]}};}});
  const running=f.prepare();await began;f.q().input_revision=2;f.q().state_version++;const original=clone(f.q().lines);finish();await assert.rejects(running,e=>e.status===409);assert.deepEqual(f.q().lines,original);assert.equal(f.q().intake_assessment,undefined);assert.equal(f.q().agent_run,undefined);
});

test('AI outage keeps saved input and produces a retryable explanation without queuing',async()=>{
  const f=await fixture({normalizeIntake:quote=>({ok:false,quote,questions:['The AI is temporarily unavailable. Your request is saved; use Start quote to try again.'],intake_assessment:{input_revision:1,status:'unavailable',summary:'Your request is saved.',assumptions:[],questions:[],product_review:[]},assistant_message:'Your request is saved. Use Start quote to retry.'})});
  const original=clone(f.q().lines);await f.prepare();assert.deepEqual(f.q().lines,original);assert.equal(f.q().worker_status,'needs_details');assert.equal(f.q().agent_run,undefined);assert.equal(f.q().intake_assessment.status,'unavailable');
});

test('request client reaches AI intake only within authenticated user execution',async()=>{
  const client={integrations:{Core:{}}};let received;
  const f=await fixture({normalizeIntake:(quote,context)=>{received=context.client;return{ok:true,quote};}});
  await f.execution.afterInput({db:f.db,q:clone(f.q()),user:f.user,action:'create',client});assert.equal(received,client);
});

test('online fallback accepts only complete requests whose remaining issues are unmapped product paths', async()=>{
  assert.equal(needsOnlineQuote({ok:false,issues:[{code:'unsupported_product'},{code:'unsupported_colors'}]}, {questions:[]}), true);
  assert.equal(needsOnlineQuote({ok:false,issues:[{code:'unsupported_product'},{code:'invalid_dimensions'}]}, {questions:[]}), false);
  assert.equal(needsOnlineQuote({ok:false,issues:[{code:'unsupported_product'}]}, {questions:['Confirm the opening size.']}), false);
  assert.equal(needsOnlineQuote({ok:true,plan:{}}, {questions:[]}), false);
});

test('a complete unmapped window goes to online quoting while missing core data stays in clarification', async()=>{
  const calls=[];
  const fallbackExecution={configured:true,afterInput:async args=>{calls.push(args.q.id);return{...args.q,execution_provider:'superagent',worker_status:'queued'};}};
  const online=await fixture({fallbackExecution,normalizeRequest:()=>({ok:false,issues:[{code:'unsupported_product'}],questions:['This product is not in the fast price map.']})});
  const routed=await online.prepare();assert.equal(routed.execution_provider,'superagent');assert.equal(routed.worker_status,'queued');assert.deepEqual(calls,['first']);assert.equal(online.q().worker_status,'draft');
  const incomplete=await fixture({fallbackExecution,normalizeRequest:()=>({ok:false,issues:[{code:'invalid_dimensions'}],questions:['Line 1: Provide a positive numeric width in inches.']})});
  await incomplete.prepare();assert.equal(incomplete.q().execution_provider,'deterministic');assert.equal(incomplete.q().worker_status,'needs_details');assert.deepEqual(calls,['first']);
});
