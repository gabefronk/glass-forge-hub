import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STYLE_CHOICES, createBuilderLine, duplicateBuilderLine, parseTradeCode, formatTradeCode, normalizeBuilderLines, summarizeBuilderLines, buildBuilderPreview } from '../src/components/window-quotes/windowBuilderModel.js';
import { STANDARD_STUDIO_PROFILE } from '../src/lib/easyRequest.js';
import { assertSupportedPlan } from '../src/lib/amscoQuotePlan.js';
const settings = { dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' };
const source = { easy_request: { profile_id: STANDARD_STUDIO_PROFILE.id, profile_revision: STANDARD_STUDIO_PROFILE.revision, confirmed: true, units: 'in', dimension_basis: 'call' } };
const line = (style = 'Studio XO Slider', width = 60, height = 60, options = {}) => createBuilderLine(style, { width, height, options });
const preview = (lines, selected = settings, selectedSource = source) => buildBuilderPreview(selected, lines, selectedSource);

test('new and duplicate rows have separate identities without copying recipe options or merging rooms', () => {
  const first = createBuilderLine('XO'), second = createBuilderLine('XO');
  assert.notEqual(first.id, second.id); assert.equal(first.style, 'Studio XO Slider'); assert.deepEqual(first.options, {});
  const original = line(); original.room = 'Kitchen'; original.mark = 'W1'; original.old_note = { retained: true };
  const copy = duplicateBuilderLine(original); assert.notEqual(copy.id, original.id);
  const a = structuredClone(original), b = structuredClone(copy);delete a.id;delete b.id;assert.deepEqual(a, b);
  copy.old_note.retained = false; assert.equal(original.old_note.retained, true);
  assert.equal(STYLE_CHOICES.at(-1).value, 'Custom');
});
test('trade codes map feet and inches exactly and reject malformed or zero-size input', () => {
  for (const [code, width, height] of [['3050',36,60],['5050',60,60],['5060',60,72],['4040',48,48],['1121',13,25],['9999',117,117]]) {
    const parsed = parseTradeCode(code); assert.equal(parsed.ok,true); assert.equal(parsed.width,width); assert.equal(parsed.height,height);
    assert.equal(parsed.dimension_basis,'call'); assert.equal(formatTradeCode(width,height),code);
  }
  for (const value of ['',null,{},'305','30500','3O50','30x50','3/0x5/0','0000','0050','3000',NaN]) assert.equal(parseTradeCode(value).ok,false,String(value));
  for (const [width,height] of [[0,60],[36.5,60],[120,60],[23,60],['36',60]]) assert.equal(formatTradeCode(width,height),'');
});
test('5050 and5060 standard sliders validate with native ancillary fields omitted', () => {
  const rows = ['5050','5060'].map(trade_code => createBuilderLine('Studio XO Slider', { trade_code }));
  const result = preview(rows); assert.equal(result.ok,true,JSON.stringify(result.questions)); assert.equal(result.state,'complete');
  assert.equal(result.lines[0].width,60); assert.equal(result.lines[1].height,72); assert.equal(assertSupportedPlan(result.plan).ok,true);
  for (const row of result.plan.lines) {
    assert.deepEqual(row.native_default_fields,['capillary_tubes','glass_thickness','glazing_method','super_spacer']);
    for (const key of row.native_default_fields) assert.equal(Object.hasOwn(row.options,key),false);
  }
  result.lines.forEach(row=>assert.deepEqual(row.options,{}));
  assert.equal(result.pricing,'live_amsco_required'); assert.equal(result.total,undefined); assert.equal(result.plan.lines[0].unit_prices,undefined);
});
test('standard main defaults inherit current global color and glass without stale copied overrides', () => {
  const rows=[line('Studio Single Hung',36,60)];
  const white=preview(rows), taupe=preview(rows,{...settings,color:'Taupe'});
  assert.equal(white.ok,true);assert.equal(taupe.ok,true);
  assert.equal(white.plan.lines[0].options.hardware_color,'White');assert.equal(taupe.plan.lines[0].options.hardware_color,'Taupe');
  assert.deepEqual(rows[0].options,{});assert.deepEqual(taupe.lines[0].options,{});
  const contrary=preview(rows,{...settings,glass:'Clear'});assert.equal(contrary.ok,false);assert.equal(contrary.settings.glass,'Clear');
  const omitted=preview(rows,{...settings,glass:''});assert.equal(omitted.ok,true);assert.equal(omitted.settings.glass,'CozE (LowE)');
  const explicitNoLowE=preview(rows,{...settings,glass:'',low_e:false});assert.equal(explicitNoLowE.ok,false);
});
test('explicit DS or SS requirements survive unchanged rather than acquiring native-default exemption', () => {
  const ds=line('Studio XO Slider',60,72,{glass_thickness:'DS over DS'}), before=structuredClone(ds);
  const rejected=preview([ds]);assert.equal(rejected.ok,false);assert.deepEqual(ds,before);assert.equal(rejected.lines[0].options.glass_thickness,'DS over DS');
  const ss=preview([line('Studio XO Slider',60,72,{glass_thickness:'SS over SS'})]);assert.equal(ss.ok,true);
  assert.equal(ss.plan.lines[0].native_default_fields.includes('glass_thickness'),false);assert.equal(ss.plan.lines[0].options.glass_thickness,'SS over SS');
});
test('rows, marks, rooms and old data remain intact; duplicate IDs are repaired without deduplicating windows', () => {
  const rows=[{...line(),id:'old',mark:'W1',room:'Kitchen',legacy:{origin:'import'}},{...line(),id:'old',mark:'W2',room:'Bedroom'},{...line(),id:'old-copy-1',room:'Kitchen'}];
  const before=structuredClone(rows), normalized=normalizeBuilderLines(rows);
  assert.equal(normalized.lines.length,3);assert.equal(new Set(normalized.lines.map(row=>row.id)).size,3);assert.equal(normalized.lines[0].id,'old');
  assert.equal(normalized.lines[1].id,'old-copy-2');assert.equal(normalized.lines[2].id,'old-copy-1');
  assert.deepEqual(normalized.lines.map(row=>row.room),['Kitchen','Bedroom','Kitchen']);assert.deepEqual(normalized.lines[0].legacy,{origin:'import'});assert.deepEqual(rows,before);
});
test('invalid code or a conflicting existing dimension is retained and requires review', () => {
  const invalid=preview([createBuilderLine('Studio XO Slider',{trade_code:'50X0'})]);assert.equal(invalid.ok,false);assert.equal(invalid.lines[0].trade_code,'50X0');
  const conflicting=preview([createBuilderLine('Studio XO Slider',{trade_code:'5050',width:48,height:60})]);
  assert.equal(conflicting.ok,false);assert.equal(conflicting.lines[0].width,48);assert.ok(conflicting.questions.some(text=>/disagree/.test(text)));
});
test('explicit frame or rough-opening dimensions are never silently converted from trade code', () => {
  for(const basis of ['frame','rough_opening']) {const result=preview([createBuilderLine('Studio XO Slider',{trade_code:'5050',dimension_basis:basis})]);assert.equal(result.ok,false);assert.equal(result.lines[0].dimension_basis,basis);}
});
test('all line reviews remain present when a later line or malformed earlier line blocks the package', () => {
  const rows=[line(),line('Custom'),line('Studio XO Slider',60,72)];
  const result=preview(rows);assert.equal(result.ok,false);assert.equal(result.lineReviews.length,3);
  assert.deepEqual(result.lineReviews.map(row=>row.ok),[true,false,true]);
  assert.ok(result.lineReviews[1].questions.every(message=>!/(Cam Latch|screen color|SS over SS)/.test(message)));
  const malformed=preview([null,line()]);assert.equal(malformed.ok,false);assert.equal(malformed.lines.length,2);assert.deepEqual(malformed.lineReviews.map(row=>row.ok),[false,true]);
});
test('malformed settings, option containers, quantities and non-finite dimensions cannot produce complete', () => {
  for(const changed of [row=>row.options=[],row=>row.qty='one',row=>row.qty=0,row=>row.width=Infinity,row=>row.width='1e2',row=>row.height=-1]) {
    const row=line();changed(row);const p=preview([row]);assert.equal(p.ok,false);assert.equal(p.state,'request_review');
  }
  assert.equal(preview([],settings).ok,false);assert.equal(buildBuilderPreview(null,[line()],source).ok,false);assert.equal(buildBuilderPreview(settings,{},source).ok,false);
});
test('strict numeric form values normalize but missing finance and unconfirmed preset still require review', () => {
  const p=preview([{...line(),qty:'2',width:'60',height:'72'}],{...settings,gross_margin:'30'});
  assert.equal(p.ok,true);assert.equal(p.lines[0].qty,2);assert.equal(p.settings.gross_margin,30);
  const missing=preview([line()],{...settings,yard:''});assert.equal(missing.ok,false);assert.ok(missing.lineReviews[0].questions.some(text=>/yard/.test(text)));
  const noConsent=preview([line()],settings,{easy_request:{...source.easy_request,confirmed:false}});assert.equal(noConsent.ok,false);
});
test('global and explicit main choices survive; unsupported choices stay reviewable', () => {
  const flush=preview([line('Studio XO Slider',60,60,{fin:'flush fin'})]);assert.equal(flush.ok,true);assert.equal(flush.plan.lines[0].options.series,'Studio Flush Fin');
  const picture=preview([line('Studio Picture',96,72,{tempered:true,patterned_glass:'None'})]);assert.equal(picture.ok,true);assert.equal(picture.plan.lines[0].options.glass_thickness,'1/4 inch over 1/4 inch');
  const obscure=preview([line('Studio Picture',96,72,{tempered:true,patterned_glass:'Obscure'})]);assert.equal(obscure.ok,false);assert.equal(obscure.lines[0].options.patterned_glass,'Obscure');
  const custom=preview([line('Custom',48,48,{glass:'custom etched'})]);assert.equal(custom.ok,false);assert.equal(custom.lines[0].options.glass,'custom etched');assert.equal(custom.lines[0].style,'Custom');
});
test('opaque older instructions are preserved and require AI review even when structured fields are supported', () => {
  const old={...line(),notes:'Use custom etched glass and no screen'};
  const p=preview([old]);assert.equal(p.ok,false);assert.equal(p.lines[0].notes,old.notes);assert.ok(p.questions.some(text=>/additional instructions/.test(text)));
});
test('summary counts requested units without merging configurations or estimating prices', () => {
  const rows=[{...line(),qty:2},{...line('Studio Picture',48,48),qty:3}], summary=summarizeBuilderLines(rows);
  assert.equal(summary.lineCount,2);assert.equal(summary.unitCount,5);assert.equal(summary.byStyle.length,2);assert.equal(summary.total,undefined);
  rows[1].qty='?';assert.equal(summarizeBuilderLines(rows).unitCount,null);
});
test('frontend structured normalizer is the exact backend source, not a separate recipe implementation', () => {
  const frontend=fs.readFileSync(new URL('../src/lib/structuredQuoteIntake.js',import.meta.url),'utf8');
  const backend=fs.readFileSync(new URL('../base44/shared/structuredQuoteIntake.js',import.meta.url),'utf8');
  assert.equal(frontend,backend);
});
