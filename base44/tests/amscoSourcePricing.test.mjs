import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {priceSourceWindow,sourcePricePreview,sourcePriceReceipt,sourcePriceEvidenceIssues} from '../shared/amscoSourcePricing.js';
import {createNativePricePreviewService} from '../shared/nativePricePreview.js';
import {createNativeConfigurationQuoteService} from '../shared/nativeConfigurationQuote.js';
import {builderPricePreview,builderScheduleHash} from '../shared/windowQuoteBuilder.js';
import {configurationQuoteResultIssues,configurationInputSnapshot} from '../shared/nativeConfigurationResult.js';
import {catalogStableJson} from '../shared/nativeCatalogPlan.js';
import {sha256} from '../shared/windowQuotesCore.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/saved-hampton-preview-proof.json',import.meta.url),'utf8'));
const user={id:'source-owner',email:'owner@example.test',role:'admin'};
const settings={dealer:'BFS',yard:'BFS-UTAH DESIGN(11)',gross_margin:30,color:'White',glass:'CozE (Low-E)'};
const config={enabled:true,mode:'queue',native_engine:{...fixture.context.policy,price_previews:true,configuration_quotes:true,configuration_packages:true,source_pricing:true}};
const line={id:'window-1',style:'Hampton Casement',width:24,height:48,qty:2,room:'Bedroom',units:'in',dimension_basis:'frame',options:{series:'Hampton'}};
const noDb=new Proxy({}, {get(){throw Error('Immediate source pricing must not read or write database records');}});
const now=()=>new Date('2026-09-10T14:00:00Z');
test('all qualified product families match saved and reopened native controls with and without grids',async()=>{
 const controls=JSON.parse(await readFile(new URL('./fixtures/source-release-controls.json',import.meta.url),'utf8'));
 assert.equal(controls.length,8);
 for(const control of controls){const p=priceSourceWindow({line:control.line,settings});assert.equal(p.ok,true,JSON.stringify(control));assert.equal(p.calculated.unit_prices.list,control.expected_list,JSON.stringify(control));}
});
test('source path calculates every price tier and exact quantity from current rules',()=>{
 const priced=sourcePricePreview({line,settings});
 assert.equal(priced.price_source,'amsco_source_engine');
 assert.deepEqual(priced.unit_prices,{list:725.4,dealer:330.49,customer:472.13});
 assert.deepEqual(priced.line_totals,{list:1450.8,dealer:660.98,customer:944.26});
});
test('live Studio 6060 call size and black finish use the imported rate grid',()=>{
 const slider={...line,style:'Studio XO Slider',width:72,height:72,dimension_basis:'call',options:{},qty:1};
 const priced=priceSourceWindow({line:slider,settings});assert.equal(priced.ok,true);
 assert.equal(priced.input.configuration.width,71.5);assert.equal(priced.input.configuration.height,71.5);
 const black=priceSourceWindow({line:{...slider,options:{color:'Black exterior / White interior'}},settings});assert.equal(black.ok,true);
 assert.ok(black.calculated.unit_prices.list>priced.calculated.unit_prices.list);
 assert.equal(black.calculated.components[0].color_factor,1.94);
});
test('scoped tempered and grille recipe matches the independently saved AMSCO bathroom',()=>{
 const result=sourcePricePreview({line:{...line,width:33,height:33,qty:1,options:{series:'Hampton',tempered:true,grilles:'5/8" Flat · Rectangular · 2W4H per lite · White'}},settings});
 assert.deepEqual(result.unit_prices,{list:898.5,dealer:409.36,customer:584.8});
});
test('unported options, conflicting finishes, assemblies and out-of-scope sizes never become prices',()=>{
 for(const patch of [{width:40},{width:12},{height:74},{options:{series:'Hampton',number_wide:2}},{options:{series:'Hampton',operation:'Fixed'}},
  {options:{series:'Hampton',glass_thickness:'DS'}},{options:{series:'Hampton',argon:true}},{options:{series:'Hampton',screen:'None'}},
  {options:{series:'Hampton',grilles:'Custom grid'}},{options:{series:'Hampton',color:'Black',exterior_color:'White',interior_color:'White'}}]) {
   assert.equal(sourcePricePreview({line:{...line,...patch},settings}),null,JSON.stringify(patch));
 }
 assert.equal(sourcePricePreview({line,settings:{...settings,yard:'Other yard'}}),null);
});
test('explicit standard choices do not create unnecessary fallback',()=>{
 const options={series:'Hampton',unit_type:'Complete Unit',number_wide:1,hardware:'Standard',hardware_color:'White',screen:'White',
  tempered:false,patterned_glass:'None',argon:false,elevation:'2501 to 6500',super_spacer:true,capillary_tubes:false,glazing_method:'3/4 Insulated'};
 assert.equal(sourcePricePreview({line:{...line,options},settings}).unit_prices.customer,472.13);
});
test('actual preview service needs no runner session or database for source-priced selections',async()=>{
 const service=createNativePricePreviewService({config,now});
 const preview=await service.request({db:noDb,user,line,settings});assert.equal(preview.unit_prices.customer,472.13);
 const receipt=await service.resolveVerified({db:noDb,user,line,settings});assert.equal(receipt.source,'amsco_source_engine');
 await assert.rejects(service.request({db:noDb,user:{...user,role:'user'},line,settings}),e=>e.status===403);
});
test('builder price preview calculates an entire source-priced schedule without queue work',async()=>{
 const result=await builderPricePreview({settings,lines:[line,{...line,id:'two',qty:1}],source:{amsco_configurator:{version:1}}},noDb,{config,user,now:now().getTime()});
 assert.equal(result.ready,true);assert.equal(result.total,1416.39);assert.equal(result.pending,false);
 assert.ok(result.lines.every(row=>row.price_source==='amsco_source_engine' && row.source_engine.mode==='live'));
});
test('source receipts cannot accept changed prices, options, rates or selections',()=>{
 const row=sourcePriceReceipt({line,settings,checkedAt:now().toISOString()}),evidence={...row.source_evidence,source:row.source},observed=row.result.lines[0];
 assert.deepEqual(sourcePriceEvidenceIssues(evidence,observed,line,settings),[]);
 for(const mutate of [r=>r.observed.unit_prices.customer++,r=>r.evidence.input.configuration.width++,r=>r.evidence.version='old',r=>r.evidence.components[0].value++,r=>r.observed.options.tempered=true]) {
  const data=structuredClone({evidence,observed});mutate(data);assert.ok(sourcePriceEvidenceIssues(data.evidence,data.observed,line,settings).length);
 }
 assert.ok(sourcePriceEvidenceIssues(evidence,observed,{...line,qty:3},settings).length);
});
test('reviewed source package finalizes immediately and validates without invented AMSCO quote identity',async()=>{
 const draft={settings,lines:[line],source:{amsco_configurator:{version:1}}};
 const q={id:'source-package',input_revision:1,state_version:0,worker_status:'draft',requester_email:user.email,...draft,
  source:{...draft.source,visual_builder:{version:1,confirmed:true,schedule_hash:await builderScheduleHash(draft)}}};
 let updates=0;
 const db={QuoteRequests:{async updateMany(_q,patch){updates++;Object.assign(q,patch.$set);return {updated:1};}}};
 const service=createNativeConfigurationQuoteService({config,now});
 const saved=await service.finalize({db,q:structuredClone(q),user});assert.equal(updates,1);assert.equal(saved.worker_status,'ready');
 assert.equal(saved.result.totals.customer_total,944.26);assert.equal(saved.result.verification.reopened,false);
 assert.equal(saved.result.lines[0].pricing_evidence.source,'amsco_source_engine');assert.equal(saved.result.native_quote_id,undefined);
 const inputHash=await sha256(catalogStableJson(configurationInputSnapshot(saved)));
 assert.deepEqual(configurationQuoteResultIssues(saved.result,{quote:saved,inputHash}),[]);
 const bad=structuredClone(saved.result);bad.lines[0].unit_prices.customer++;
 assert.ok(configurationQuoteResultIssues(bad,{quote:saved,inputHash}).length);
});

test('3070 and 4070 Studio nail-fin previews calculate directly without any runner or cached quote',async()=>{
 for(const [width,list,dealer,customer] of [[36,431.9,196.77,281.1],[48,492.1,224.2,320.29]]) {
  const singleHung={id:'hung-'+width,style:'Studio Single Hung',qty:1,width,height:84,units:'in',dimension_basis:'call',options:{argon:false,elevation:'2501 to 6500',fin:'Nail Fin'}};
  const original=structuredClone(singleHung);
  const result=await builderPricePreview({settings,lines:[singleHung],source:{amsco_configurator:{version:1}}},noDb,{config,user,now:now().getTime()});
  assert.equal(result.ready,true);assert.equal(result.pending,false);
  assert.equal(result.lines[0].price_source,'amsco_source_engine');
  assert.deepEqual(result.lines[0].unit_prices,{list,dealer,customer});
  const receipt=sourcePriceReceipt({line:singleHung,settings,checkedAt:now().toISOString()});
  assert.deepEqual(sourcePriceEvidenceIssues({...receipt.source_evidence,source:receipt.source},receipt.result.lines[0],singleHung,settings),[]);
  assert.deepEqual(singleHung,original);
 }
});
test('accepting standard nail fin does not bypass size limits or conflicting series',()=>{
 const hung={...line,style:'Studio Single Hung',dimension_basis:'call',width:36,height:84,options:{fin:'Nail Fin'}};
 for(const patch of [{width:49},{height:97},{options:{series:'Studio Flush Fin',fin:'Nail Fin'}},{options:{fin:'Custom Fin'}}])
  assert.equal(sourcePricePreview({line:{...hung,...patch},settings}),null,JSON.stringify(patch));
});
