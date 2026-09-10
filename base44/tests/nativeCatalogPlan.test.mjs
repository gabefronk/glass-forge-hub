import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG_ROUTES,buildNativeCatalogPlan,assertNativeCatalogPlan,catalogPlanHash,buildCatalogWindowPackage} from '../shared/nativeCatalogPlan.js';
const quote=(line={},settings={})=>({id:'catalog-test',input_revision:1,title:'Native catalog test',
  settings:{dealer:'BFS',yard:'BFS-UTAH DESIGN(11)',gross_margin:30,color:'White',glass:'CozE (LowE)',...settings},
  lines:[{style:'Hampton Casement',width:23,height:56.5,units:'in',dimension_basis:'frame',room:'Living',qty:1,options:{series:'Hampton'},...line}]});
test('all 44 catalog routes build immutable plans without borrowing a Studio recipe',()=>{
  assert.equal(CATALOG_ROUTES.length,44);assert.equal(new Set(CATALOG_ROUTES.map(r=>r.windowset_id)).size,44);
  for(const route of CATALOG_ROUTES){
    const result=buildNativeCatalogPlan(quote({style:route.style,options:{series:route.series}}));
    assert.equal(result.ok,true,JSON.stringify(result.issues));assert.equal(assertNativeCatalogPlan(result.plan).ok,true);
    assert.equal(result.plan.lines[0].native_windowset_id,route.windowset_id);
    assert.deepEqual(result.plan.lines[0].native_questions.map(q=>q.name),['Exterior Color','Interior Color','Glass Type']);
  }
});
test('catalog plans preserve exact fraction sizes, tempering, grids and room text',()=>{
  const result=buildNativeCatalogPlan(quote({width:22.75,height:56.75,qty:2,room:'Bay 1 & 2',options:{series:'Hampton',tempered:true,grilles:'5/8" Flat · Rectangular · 2W4H per lite · White'}}));
  assert.equal(result.ok,true);const row=result.plan.lines[0];
  assert.deepEqual(row.frame_dimensions,{width:22.75,height:56.75,units:'in'});
  assert.equal(row.qty,2);assert.equal(row.room,'Bay 1 & 2');
  assert.deepEqual(row.native_questions.filter(q=>['Tempered','Number Wide','Number High'].includes(q.name)),
    [{name:'Tempered',value:'Yes'},{name:'Number Wide',value:'2'},{name:'Number High',value:'4'}]);
});
test('explicit product, option and measurement uncertainties remain online work',()=>{
  for(const line of [
    {style:'Andersen Casement'},{options:{series:'Imaginary'}},{options:{series:'Studio Flush Fin'}},
    {options:{series:'Hampton',special_instruction:'use bronze'}},{options:{series:'Hampton',number_wide:2}},
    {options:{series:'Hampton',grilles:'5/8" Flat · Rectangular · 2W4H per window · White'}},
    {dimension_basis:'rough_opening'},{dimension_basis:'call'},{components:[{width:12}]}
  ])assert.equal(buildNativeCatalogPlan(quote(line)).ok,false,JSON.stringify(line));
});
test('a pinned route, native question, frame offset or field cannot be forged into a plan',()=>{
  const original=buildNativeCatalogPlan(quote()).plan;
  for(const mutate of [
    p=>p.lines[0].native_windowset_id=264,p=>p.lines[0].product_profile_id='catalog_264',
    p=>p.lines[0].native_questions[0].value='Black',p=>p.lines[0].frame_dimensions.width=1,
    p=>p.invented_contract=true,p=>p.lines[0].extra_charge=100
  ]){const changed=structuredClone(original);mutate(changed);assert.equal(assertNativeCatalogPlan(changed).ok,false);}
});
test('explicit line finishes override job defaults without changing the requested colors',()=>{
  const result=buildNativeCatalogPlan(quote({options:{series:'Hampton',color:'Black exterior / White interior'}}));
  assert.equal(result.ok,true);
  assert.deepEqual(result.plan.lines[0].native_questions.slice(0,2),[{name:'Exterior Color',value:'Black'},{name:'Interior Color',value:'White'}]);
  assert.equal(buildNativeCatalogPlan(quote({options:{series:'Hampton',color:'White',exterior_color:'Black',interior_color:'White'}})).ok,false);
});
test('unsupported finance instructions and invalid quantities cannot disappear',()=>{
  for(const settings of [{tax:10},{markup:20},{dealer:'different'},{gross_margin:100},{unknown:true}])
    assert.equal(buildNativeCatalogPlan(quote({},settings)).ok,false);
  for(const qty of [0,1.5,1001,NaN])assert.equal(buildNativeCatalogPlan(quote({qty})).ok,false);
});
test('native XML is escaped and bound to the exact canonical plan hash',async()=>{
  const input=quote({room:'Bay <south> & "north"'});input.title="Owner's quote";
  const plan=buildNativeCatalogPlan(input).plan,planHash=await catalogPlanHash(plan),pkg=await buildCatalogWindowPackage(plan,{planHash});
  assert.match(pkg.xml,/Bay &lt;south&gt; &amp; &quot;north&quot;/);
  assert.match(pkg.xml,/Owner&apos;s quote/);assert.match(pkg.xml,new RegExp('planHash="'+planHash+'"'));
  await assert.rejects(buildCatalogWindowPackage(plan,{planHash:'0'.repeat(64)}));
  plan.lines[0].native_questions[0].value='Black';await assert.rejects(buildCatalogWindowPackage(plan,{planHash:await catalogPlanHash(plan)}));
});

test('series named in the product description cannot silently change installation or assembly',()=>{
  const flush=buildNativeCatalogPlan(quote({style:'Hampton Flush Fin Casement',options:{}}));
  assert.equal(flush.ok,true);assert.equal(flush.plan.lines[0].native_windowset_id,748);
  assert.equal(buildNativeCatalogPlan(quote({style:'Hampton Flush Fin Casement',options:{series:'Hampton'}})).ok,false);
  assert.equal(buildNativeCatalogPlan(quote({style:'Hampton Double Casement'})).ok,false);
  assert.equal(buildNativeCatalogPlan(quote({}, {yard:'PLEASE SELECT YARD'})).ok,false);
});

test('standard Studio nail-fin aliases preserve catalog selection and call-to-frame conversion', () => {
  for (const fin of ['Nail Fin', 'nailing fin', 'standard nail fin', 'regular nail fin', '1 3/8 inch Fin Setback']) {
    const input=quote({style:'Studio Single Hung',width:36,height:84,dimension_basis:'call',options:{fin}});
    const before=structuredClone(input), result=buildNativeCatalogPlan(input);
    assert.equal(result.ok,true,JSON.stringify(result.issues));
    assert.equal(result.plan.lines[0].native_windowset_id,264);
    assert.deepEqual(result.plan.lines[0].frame_dimensions,{width:35.5,height:83.5,units:'in'});
    assert.equal(result.plan.lines[0].options.fin,undefined);
    assert.equal(assertNativeCatalogPlan(result.plan).ok,true);
    assert.deepEqual(input,before);
  }
});
test('conflicting or unknown fin choices never silently become standard installation', () => {
  for (const options of [{fin:'Custom Fin'}, {fin:'Flush Fin'}, {series:'Studio Flush Fin',fin:'Nail Fin'}]) {
    assert.equal(buildNativeCatalogPlan(quote({style:'Studio Single Hung',options})).ok,false);
  }
  assert.equal(buildNativeCatalogPlan(quote({options:{series:'Hampton',fin:'Nail Fin'}})).ok,false);
  assert.equal(buildNativeCatalogPlan(quote({style:'Studio Single Hung',options:{}},{fin:'Nail Fin'})).ok,true);
  assert.equal(buildNativeCatalogPlan(quote({style:'Studio Single Hung',options:{}},{fin:'Custom Fin'})).ok,false);
});
