import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { priceSourceWindow, sourcePricePreview, sourcePriceReceipt, sourcePriceEvidenceIssues } from '../shared/amscoSourcePricing.js';
import { minimumStandardGlass, sourceGlassConstruction } from '../shared/amscoGlassConstruction.js';
import { builderPricePreview } from '../shared/windowQuoteBuilder.js';

const settings = {dealer:'BFS',yard:'BFS-UTAH DESIGN(11)',gross_margin:30,color:'White',glass:'CozE (LowE)'};
const line = {id:'great-lakes-picture',style:'Studio Picture',qty:1,width:60,height:96,units:'in',dimension_basis:'call',options:{
  series:'Studio 1 3/8 inch Fin Setback',fin:'nail fin',unit_type:'Complete Unit',number_wide:1,
  exterior_color:'White',interior_color:'White',tempered:false,patterned_glass:'None',argon:false,
  elevation:'2501 to 6500',super_spacer:false,glazing_method:'3/4" Insulated',capillary_tubes:false,grilles:'None',operation:'Fixed'
}};

test('60 x 96 call picture prices automatically with native minimum glass and no queue', async () => {
  const before = structuredClone(line);
  const db = new Proxy({}, {get(){throw Error('Source pricing must not need a queue or cached quote');}});
  const preview = await builderPricePreview({settings,lines:[line],source:{amsco_configurator:{version:1}}},db,
    {config:{native_engine:{catalog_id:'361',source_pricing:true}},user:{id:'owner',role:'admin'}});
  assert.equal(preview.ready,true);
  assert.equal(preview.pending,false);
  assert.equal(preview.total,548.29);
  const price = preview.lines[0];
  assert.deepEqual(price.unit_prices,{list:842.4,dealer:383.8,customer:548.29});
  assert.equal(price.resolved_options.glass_thickness,'3/16" over 3/16"');
  assert.deepEqual(price.glass_construction.panes.map(p=>[p.width,p.height]),[[57.8125,93.8125]]);
  assert.deepEqual(line,before);
  const calculated = priceSourceWindow({line,settings}).calculated;
  assert.equal(calculated.components.length,1);
  assert.equal(calculated.components[0].source.row_id,'afb1f5e9-6e58-4c23-9c41-de3865af34ba');
  assert.deepEqual(calculated.components[0].source.cell,{width:60,height:96});
});

test('minimum glass uses pane area through the native 48-square-foot boundary', () => {
  assert.equal(minimumStandardGlass(72,96),'3/16" over 3/16"');
  assert.equal(minimumStandardGlass(72,96.0625),null);
  assert.equal(minimumStandardGlass(120,40),'3/16" over 3/16"');
  assert.equal(minimumStandardGlass(120.0625,40),null);
  const configuration = priceSourceWindow({line,settings}).input.configuration;
  const atLimit = {...configuration,width:73.6875,height:97.6875};
  assert.equal(sourceGlassConstruction(atLimit).glass_thickness,'3/16" over 3/16"');
  assert.equal(sourceGlassConstruction({...atLimit,height:97.75}),null);
  assert.equal(sourceGlassConstruction({...configuration,width:100,height:100}),null);
});

test('large-pane construction matches independent native PK361 IL observations', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../docs/pk361-large-glass-filter-vectors.json',import.meta.url),'utf8'));
  assert.equal(fixture.vectors.length,9);
  for (const vector of fixture.vectors) {
    const expected = vector.pane_R413.first_surviving_answer;
    const actual = minimumStandardGlass(vector.glass_width,vector.glass_height);
    // Native quarter-inch glass exists, but that construction is outside this release.
    assert.equal(actual,expected==='1/4" over 1/4"' ? null : expected,vector.label);
  }
});

test('large picture construction overrides and unported choices remain explicit blockers', () => {
  const automatic = sourcePricePreview({line,settings});
  const exact = sourcePricePreview({line:{...line,options:{...line.options,glass_thickness:'3/16" over 3/16"'}},settings});
  assert.deepEqual(exact.unit_prices,automatic.unit_prices);
  assert.equal(priceSourceWindow({line:{...line,options:{...line.options,glass_thickness:'SS over SS'}},settings}).code,'glass_construction_override');
  for (const options of [{tempered:true},{argon:true},{number_wide:2},{glazing_method:'1" Insulated'},
    {exterior_color:'Black'},{grilles:'5/8" Flat · Rectangular · 2W4H per lite · White'}])
    assert.equal(sourcePricePreview({line:{...line,options:{...line.options,...options}},settings}),null);
  assert.equal(sourcePricePreview({line:{...line,width:100,height:100},settings}),null);
  assert.equal(sourcePricePreview({line:{...line,style:'Studio XO Slider',width:96,height:72,options:{operation:'XO'}},settings}),null);
});

test('large picture receipts recompute exact price, quantity, margin and selections', () => {
  const selected = {...line,qty:3};
  const priced = sourcePricePreview({line:selected,settings});
  assert.deepEqual(priced.line_totals,{list:2527.2,dealer:1151.4,customer:1644.87});
  assert.equal(sourcePricePreview({line,settings:{...settings,gross_margin:20}}).unit_prices.customer,479.75);
  const row = sourcePriceReceipt({line:selected,settings,checkedAt:'2026-09-11T16:00:00Z'});
  const evidence = {...row.source_evidence,source:row.source};
  assert.deepEqual(sourcePriceEvidenceIssues(evidence,row.result.lines[0],selected,settings),[]);
  assert.ok(sourcePriceEvidenceIssues(evidence,row.result.lines[0],{...selected,height:90},settings).length);
});

test('older valid receipts remain usable within their original coverage only', () => {
  const existing = {...line,style:'Studio Single Hung',width:36,height:72,options:{fin:'Nail Fin'}};
  const receipt = sourcePriceReceipt({line:existing,settings,checkedAt:'2026-09-10T16:00:00Z'});
  const legacy = {...receipt.source_evidence,source:receipt.source,version:'pk361-standard-2026-09-10-v1'};
  assert.deepEqual(sourcePriceEvidenceIssues(legacy,receipt.result.lines[0],existing,settings),[]);
  const changed = structuredClone(receipt.result.lines[0]); changed.unit_prices.customer++;
  assert.ok(sourcePriceEvidenceIssues(legacy,changed,existing,settings).length);
  assert.ok(sourcePriceEvidenceIssues(legacy,receipt.result.lines[0],{...existing,width:42},settings).length);
  assert.ok(sourcePriceEvidenceIssues({...legacy,version:'unknown'},receipt.result.lines[0],existing,settings).length);
  const large = sourcePriceReceipt({line,settings,checkedAt:'2026-09-11T16:00:00Z'});
  assert.ok(sourcePriceEvidenceIssues({...large.source_evidence,source:large.source,version:legacy.version},large.result.lines[0],line,settings).length);
});
