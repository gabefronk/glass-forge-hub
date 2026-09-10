import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePricePreviewService,planNativePricePreview} from '../shared/nativePricePreview.js';
const clone=x=>structuredClone(x), policy={enabled:true,version:1,contract_hash:'c'.repeat(64),catalog_id:'361',context_fingerprint:'d'.repeat(64),price_previews:true};
const user={id:'admin-1',role:'admin'},worker={id:'worker-1',enabled:true,token_hash:'a'.repeat(64),allowed_dealers:['BFS']};
const config={enabled:true,mode:'queue',worker_id:worker.id,worker_key_hash:worker.token_hash,native_engine:policy};
const settings={dealer:'BFS',yard:'BFS-UTAH DESIGN(11)',gross_margin:30,color:'White',glass:'CozE (LowE)'};
const line=()=>({id:'line-1',style:'Hampton Casement',width:24,height:48,units:'in',dimension_basis:'frame',qty:1,options:{series:'Hampton'}});
function table(records=[]){
 const data=clone(records);let serial=0;
 const match=(row,q)=>Object.entries(q).every(([key,wanted])=>{
  const actual=row[key];if(wanted&&typeof wanted==='object'&&!Array.isArray(wanted))return Object.entries(wanted).every(([op,value])=>op==='$in'?value.includes(actual):op==='$nin'?!value.includes(actual):op==='$gt'?actual>value:op==='$ne'?actual!==value:false);
  return actual===wanted;
 });
 return {data,async filter(q={},sort,limit=500){const found=data.filter(r=>match(r,q));if(sort){const key=sort.replace(/^-/,'');found.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))*(sort.startsWith('-')?-1:1));}return clone(found.slice(0,limit));},async create(value){const row={...clone(value),id:'preview-'+(++serial),created_date:new Date(1789035000000+serial).toISOString()};data.push(row);return clone(row);},async updateMany(q,change){let updated=0;for(const row of data)if(match(row,q)){Object.assign(row,clone(change.$set));updated++;}return {updated};}};
}
function harness({realVerify=false}={}){
 let time=Date.parse('2026-09-10T10:30:00Z'),verified=0;
 const db={WindowQuotePricePreviews:table(),QuoteWorkers:table([{...worker,runner_presence:{last_seen_at:new Date(time).toISOString(),runner_status:'idle',native_engine:{state:'ready',...policy}}}])};
 const service=createNativePricePreviewService({config,now:()=>new Date(time),...(realVerify?{}:{verify:async(plan,observed,context)=>{verified++;assert.equal(context.operationId,'op-1');assert.equal(plan.quote_id,observed.quote_id);return {ok:true,result:{verified:true,quote_id:plan.quote_id,input_revision:1,native_source:'desktop_native',native_engine:clone(policy),verification:{checked_at:new Date(time).toISOString()},lines:[{qty:1,unit_prices:{list:90,dealer:42,customer:60}}]}};}})});
 return {db,service,advance:ms=>time+=ms,get verified(){return verified;},request:(extra={})=>service.request({db,user,line:line(),settings,sessionId:'session-1',...extra})};
}
async function claim(h){const offered=await h.service.poll({db:h.db,worker,nativeReady:true});assert.equal(offered.kind,'price_preview');const body={action:'preview_claim',preview_id:offered.quote_id,operation_id:'op-1',plan_hash:offered.plan_hash};await h.service.claim({db:h.db,worker,body});return {offered,body};}
const reportBody=(offer,status='ready')=>({action:'preview_report',preview_id:offer.quote_id,operation_id:'op-1',plan_hash:offer.plan_hash,status,...(status==='ready'?{observed:{quote_id:offer.quote_id}}:{})});
test('preview plans support Hampton without adding a frozen Studio glass or hardware recipe',()=>{
 const built=planNativePricePreview({id:'preview',input_revision:1,settings,lines:[line()]});assert.equal(built.ok,true);assert.equal(built.plan.schema_version,3);
 assert.equal(built.plan.lines[0].options.glass_thickness,undefined);assert.equal(built.plan.lines[0].options.hardware,undefined);
 assert.equal(built.plan.lines[0].options.series,'Hampton');assert.equal(built.plan.lines[0].frame_dimensions.width,24);
});
test('the same physical window reuses a calculation and verified unit price across quantity and room edits',async()=>{
 const h=harness(),first=await h.request(),again=await h.request({line:{...line(),qty:3,room:'Bedroom'}});
 assert.equal(first.status,'calculating');assert.equal(first.preview_id,again.preview_id);assert.equal(h.db.WindowQuotePricePreviews.data.length,1);
 const {offered}=await claim(h);await h.service.report({db:h.db,worker,body:reportBody(offered)});
 const result=await h.request({line:{...line(),qty:3,room:'Bedroom'}});assert.equal(result.status,'priced');assert.equal(result.line_totals.customer,180);assert.equal(h.verified,1);
});
test('a changed editor size supersedes its old queued calculation without cancelling other windows',async()=>{
 const h=harness();await h.request();await h.request({line:{...line(),id:'line-2'}});await h.request({line:{...line(),width:25}});
 const rows=h.db.WindowQuotePricePreviews.data;assert.equal(rows[0].status,'superseded');assert.equal(rows.at(-1).status,'queued');assert.equal(rows.at(-1).plan.lines[0].width,25);
});
test('only one operation can claim a preview and an identical claim is idempotent',async()=>{
 const h=harness();await h.request();const offer=await h.service.poll({db:h.db,worker,nativeReady:true});
 const body={action:'preview_claim',preview_id:offer.quote_id,plan_hash:offer.plan_hash,operation_id:'op-1'};
 const attempts=await Promise.allSettled([h.service.claim({db:h.db,worker,body}),h.service.claim({db:h.db,worker,body:{...body,operation_id:'op-2'}})]);
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal((await h.service.claim({db:h.db,worker,body})).operation_id,'op-1');
});
test('report acknowledgments replay identical data and reject changed data or a foreign operation',async()=>{
 const h=harness();await h.request();const {offered}=await claim(h),body=reportBody(offered);
 const result=await h.service.report({db:h.db,worker,body});assert.deepEqual(await h.service.report({db:h.db,worker,body}),result);
 await assert.rejects(h.service.report({db:h.db,worker,body:{...body,observed:{...body.observed,extra:true}}}),e=>e.status===409);
 await assert.rejects(h.service.report({db:h.db,worker,body:{...body,operation_id:'op-2'}}),e=>e.status===409);
 assert.equal(h.verified,1);
});
test('a native rejection produces an online-quote status and never a price',async()=>{
 const h=harness();await h.request();const {offered}=await claim(h);await h.service.report({db:h.db,worker,body:reportBody(offered,'unsupported')});
 const result=await h.request();assert.equal(result.status,'amsco_lookup_needed');assert.equal(result.unit_prices,undefined);
});
test('expired claims and forged native observations cannot publish a price',async()=>{
 const h=harness({realVerify:true});await h.request();const {offered}=await claim(h);
 await assert.rejects(h.service.report({db:h.db,worker,body:reportBody(offered)}),e=>e.status===400);
 h.advance(180001);await assert.rejects(h.service.report({db:h.db,worker,body:reportBody(offered,'failed')}),e=>e.status===409);
 assert.equal((await h.request()).status,'native_unavailable');assert.equal(h.db.WindowQuotePricePreviews.data[0].result,undefined);
});
test('offline or changed native context never reuses an old price or starts an unserviceable request',async()=>{
 const h=harness();h.advance(100001);assert.equal((await h.request()).status,'native_unavailable');assert.equal(h.db.WindowQuotePricePreviews.data.length,0);
 h.db.QuoteWorkers.data[0].runner_presence.last_seen_at='2026-09-10T10:31:40.001Z';h.db.QuoteWorkers.data[0].runner_presence.native_engine.context_fingerprint='f'.repeat(64);
 assert.equal((await h.request()).status,'native_unavailable');assert.equal(h.db.WindowQuotePricePreviews.data.length,0);
});
test('preview records and callbacks require authenticated owners and the configured worker',async()=>{
 const h=harness();await assert.rejects(h.request({user:{...user,role:'user'}}),e=>e.status===403);await h.request();
 await assert.rejects(h.service.poll({db:h.db,worker:{...worker,id:'other'},nativeReady:true}),e=>e.status===401);
 const other=await h.request({user:{...user,id:'admin-2'}});assert.notEqual(other.preview_id,h.db.WindowQuotePricePreviews.data[0].id);
});
test('a locally consumed preview is excluded without blocking another queued window',async()=>{
 const h=harness();const first=await h.request();const second=await h.request({line:{...line(),id:'other-line',width:25}});
 const offered=await h.service.poll({db:h.db,worker,nativeReady:true,excludedIds:[first.preview_id]});
 assert.equal(offered.quote_id,second.preview_id);assert.notEqual(offered.quote_id,first.preview_id);
 await assert.rejects(h.service.poll({db:h.db,worker,nativeReady:true,excludedIds:['invalid/id']}),e=>e.status===400);
});
test('disabled previews leave the normal quote runner untouched and do not access the preview entity',async()=>{
 const service=createNativePricePreviewService({config:{...config,native_engine:{...policy,price_previews:false}}});
 assert.equal(await service.poll({db:{},worker,nativeReady:true}),null);assert.equal((await service.request({db:{},user,line:line(),settings})).status,'native_unavailable');
});

