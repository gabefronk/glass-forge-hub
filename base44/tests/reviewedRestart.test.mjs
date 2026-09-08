import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createScriptedQueueExecution } from '../shared/scriptedQueueExecution.js';
import { createScriptedRunnerHandler } from '../shared/scriptedRunnerHandler.js';
import { sha256, publicQuote, createQuoteHandler, sanitizePublic } from '../shared/windowQuotesCore.js';
import { reviewedRestartAllowsHistory, advanceReviewedRestart } from '../shared/reviewedRestart.js';
import { buildQuotePlan, verifyObservedQuote } from '../shared/amscoQuotePlan.js';
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

const NATIVE_ID = '90596d8a-c6e5-4613-8b9d-aa74c3925953';
async function failed(options = {}) {
  const f = await fixture(options);
  f.q().input_revision = 2;
  f.q().intake_assessment = { input_revision: 2, status: 'ready', line_provenance: [{ line_index: 0, derived_options: ['glass_thickness', 'super_spacer'] }] };
  await f.prepare(); await f.claim();
  if (options.native !== false) await f.execution.checkpoint({ db:f.db, worker:f.worker, body:f.body('first', {
    checkpoint:{ native_quote_id:NATIVE_ID, native_quote_number:'3516463', native_quote_url:'https://amsco.wtsparadigm.com/quotes/'+NATIVE_ID+'/line-items', saved_lines:[{source_index:0,native_line_id:'914607ee-b2e7-4a88-ae74-102544f13621',native_line_number:'100'}] }
  }) });
  const oldTerminal = f.body('first', {status:'failed',message:'Synthetic native constraint failure.'});
  await f.execution.report({db:f.db,worker:f.worker,body:oldTerminal});
  const original = clone(f.q());
  const retryBody = {action:'retry_failed',quote_id:'first',retry_id:'review-one',expected_revision:2,expected_state_version:f.q().state_version,expected_native_quote_id:options.native===false?null:NATIVE_ID,reviewed_previous_draft:true};
  const retry = (changes={}, user=f.user) => f.execution.afterInput({db:f.db,q:clone(f.q()),user,action:'retry_failed',body:{...retryBody,...changes}});
  f.db.QuoteMessages={filter:async()=>[],create:async data=>data};
  const handler=createQuoteHandler({executionService:f.execution,getClient:async req=>({asServiceRole:{entities:f.db},auth:{me:async()=>req.headers.get('test-role')==='anonymous'?null:{...f.user,role:req.headers.get('test-role')||'admin'}}})});
  const call=async(body,role='admin')=>{const response=await handler(new Request('https://example.test/windowQuotes',{method:'POST',headers:{'Content-Type':'application/json','test-role':role},body:JSON.stringify(body)}));return{status:response.status,...await response.json()};};
  return {...f,oldTerminal,original,retryBody,retry,call};
}

test('reviewed retry archives exact saved identities, preserves intake provenance, and claims a fresh operation with no checkpoint',async()=>{
  const f=await failed(); const oldRun=clone(f.q().agent_run), oldCheckpoint=clone(f.q().checkpoint);
  const restarted=await f.retry();
  assert.equal(restarted.id,f.original.id);assert.equal(restarted.request_id,f.original.request_id);assert.equal(restarted.input_revision,3);assert.equal(restarted.worker_status,'queued');
  assert.deepEqual(restarted.checkpoint,{});assert.deepEqual(restarted.intake_assessment,f.original.intake_assessment);
  assert.equal(restarted.history.length,1);const archive=restarted.history[0];
  assert.deepEqual(archive.checkpoint.saved_lines,oldCheckpoint.saved_lines);assert.equal(archive.checkpoint.native_quote_id,NATIVE_ID);
  assert.equal(archive.prior_operation.operation_id,oldRun.operation_id);assert.equal(archive.prior_operation.plan_hash,oldRun.plan_hash);
  assert.equal(archive.prior_operation.execution_token,undefined);assert.equal(archive.prior_operation.claim_id,undefined);assert.equal(archive.checkpoint.native_quote_url,undefined);
  assert.equal(await reviewedRestartAllowsHistory(restarted,sha256),true);
  assert.notEqual(restarted.agent_run.plan_hash,oldRun.plan_hash);assert.equal(restarted.agent_run.input_revision,3);assert.equal(f.rows.QuoteWorkers[1].busy_token,'');
  const {quote:claimed}=await f.claim('first','fresh-claim');assert.deepEqual(claimed.checkpoint,{});assert.notEqual(claimed.operation_id,oldRun.operation_id);assert.notEqual(claimed.execution_token,oldRun.execution_token);
  await assert.rejects(f.execution.checkpoint({db:f.db,worker:f.worker,body:f.body('first',{checkpoint:{...oldCheckpoint,input_revision:3}})}),e=>e.status===409);
  assert.deepEqual(f.q().checkpoint,{});
  await assert.rejects(f.execution.report({db:f.db,worker:f.worker,body:f.oldTerminal}),e=>e.status===403);
  assert.deepEqual(f.q().history[0].checkpoint.saved_lines,oldCheckpoint.saved_lines);
});

test('same review identifier is idempotent after queue and claim despite stale expected state',async()=>{
  const f=await failed();await f.retry();const version=f.q().state_version,plan=f.q().agent_run.plan_hash;
  await f.retry();assert.equal(f.q().state_version,version);assert.equal(f.q().history.length,1);assert.equal(f.q().agent_run.plan_hash,plan);
  await f.claim('first','new-claim');const running=clone(f.q());await f.retry();assert.deepEqual(f.q(),running);
  await assert.rejects(f.retry({expected_state_version:f.retryBody.expected_state_version+1}),e=>e.status===409);
  await assert.rejects(f.retry({retry_id:'another-review'}),e=>e.status===409);
});

test('concurrent matching reviews create one attempt; concurrent distinct review identifiers cannot both restart',async()=>{
  const f=await failed();const results=await Promise.allSettled([f.retry(),f.retry()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(f.q().input_revision,3);assert.equal(f.q().history.length,1);
  const g=await failed();const distinct=await Promise.allSettled([g.retry(),g.retry({retry_id:'other'})]);assert.equal(distinct.filter(r=>r.status==='fulfilled').length,1);assert.equal(g.q().history.length,1);
});

test('retry requires authenticated configured administrator, exact review identity, and unchanged revision',async()=>{
  for(const [change,user] of [
    [{}, {role:'member',email:'gabefronk@gmail.com'}], [{},{role:'admin',email:'other@example.test'}],
    [{expected_revision:1}], [{expected_state_version:999}], [{expected_native_quote_id:null}],
    [{reviewed_previous_draft:false}], [{retry_id:''}], [{retry_id:'../../arbitrary'}], [{reviewed_restart:{version:1}}]
  ]){const f=await failed();const original=clone(f.q());await assert.rejects(f.retry(change,user||f.user),e=>[400,403,409].includes(e.status));assert.deepEqual(f.q(),original);}
  const f=await failed();assert.equal((await f.call(f.retryBody,'anonymous')).status,401);assert.equal((await f.call(f.retryBody,'member')).status,403);
  await f.retry();await assert.rejects(f.retry({}, {role:'admin',email:'other@example.test'}),e=>e.status===403);
});

test('prior operation must be completed failed, unchanged, released, and without result or accepted work',async()=>{
  const changes=[
    q=>q.worker_status='running',q=>q.agent_run.phase='running',q=>q.agent_run.terminal_status='needs_sign_in',
    q=>q.agent_run.input_revision=1,q=>q.agent_run.operation_id='',q=>q.agent_run.worker_id='other',q=>q.agent_run.queue_scope_hash='0'.repeat(64),
    q=>q.agent_run.plan.lines[0].qty=100,q=>q.agent_run.completed_at='',q=>q.result={verified:true},q=>q.job_id='job-one',
    q=>q.accepted_revision=2,q=>q.sales_status='won',q=>q.accepted_snapshot={},
    q=>q.conversion_token='in-progress',q=>{q.lease_token='legacy';q.lease_expires_at='2099-01-01T00:00:00Z';}
  ];
  for(const change of changes){const f=await failed();change(f.q());const original=clone(f.q());await assert.rejects(f.retry(),e=>e.status===409);assert.deepEqual(f.q(),original);}
  for(const slot of [{busy_token:'old-owner'},{active_quote_id:'first'},{busy_token:'other-owner',active_quote_id:'other'}]){const f=await failed();Object.assign(f.rows.QuoteWorkers[1],slot);await assert.rejects(f.retry(),e=>e.status===409);assert.equal(f.q().input_revision,2);}
});

test('malformed, duplicate, or foreign-revision checkpoints cannot be archived as a reviewed restart',async()=>{
  const changes=[
    q=>q.checkpoint.input_revision=1,q=>q.checkpoint.native_quote_number='not-a-number',
    q=>q.checkpoint.saved_lines[0].source_index=999,q=>q.checkpoint.saved_lines[0].native_line_id='',
    q=>q.checkpoint.saved_lines[0].native_line_number='0',q=>q.checkpoint.saved_lines.push(clone(q.checkpoint.saved_lines[0])),
    q=>q.checkpoint.saved_lines=null
  ];
  for(const change of changes){const f=await failed();change(f.q());await assert.rejects(f.retry(),e=>e.status===409);assert.equal(f.q().input_revision,2);}
});

test('public responses hide restart authority/capabilities while exposing only review and previous draft metadata',async()=>{
  const f=await failed();const before=publicQuote(f.q());assert.equal(before.retry_review.expected_revision,2);assert.equal(before.retry_review.native_quote_id,NATIVE_ID);
  await f.retry();const shown=publicQuote(f.q());
  assert.equal(shown.reviewed_restart,undefined);assert.equal(shown.history,undefined);assert.equal(shown.agent_run,undefined);assert.equal(shown.checkpoint,undefined);assert.equal(shown.retry_review,undefined);
  assert.deepEqual(shown.previous_attempts,[{revision:2,native_quote_number:'3516463',reviewed_at:f.q().history[0].recorded_at}]);
  assert.deepEqual(sanitizePublic({source:{reviewed_restart:{attempt_id:'forged'}},'reviewed-restart':{attempt_id:'forged'}}),{source:{}});
  const schema=JSON.parse(fs.readFileSync(new URL('../entities/QuoteRequests.jsonc',import.meta.url),'utf8'));
  assert.deepEqual(schema.properties.reviewed_restart.rls,{read:false,write:false});assert.deepEqual(schema.rls.update,{user_condition:{role:'admin'}});
});

test('tampering the reviewed history, marker scope, attempt or revision fails closed before claim',async()=>{
  for(const change of [
    q=>q.history[0].checkpoint.saved_lines[0].native_line_number='200',q=>q.reviewed_restart.queue_scope_hash='0'.repeat(64),
    q=>q.reviewed_restart.attempt_id='forged',q=>q.reviewed_restart.input_revision=999,q=>q.history.push({worker_status:'running'}),
    q=>q.history.push({checkpoint:{native_quote_id:NATIVE_ID}}),q=>q.checkpoint={native_quote_id:NATIVE_ID}
  ]){const f=await failed();await f.retry();change(f.q());await assert.rejects(f.claim('first','blocked'),e=>e.status===409);assert.equal(f.rows.QuoteWorkers[1].busy_token,'');}
});

test('ordinary inputs cannot authorize native history or override the private marker',async()=>{
  const f=await failed();const before=clone(f.q());const forged={version:1,quote_id:'first',input_revision:3,from_revision:2,attempt_id:'fake'};
  assert.equal((await f.call({action:'update',quote_id:'first',title:'Changed',reviewed_restart:forged})).status,409);assert.deepEqual(f.q(),before);
  assert.equal((await f.call({action:'message',quote_id:'first',message:'Retry it',client_message_id:'ordinary-message',reviewed_previous_draft:true})).status,409);assert.deepEqual(f.q(),before);
  const g=await fixture();g.q().history=[{worker_status:'failed',checkpoint:{native_quote_id:NATIVE_ID}}];g.q().source={reviewed_restart:forged,reviewed_previous_draft:true};
  await assert.rejects(g.prepare(),e=>e.status===409);
});

test('reviewed fresh attempts can clarify and edit before native execution without losing authority or provenance',async()=>{
  let clarify=false, received;
  const f=await failed({normalizeIntake:q=>{received=clone(q.intake_assessment);return clarify?{ok:false,quote:q,questions:['Please confirm the room.']}:{ok:true,quote:q};}});
  clarify=true;await f.retry();assert.equal(f.q().worker_status,'needs_details');assert.deepEqual(received,f.original.intake_assessment);
  const updated=await f.call({action:'update',quote_id:'first',title:'Corrected title',reviewed_restart:{attempt_id:'forged'}});
  assert.equal(updated.status,200,JSON.stringify(updated));assert.equal(f.q().input_revision,4);assert.equal(f.q().reviewed_restart.input_revision,4);assert.notEqual(f.q().reviewed_restart.attempt_id,'forged');
  clarify=false;const replied=await f.call({action:'message',quote_id:'first',message:'Bedroom',client_message_id:'room-reply'});
  assert.equal(replied.status,200,JSON.stringify(replied));assert.equal(f.q().input_revision,5);assert.equal(f.q().worker_status,'queued');assert.equal(f.q().reviewed_restart.input_revision,5);
  assert.equal(await reviewedRestartAllowsHistory(f.q(),sha256),true);assert.equal(f.q().history[0].checkpoint.native_quote_id,NATIVE_ID);
});

test('pre-native sign-in recovery preserves reviewed history and advances identity, but native-started sign-in cannot',async()=>{
  const f=await failed();await f.retry();await f.claim('first','retry-claim');
  const login=f.body('first',{status:'needs_sign_in',native_started:false,message:'Sign in to the paired browser.'});await f.execution.report({db:f.db,worker:f.worker,body:login});
  await f.prepare('first','queue');assert.equal(f.q().input_revision,4);assert.equal(f.q().worker_status,'queued');assert.equal(f.q().reviewed_restart.input_revision,4);assert.equal(f.q().history[0].checkpoint.native_quote_id,NATIVE_ID);
  await f.claim('first','signed-in-claim');await assert.rejects(f.execution.report({db:f.db,worker:f.worker,body:login}),e=>e.status===403);
  const g=await failed();await g.retry();await g.claim('first','retry-claim');await g.execution.report({db:g.db,worker:g.worker,body:g.body('first',{status:'needs_sign_in',message:'Sign in.'})});
  await assert.rejects(g.prepare('first','queue'),e=>e.status===409);
});

test('failed attempt without native creation is supported and an interrupted intake retry remains idempotent',async()=>{
  let outage=false;
  const f=await failed({native:false,normalizeIntake:q=>{if(outage)throw new Error('Synthetic intake outage');return{ok:true,quote:q};}});
  outage=true;await assert.rejects(f.retry(),/Synthetic intake outage/);assert.equal(f.q().input_revision,3);assert.equal(f.q().worker_status,'draft');assert.equal(f.q().history.length,1);
  await f.retry();assert.equal(f.q().input_revision,3);outage=false;await f.prepare('first','queue');assert.equal(f.q().worker_status,'queued');assert.deepEqual(f.q().checkpoint,{});
});

test('after a second native failure the previous review cannot authorize a third attempt without a new review',async()=>{
  const f=await failed();await f.retry();await f.claim('first','second-attempt');
  const secondNative='22345678-1234-1234-1234-123456789abc';
  await f.execution.checkpoint({db:f.db,worker:f.worker,body:f.body('first',{checkpoint:{native_quote_id:secondNative,native_quote_number:'3516464',native_quote_url:'https://amsco.wtsparadigm.com/quotes/'+secondNative+'/line-items',saved_lines:[]}})});
  await f.execution.report({db:f.db,worker:f.worker,body:f.body('first',{status:'failed',message:'Second synthetic failure.'})});
  await assert.rejects(f.prepare('first','queue'),e=>e.status===409);
  assert.deepEqual(await advanceReviewedRestart(f.q(),4,sha256),{});
  await f.retry({retry_id:'review-two',expected_revision:3,expected_state_version:f.q().state_version,expected_native_quote_id:secondNative});
  assert.equal(f.q().input_revision,4);assert.equal(f.q().history.length,2);assert.equal(f.q().history[0].checkpoint.native_quote_id,NATIVE_ID);assert.equal(f.q().history[1].checkpoint.native_quote_id,secondNative);assert.deepEqual(f.q().checkpoint,{});
});



