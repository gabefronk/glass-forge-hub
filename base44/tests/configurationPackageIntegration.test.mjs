import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {createQuoteHandler,sha256,validateResult} from '../shared/windowQuotesCore.js';
import {createScriptedQueueExecution} from '../shared/scriptedQueueExecution.js';
import {createAgentExecution,createAgentToolHandler} from '../shared/windowQuoteAgentService.js';
import {createConfigurationAgentRouter} from '../shared/configurationAgentRouter.js';
import {createAgentWebhookHandler} from '../shared/windowQuoteAgentWebhook.js';
import {createSuperagentTransport,DEFAULT_AGENT_ID,makeDispatchMarker} from '../shared/superagentTransport.js';
import {builderReviewResponse,normalizeManualBuilderDraft} from '../shared/windowQuoteBuilder.js';
import {verifyNativePricePreview,previewPolicyKey} from '../shared/nativePricePreview.js';
import {buildQuotePlan,verifyObservedQuote} from '../shared/amscoQuotePlan.js';
import {configurationInputSnapshot} from '../shared/nativeConfigurationResult.js';
import {privateOnlineDatabase} from '../shared/configurationOnlineQueue.js';

const fixture=JSON.parse(await readFile(new URL('./fixtures/saved-hampton-preview-proof.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value),stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const at=(row,key)=>key.split('.').reduce((v,k)=>v?.[k],row);
const matches=(row,query)=>Object.entries(query).every(([key,want])=>{const got=at(row,key);return want&&typeof want==='object'?('$in'in want?want.$in.includes(got):'$nin'in want?!want.$nin.includes(got):'$gte'in want?got>=want.$gte:false):got===want;});
function table(prefix,initial=[]){let count=0;const data=clone(initial);return{data,async filter(query={},sort,limit=100){const rows=data.filter(row=>matches(row,query));if(sort)rows.sort((a,b)=>String(a[sort]||'').localeCompare(String(b[sort]||'')));return clone(rows.slice(0,limit));},async create(value){const row={...clone(value),id:prefix+'-'+ ++count,created_date:'2026-09-10T12:00:00Z'};data.push(row);return clone(row);},async updateMany(query,patch){let updated=0;for(const row of data)if(matches(row,query)){Object.assign(row,clone(patch.$set));updated++;}return{updated};}};}

async function harness({pending=false,onlineConfigured=true}={}){
 const now=()=>new Date('2026-09-10T12:00:00Z'),user={id:'other-administrator',role:'admin',email:'another-admin@example.test'};
 const settings={dealer:'BFS',yard:'BFS-UTAH DESIGN(11)',gross_margin:30,color:'White',glass:'CozE (LowE)'};
 const native={id:'native-window',style:'Hampton Casement',width:24,height:48,qty:2,room:'Bedroom',units:'in',dimension_basis:'frame',options:{series:'Hampton'}};
 const online={id:'online-window',style:'Studio Radius',width:48,height:36,qty:2,room:'Entry',units:'in',dimension_basis:'frame',options:{series:'Studio'}};
 const reviewed=await builderReviewResponse(normalizeManualBuilderDraft({settings,lines:[native,online],source:{amsco_configurator:{version:1}}}),{allowOnline:true});
 assert.equal(reviewed.review.ready,true,JSON.stringify(reviewed));
 const config={enabled:true,mode:'queue',worker_id:'runner',worker_key_hash:'a'.repeat(64),browser_slot_id:'shared-slot',queue_allow:{requester_email:'gabefronk@gmail.com',dealer:'BFS',yard:'BFS-UTAH DESIGN (11)',created_after:'2026-09-07T07:00:00Z'},
  native_engine:{...fixture.context.policy,price_previews:true,configuration_quotes:true,configuration_packages:true}};
 const verified=await verifyNativePricePreview(fixture.plan,fixture.observed,fixture.context);assert.equal(verified.ok,true);
 const record={id:fixture.plan.quote_id,version:1,owner_id:user.id,status:pending?'queued':'ready',contract_hash:config.native_engine.contract_hash,context_fingerprint:config.native_engine.context_fingerprint,catalog_id:'361',
  plan:clone(fixture.plan),plan_hash:fixture.observed.native_engine.plan_hash,operation_id:fixture.observed.native_engine.operation_id,result:pending?null:verified.result,expires_at:'2026-09-11T12:00:00Z',created_date:'2026-09-10T11:00:00Z'};
 record.request_key=await sha256(stable({version:1,owner:user.id,context:previewPolicyKey(config.native_engine),plan:{...record.plan,quote_id:'price-preview',title:''}}));
 const worker={id:'runner',name:'Pricing runner',enabled:true,token_hash:config.worker_key_hash,allowed_dealers:['BFS'],runner_presence:{runner_status:'idle',last_seen_at:now().toISOString(),native_engine:{state:'ready',...previewPolicyKey(config.native_engine)}}};
 const db={QuoteRequests:table('parent'),WindowQuotePricePreviews:table('preview',[record]),WindowQuoteConfigurationPackages:table('package'),WindowQuoteOnlineRequests:table('online'),Jobs:table('job'),
  QuoteWorkers:table('worker',[worker,{id:'shared-slot',name:'Base44 Window Quotes browser',busy_token:'',active_quote_id:'',poll_generation:0}])};
 const sends=[];let sequence=0;
 const raw=createAgentExecution({transport:onlineConfigured?{sendMessage:async value=>sends.push(value)}:null,browserSlotId:'shared-slot',conversationId:'private-online-conversation',now,uuid:()=> 'online-operation-'+ ++sequence});
 const routed=createConfigurationAgentRouter({legacy:{configured:true,tool(){throw Error('Unexpected legacy tool');},report(){throw Error('Unexpected legacy report');}},onlineExecution:raw,loadConfig:async()=>config,now});
 const execution=createScriptedQueueExecution({config,now,normalizeRequest:buildQuotePlan,validateReady:verifyObservedQuote,packageOnlineExecution:raw,
  normalizeIntake(){throw Error('Reviewed windows must not run AI intake');},fallbackExecution:{configured:true,afterInput(){throw Error('The complete package must not be delegated');}}});
 const getClient=async()=>({auth:{me:async()=>user},asServiceRole:{entities:db}});
 const handler=createQuoteHandler({getClient,executionService:execution,now}),agentHandler=createAgentToolHandler({getClient,execution:routed});
 const call=async body=>{const response=await handler(new Request('https://example.test/quotes',{method:'POST',body:JSON.stringify(body)}));return{status:response.status,body:await response.json()};};
 const submit=()=>call({action:'create',request_id:'reviewed-mixed-package',title:'Mixed package test',...reviewed.draft,source:{...reviewed.draft.source,visual_builder:{version:1,confirmed:true,schedule_hash:reviewed.review.schedule_hash}}});
 const tools=async body=>{const response=await agentHandler(new Request('https://example.test/tools',{method:'POST',body:JSON.stringify(body)}));return{status:response.status,body:await response.json()};};
 const capability=(child,body)=>({quote_id:child.id,input_revision:1,operation_id:child.agent_run.operation_id,execution_token:child.agent_run.execution_token,...body});
 // The online observation below is synthetic and tests routing/validation only.
 // The native receipt above is a real saved/reopened Hampton observation.
 const report=(child,status='ready')=>{const nativeId='12345678-1234-1234-1234-123456789abc',line=child.lines[0],unit={list:200,dealer:100,customer:142.86};return capability(child,{action:'report',event_id:'online-final',status,message:status==='ready'?'Saved AMSCO price.':'Sign in to continue.',
  checkpoint:{native_quote_id:nativeId,native_quote_url:'https://amsco.wtsparadigm.com/quotes/'+nativeId+'/line-items'},
  ...(status==='ready'?{verification:{reopened:true,dealer:settings.dealer,yard:settings.yard,gross_margin:30,checked_at:now().toISOString()},result:{verified:true,native_quote_id:nativeId,native_quote_number:'1234567',native_quote_url:'https://amsco.wtsparadigm.com/quotes/'+nativeId+'/line-items',
   lines:[{...line,frame_dimensions:{width:line.width,height:line.height,units:'in'},options:{...line.options,exterior_color:'White',interior_color:'White',glass:settings.glass},native_line_id:'native-line',native_line_number:'100',unit_prices:unit,line_totals:Object.fromEntries(Object.entries(unit).map(([k,v])=>[k,Math.round(v*100)*line.qty/100]))}],
   totals:{currency:'USD',list_total:400,dealer_cost:200,customer_total:285.72,total:285.72,tax:0,freight:0,labor:0}}}:{})});};
 const poll=()=>execution.poll({db,worker,body:{runner_id:'runner-instance',runner_status:'idle',browser:{state:'authenticated',dealer:'BFS'},native_engine:{state:'ready',...previewPolicyKey(config.native_engine)}}});
 return{db,config,user,sends,submit,call,tools,report,capability,poll,routed,getClient,now,makeNativeReady(){Object.assign(db.WindowQuotePricePreviews.data[0],{status:'ready',result:verified.result});}};
}

test('actual HTTP submission and guarded online callback combine the package without AI and preserve job conversion',async()=>{
 const h=await harness(),created=await h.submit();assert.equal(created.status,200,JSON.stringify(created));
 let q=h.db.QuoteRequests.data[0];assert.equal(q.worker_status,'queued');assert.equal(q.pricing_progress.priced_subtotal,944.26);assert.equal(q.pricing_progress.total,null);assert.equal(h.sends.length,1);
 assert.equal(h.db.WindowQuoteOnlineRequests.data.length,1);const child=h.db.WindowQuoteOnlineRequests.data[0];assert.deepEqual(child.lines,[q.lines[1]]);
 const read=await h.tools(h.capability(child,{action:'read'}));assert.equal(read.status,200);assert.match(read.body.contract.request_scope,/already-reviewed/);
 const response=await h.tools(h.report(child));assert.equal(response.status,200,JSON.stringify(response));
 q=h.db.QuoteRequests.data[0];assert.equal(q.worker_status,'ready');assert.equal(q.result.totals.customer_total,1229.98);assert.equal(q.result.native_quote_id,undefined);
 assert.equal(q.result.lines[0].pricing_evidence.preview_id,fixture.plan.quote_id);assert.equal(q.result.lines[1].pricing_evidence.source,'amsco_online');assert.equal(h.db.QuoteRequests.data.length,1);
 const inputHash=await sha256(stable(configurationInputSnapshot(q)));assert.doesNotThrow(()=>validateResult(q.result,{allowConfigurationSet:true,quote:q,inputHash}));assert.throws(()=>validateResult(q.result));
 const version=q.state_version;assert.equal((await h.tools(h.report(child))).status,200);assert.equal(h.db.QuoteRequests.data[0].state_version,version);assert.equal(h.sends.length,1);
 assert.equal((await h.submit()).status,200);assert.equal(h.db.QuoteRequests.data.length,1);
 const won=await h.call({action:'convert_won',quote_id:q.id,customer_name:'Synthetic test'});assert.equal(won.status,200,JSON.stringify(won));assert.equal(won.body.job.accepted_quote_snapshot.result.totals.customer_total,1229.98);
 assert.equal((await h.call({action:'convert_won',quote_id:q.id,customer_name:'Synthetic test'})).status,200);assert.equal(h.db.Jobs.data.length,1);
});

test('pending native calculation takes priority and the actual runner poll advances only the unpriced subset',async()=>{
 const h=await harness({pending:true}),created=await h.submit();assert.equal(created.status,200,JSON.stringify(created));
 assert.equal(h.sends.length,0);assert.equal(h.db.QuoteRequests.data[0].pricing_progress.native_pending_count,1);assert.equal(h.db.QuoteRequests.data[0].pricing_progress.total,null);
 h.makeNativeReady();await h.poll();assert.equal(h.sends.length,1);assert.equal(h.db.QuoteRequests.data[0].pricing_progress.priced_subtotal,944.26);
 const child=h.db.WindowQuoteOnlineRequests.data[0];assert.equal((await h.tools(h.report(child))).status,200);assert.equal(h.db.QuoteRequests.data[0].result.totals.customer_total,1229.98);
});

test('sign-in retry preserves the native checkpoint and all previously verified prices',async()=>{
 const h=await harness();assert.equal((await h.submit()).status,200);let child=h.db.WindowQuoteOnlineRequests.data[0];const failure=h.report(child,'needs_sign_in');
 assert.equal((await h.tools(failure)).status,200);let q=h.db.QuoteRequests.data[0];assert.equal(q.worker_status,'needs_sign_in');assert.equal(q.pricing_progress.priced_subtotal,944.26);
 const oldOperation=child.agent_run.operation_id;const retry=await h.call({action:'queue',quote_id:q.id});assert.equal(retry.status,200,JSON.stringify(retry));
 child=h.db.WindowQuoteOnlineRequests.data[0];assert.equal(h.db.WindowQuoteOnlineRequests.data.length,1);assert.equal(child.checkpoint.native_quote_id,failure.checkpoint.native_quote_id);assert.notEqual(child.agent_run.operation_id,oldOperation);assert.equal(h.sends.length,2);
 assert.equal((await h.call({action:'queue',quote_id:q.id})).status,200);assert.equal(h.sends.length,2);assert.equal((await h.tools(failure)).status,403);
 assert.equal((await h.tools(h.report(child))).status,200);assert.equal(h.db.QuoteRequests.data[0].result.totals.customer_total,1229.98);
});

test('an unavailable online connection retains a mixed reviewed schedule and finishes native work without AI intake',async()=>{
 for(const pending of [false,true]){
  const h=await harness({pending,onlineConfigured:false}),created=await h.submit();
  assert.equal(created.status,200,JSON.stringify(created));
  if(pending){assert.equal(h.db.QuoteRequests.data[0].worker_status,'queued');h.makeNativeReady();await h.poll();}
  const q=h.db.QuoteRequests.data[0];
  assert.equal(q.worker_status,'failed');assert.equal(q.lines.length,2);assert.equal(q.input_revision,1);
  assert.equal(q.pricing_progress.priced_subtotal,944.26);assert.equal(q.pricing_progress.total,null);
  assert.equal(q.pricing_progress.online_pending_count,1);assert.equal(q.result,undefined);
  assert.match(q.missing_details.join(' '),/connection is unavailable/);
  assert.equal(h.db.WindowQuoteConfigurationPackages.data[0].status,'needs_attention');
  assert.equal(h.db.WindowQuoteOnlineRequests.data.length,0);assert.equal(h.sends.length,0);
 }
});

test('changed selection, invalid capability, wrong observed option and rolled policy cannot complete a package',async()=>{
 const h=await harness();await h.submit();const child=h.db.WindowQuoteOnlineRequests.data[0];
 const forged=h.report(child);forged.execution_token='wrong';assert.equal((await h.tools(forged)).status,403);
 const wrong=h.report(child);wrong.result.lines[0].options.exterior_color='Black';assert.equal((await h.tools(wrong)).status,400);
 const policy=h.config.native_engine.contract_hash;h.config.native_engine.contract_hash='f'.repeat(64);assert.equal((await h.tools(h.report(child))).status,409);h.config.native_engine.contract_hash=policy;
 h.db.QuoteRequests.data[0].lines[1].width++;assert.equal((await h.tools(h.report(child))).status,409);assert.equal(h.db.QuoteRequests.data[0].result,undefined);
});

test('lost terminal acknowledgement repairs slot release and completes the parent without another online dispatch',async()=>{
 const h=await harness();await h.submit();const child=h.db.WindowQuoteOnlineRequests.data[0],report=h.report(child),original=h.db.QuoteWorkers.updateMany;let once=true;
 h.db.QuoteWorkers.updateMany=async(query,patch)=>{if(once&&patch.$set.busy_token===''){once=false;throw Error('Lost release');}return original(query,patch);};
 assert.equal((await h.tools(report)).status,503);assert.equal(h.db.WindowQuoteOnlineRequests.data[0].worker_status,'ready');assert.equal(h.db.QuoteRequests.data[0].worker_status,'queued');
 assert.equal((await h.tools(report)).status,200);assert.equal(h.db.QuoteRequests.data[0].worker_status,'ready');assert.equal(h.sends.length,1);
});

test('a signed webhook resolves the exact private child through the real provider envelope before merging its result',async()=>{
 const h=await harness();await h.submit();const child=h.db.WindowQuoteOnlineRequests.data[0],report=h.report(child),secret='synthetic-test-only',correlation={quote_id:child.id,input_revision:1,operation_id:child.agent_run.operation_id};
 const outcome={schema_version:1,...correlation,outcome:'ready',result:report.result,verification:report.verification,checkpoint:report.checkpoint};
 // Native identity is checkpointed before the provider completion event.
 assert.equal((await h.tools(h.capability(child,{action:'checkpoint',event_id:'saved-native',checkpoint:report.checkpoint}))).status,200);
 const conversation={id:'private-online-conversation',app_id:DEFAULT_AGENT_ID,metadata:{window_quote:correlation},messages:[{id:'dispatch',role:'user',content:makeDispatchMarker(correlation)+'\nSynthetic'},{id:'provider-completion',role:'assistant',content:JSON.stringify(outcome)}]};
 let reads=0;const transport=createSuperagentTransport({apiKey:'synthetic-key',fetchImpl:async()=>{reads++;return new Response(JSON.stringify(conversation));}});
 const handler=createAgentWebhookHandler({getClient:h.getClient,execution:h.routed,transport,secret});
 const raw=JSON.stringify({event:'message.completed',app_id:DEFAULT_AGENT_ID,conversation_id:conversation.id,timestamp:h.now().toISOString(),data:{message:conversation.messages[1]}});
 const send=signature=>handler(new Request('https://example.test/webhook',{method:'POST',headers:{'X-Base44-Signature':signature,'X-Base44-Event':'message.completed','X-Base44-Delivery':'delivery'},body:raw}));
 assert.equal((await send('sha256='+'0'.repeat(64))).status,401);assert.equal(reads,0);
 const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex'),response=await send(signature);assert.equal(response.status,200,await response.clone().text());assert.ok(reads>0);assert.equal(h.db.QuoteRequests.data[0].worker_status,'ready');
 assert.equal((await send(signature)).status,200);assert.equal(h.sends.length,1);
});

test('a requested edit or chat cannot mutate a frozen package before its revision is checked',async()=>{
 const h=await harness();await h.submit();const child=h.db.WindowQuoteOnlineRequests.data[0];await h.tools(h.report(child,'needs_sign_in'));
 const before=clone(h.db.QuoteRequests.data[0]);
 for(const body of [{action:'update',title:'Changed'},{action:'message',message:'Make it black',client_message_id:'edit-frozen'}]){
  const response=await h.call({...body,quote_id:before.id});assert.equal(response.status,409);assert.match(response.body.error,/Revise windows/);assert.deepEqual(h.db.QuoteRequests.data[0],before);
 }
});

test('more than one page of stale private work cannot hide a current queued window',async()=>{
 const h=await harness();await h.submit();const child=clone(h.db.WindowQuoteOnlineRequests.data[0]);child.worker_status='queued';child.queued_at='2026-09-10T12:00:00Z';
 const old=Array.from({length:60},(_,index)=>({...clone(child),id:'old-'+index,parent_quote_id:'missing-parent',queued_at:'2026-09-10T11:00:00Z'}));
 h.db.WindowQuoteOnlineRequests.data.splice(0,1,...old,child);
 const found=await privateOnlineDatabase(h.db).QuoteRequests.filter({worker_status:'queued',execution_provider:'superagent'},'queued_at',1);
 assert.deepEqual(found.map(row=>row.id),[child.id]);
});
