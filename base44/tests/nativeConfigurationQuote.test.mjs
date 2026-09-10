import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNativeConfigurationQuoteService} from '../shared/nativeConfigurationQuote.js';
import {CONFIGURATION_QUOTE_SOURCE, configurationQuoteResultIssues, configurationInputSnapshot} from '../shared/nativeConfigurationResult.js';
import {verifyNativePricePreview,previewPolicyKey} from '../shared/nativePricePreview.js';
import {normalizeManualBuilderDraft,builderReviewResponse,builderScheduleHash} from '../shared/windowQuoteBuilder.js';
import {sha256,validateResult,createQuoteHandler} from '../shared/windowQuotesCore.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/saved-hampton-preview-proof.json',import.meta.url),'utf8'));
const clone=x=>structuredClone(x),stable=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const user={id:'configuration-owner',role:'admin',email:'gabefronk@gmail.com'};
const settings={dealer:'BFS',yard:'BFS-UTAH DESIGN(11)',gross_margin:30,color:'White',glass:'CozE (LowE)'};
const config={enabled:true,mode:'queue',worker_id:'worker-1',worker_key_hash:'a'.repeat(64),native_engine:{...fixture.context.policy,price_previews:true,configuration_quotes:true}};
function table(initial=[]){const data=clone(initial);let creates=0,updates=0;const match=(r,q)=>Object.entries(q).every(([k,v])=>r[k]===v);return{data,get creates(){return creates;},get updates(){return updates;},async filter(q={},_sort,limit=500){return clone(data.filter(r=>match(r,q)).slice(0,limit));},async create(value){creates++;const row={...clone(value),id:'created-'+creates};data.push(row);return clone(row);},async updateMany(q,patch){let updated=0;for(const row of data)if(match(row,q)){Object.assign(row,clone(patch.$set));updated++;updates++;}return {updated};}};}
async function harness({lines,policy=config.native_engine}={}){
 let time=Date.parse(fixture.context.now)+5000;
 const line={id:'window-a',style:'Hampton Casement',width:24,height:48,qty:2,room:'Bathroom',mark:'A',units:'in',dimension_basis:'frame',options:{series:'Hampton'}};
 const draft={settings,lines:lines||[line,{...line,id:'window-b',qty:1,room:'Bedroom',mark:'B'}],source:{amsco_configurator:{version:1}}};
 const reviewed=await builderReviewResponse(normalizeManualBuilderDraft(draft),{allowOnline:true});assert.equal(reviewed.review.ready,true,JSON.stringify(reviewed));
 const q={id:'saved-package',request_id:'save-1',title:'Verification package',requester_email:user.email,input_revision:1,state_version:0,worker_status:'draft',sales_status:'open',...reviewed.draft,
   source:{...reviewed.draft.source,visual_builder:{version:1,confirmed:true,schedule_hash:reviewed.review.schedule_hash}},history:[],conversation:[],checkpoint:{},job_id:'',accepted_revision:0};
 const proof=await verifyNativePricePreview(fixture.plan,fixture.observed,fixture.context);assert.equal(proof.ok,true);
 const record={id:fixture.plan.quote_id,version:1,owner_id:user.id,status:'ready',contract_hash:config.native_engine.contract_hash,context_fingerprint:config.native_engine.context_fingerprint,catalog_id:'361',
   plan:clone(fixture.plan),plan_hash:fixture.observed.native_engine.plan_hash,operation_id:fixture.observed.native_engine.operation_id,result:proof.result,expires_at:new Date(time+86400000).toISOString(),created_date:new Date(time).toISOString()};
 record.request_key=await sha256(stable({version:1,owner:user.id,context:previewPolicyKey(config.native_engine),plan:{...record.plan,quote_id:'price-preview',title:''}}));
 const db={QuoteRequests:table([q]),WindowQuotePricePreviews:table([record]),Jobs:table()};
 const service=createNativeConfigurationQuoteService({config:{...config,native_engine:policy},now:()=>new Date(time)});
 return{db,q,service,draft,advance:ms=>time+=ms,now:()=>new Date(time),save:()=>service.finalize({db,q:clone(q),user})};
}
test('a reviewed mixed-quantity package uses real saved Hampton prices with no new native job',async()=>{
 const h=await harness(),saved=await h.save();assert.equal(saved.worker_status,'ready');assert.equal(saved.result.native_source,CONFIGURATION_QUOTE_SOURCE);
 assert.equal(saved.result.totals.customer_total,1416.39);assert.equal(saved.result.lines[0].line_totals.customer,944.26);assert.equal(saved.result.lines[1].line_totals.customer,472.13);
 assert.equal(saved.result.lines[0].room,'Bathroom');assert.equal(saved.result.lines[1].room,'Bedroom');assert.equal(saved.result.lines[0].options.hardware,'Standard');
 assert.equal(saved.result.native_quote_id,undefined);assert.equal(saved.result.lines[0].pricing_evidence.native_quote_id,fixture.observed.native_quote_id);
 assert.equal(h.db.WindowQuotePricePreviews.creates,0);assert.equal(h.db.WindowQuotePricePreviews.updates,0);assert.equal(h.db.QuoteRequests.creates,0);
 const inputHash=await sha256(stable(configurationInputSnapshot(saved)));assert.deepEqual(configurationQuoteResultIssues(saved.result,{quote:saved,inputHash}),[]);
});
test('simultaneous saves commit once and return the same verified package',async()=>{
 const h=await harness(),saved=await Promise.all([h.save(),h.save()]);assert.deepEqual(saved[0].result,saved[1].result);assert.equal(h.db.QuoteRequests.updates,1);assert.equal(h.db.QuoteRequests.data[0].conversation.length,1);
});
test('a changed option, expired price, different owner or changed native contract cannot reuse a price',async()=>{
 const h=await harness();h.advance(86400001);assert.equal(await h.save(),null);assert.equal(h.db.QuoteRequests.updates,0);
 const foreign=await harness();foreign.db.WindowQuotePricePreviews.data[0].owner_id='other-owner';assert.equal(await foreign.save(),null);
 const changed=await harness({policy:{...config.native_engine,contract_hash:'e'.repeat(64)}});assert.equal(await changed.save(),null);
 const option=await harness();option.q.lines[0].options.tempered=true;option.q.source.visual_builder.schedule_hash=await builderScheduleHash({settings:option.q.settings,lines:option.q.lines,source:{amsco_configurator:{version:1}}});assert.equal(await option.save(),null);
});
test('a stale review, missing confirmation, retained conversation or non-owner cannot bypass review',async()=>{
 const stale=await harness();stale.q.lines[0].width=25;await assert.rejects(stale.save(),e=>e.status===409);assert.equal(stale.db.QuoteRequests.updates,0);
 const missing=await harness();missing.q.source.visual_builder.confirmed=false;assert.equal(await missing.save(),null);
 const chat=await harness();chat.q.conversation=[{role:'user',content:'Do not use those grids'}];assert.equal(await chat.save(),null);
 const owner=await harness();await assert.rejects(owner.service.finalize({db:owner.db,q:owner.q,user:{...user,email:'other@example.test'}}),e=>e.status===403);
});
test('a package stays unpriced when even one configuration lacks a saved price',async()=>{
 const h=await harness();h.q.lines[1].width=25;h.q.source.visual_builder.schedule_hash=await builderScheduleHash({settings:h.q.settings,lines:h.q.lines,source:{amsco_configurator:{version:1}}});
 assert.equal(await h.save(),null);assert.equal(h.db.QuoteRequests.updates,0);assert.equal(h.db.QuoteRequests.data[0].worker_status,'draft');
});
test('result validation rejects invented whole-quote identity, changed totals and revision drift',async()=>{
 const h=await harness(),saved=await h.save(),inputHash=await sha256(stable(configurationInputSnapshot(saved)));
 assert.throws(()=>validateResult(saved.result),e=>e.status===400);
 for(const edit of [r=>r.native_quote_id=fixture.observed.native_quote_id,r=>r.totals.customer_total+=1,r=>r.lines[0].qty=9,r=>r.input_revision=2,r=>r.lines[0].pricing_evidence.native_engine.plan_hash='f'.repeat(64)]){
  const bad=clone(saved.result);edit(bad);assert.ok(configurationQuoteResultIssues(bad,{quote:saved,inputHash}).length);
 }
});
test('conversion to a job retains the verified package and does not duplicate on retry',async()=>{
 const h=await harness(),saved=await h.save();h.db.QuoteRequests.data[0]=saved;
 const handler=createQuoteHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities:h.db}}),now:h.now});
 const call=()=>handler(new Request('https://test.invalid/windowQuotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'convert_won',quote_id:saved.id,customer_name:'Test owner'})}));
 const first=await call();assert.equal(first.status,200,await first.clone().text());const result=await first.json();assert.equal(result.job.accepted_quote_snapshot.result.totals.customer_total,1416.39);
 const again=await call();assert.equal(again.status,200);assert.equal(h.db.Jobs.creates,1);assert.equal((await again.json()).job.id,result.job.id);
});
