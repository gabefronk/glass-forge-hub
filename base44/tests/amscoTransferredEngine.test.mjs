import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateTransferredWindow, getTransferredCatalog, dimensionLookup, attributeLookup, numberedAttributeLookup, frameArea, roundUp, applyTransferredDiscount, selectTransferredBase } from '../shared/amscoTransferredEngine.js';
import { createTransferredEngineHandler } from '../shared/amscoTransferredHandler.js';

const controls = JSON.parse(await readFile(new URL('./fixtures/amscoSourceControls.json',import.meta.url),'utf8'));
const clientId = '00000000-0000-0000-1555-000000000000';
const inputFor = c => ({ catalog_id:'358',price_book:1,client_id:clientId,gross_margin:30,configuration:{
  series:c.series,product_type:c.ptype,unit_type:'Complete Unit',shape:'Rectangle',operation:c.ptype==='Casement'?'Left':'Single Hung',tilted:false,
  width:c.w,height:c.h,dimension_basis:'frame',exterior_color:c.ext,interior_color:c.inte,preserve:c.preserve,grille_application_id:c.gai,
  glass:'CozE (LowE)',tempered:false,quantity:1 } });
for (const c of controls.configs) test('PK358 saved source control '+c.n,()=>{
  const r=calculateTransferredWindow(inputFor(c));
  assert.equal(r.status,'calculated');
  assert.equal(r.unit_prices.list,c.target_list);
  if(c.target_dealer!==null)assert.equal(r.unit_prices.dealer,c.target_dealer);
  assert.equal(r.production_ready,false);
  assert.equal(r.components.reduce((s,x)=>Math.round((s+x.value)*100)/100,0),c.target_list);
  assert.ok(r.components.every(x=>x.rule_ids.length>0));
});
test('PK361 Hampton 24x48 matches saved current native calculation',()=>{
  const input=inputFor(controls.configs[1]);input.catalog_id='361';input.configuration.width=24;input.configuration.height=48;
  const result=calculateTransferredWindow(input);
  assert.deepEqual(result.unit_prices,{list:725.4,dealer:330.49,customer:472.13});
  assert.equal(result.frame_area.value,8);
  assert.deepEqual(result.components.map(c=>c.value),[695.8,29.6]);
  input.configuration.quantity=2;
  assert.equal(calculateTransferredWindow(input).line_totals.customer,944.26);
});
test('small dimensions use real bands; exact boundaries do not inflate areas',()=>{
  const c=getTransferredCatalog('361');
  assert.equal(frameArea(c,23.5,59.5).value,10);
  assert.equal(frameArea(c,24,48).value,8);
  assert.equal(frameArea(c,24.01,48).value,10);
  assert.equal(dimensionLookup(c,'Hampton Casement Base',24,48).cell.width,24);
  assert.equal(dimensionLookup(c,'Hampton Casement Base',24.01,48).cell.width,30);
  assert.equal(Math.round(roundUp(3.7*18,.1)*100)/100,66.6);
  assert.equal(Math.round(roundUp(14.6*9,.1)*100)/100,131.4);
});
test('unknown and out-of-range selections do not silently produce a free or partial window',()=>{
  for(const change of [{preserve:'Unknown'},{grille_application_id:99},{tempered:true},{glass:'unknown'},{screen:'No'},{width:Infinity},{height:20000},{quantity:0},{exterior_color:'Black',interior_color:'Black',grille_application_id:1},{dimension_basis:'call'},{shape:'Circle'}]) {
    const input=inputFor(controls.configs[0]);Object.assign(input.configuration,change);
    const r=calculateTransferredWindow(input);assert.equal(r.status,'needs_online',JSON.stringify(change));assert.equal(r.unit_prices,null);assert.equal(r.line_totals,null);
  }
  assert.throws(()=>frameArea(getTransferredCatalog('361'),20000,40),/exceeds/);
  assert.throws(()=>attributeLookup(getTransferredCatalog('361'),'Preserve','Mystery'),/no unique/);
  assert.throws(()=>numberedAttributeLookup(getTransferredCatalog('361'),5,100),/no unique/);
});
for (const [exterior,interior,list,dealer,customer] of [['White','White',454.3,206.98,295.69],['Black','White',881.4,401.57,573.67],['Black','Black',1135.8,517.47,739.24]]) {
  test('PK361 Studio 72x48 '+exterior+'/'+interior+' matches saved current native calculation',()=>{
    const input=inputFor(controls.configs[0]);input.catalog_id='361';
    Object.assign(input.configuration,{product_type:'Single Vent',operation:'XO',width:72,height:48,exterior_color:exterior,interior_color:interior});
    const result=calculateTransferredWindow(input);
    assert.deepEqual(result.unit_prices,{list,dealer,customer});
    if(interior==='Black')assert.equal(result.components[0].assignment,'overwrite_from_uncolored_temporary_base');
  });
}
test('fixed and operating casements use different rule identities',()=>{
  const operating=inputFor(controls.configs[1]).configuration;
  assert.equal(selectTransferredBase(operating).rule_id,24154);
  assert.equal(selectTransferredBase({...operating,product_type:'Fixed Casement',operation:'Fixed'}).rule_id,24156);
  assert.throws(()=>selectTransferredBase({...operating,operation:'Fixed'}),/additional/);
  assert.throws(()=>selectTransferredBase({...operating,unit_type:'Glass Only'}),/Component/);
});
test('pricebooks, versions and client categories stay separate',()=>{
  assert.throws(()=>getTransferredCatalog('358',6),/Main/);
  assert.throws(()=>getTransferredCatalog('362'),/not been imported/);
  assert.notEqual(getTransferredCatalog('358').source.rate_export_sha256,getTransferredCatalog('361').source.rate_export_sha256);
  assert.equal(applyTransferredDiscount(100,'Glass',clientId).dealer,63.01);
  assert.equal(applyTransferredDiscount(100,'VMULT',clientId).dealer,45.56);
  assert.throws(()=>applyTransferredDiscount(100,'VMULT','different-client'),/own discount/);
});
test('HTTP entry requires admin and rejects unsupported actions without writing any records',async()=>{
  const request=body=>new Request('https://test.local',{method:'POST',body:JSON.stringify(body)});
  const blocked=createTransferredEngineHandler({getUser:async()=>({role:'user'})});
  assert.equal((await blocked(request({action:'status'}))).status,403);
  const handler=createTransferredEngineHandler({getUser:async()=>({role:'admin'})});
  assert.equal((await handler(request({action:'deploy'}))).status,400);
  const response=await handler(request({action:'calculate',input:inputFor(controls.configs[0])}));
  assert.equal(response.status,200);assert.equal((await response.json()).unit_prices.list,371.6);
  const status=await (await handler(request({action:'status'}))).json();
  assert.equal(status.catalogs[1].dimensional_rows,10733);assert.equal(status.production_ready,false);
});
