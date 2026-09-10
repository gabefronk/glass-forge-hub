import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildNativeCatalogPlan} from '../shared/nativeCatalogPlan.js';
import {verifyCatalogObservedQuote,catalogStagesMatch} from '../shared/nativeCatalogObservation.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/catalog-v2k-native.json',import.meta.url),'utf8'));
const plan=buildNativeCatalogPlan({id:fixture.quote_id,input_revision:fixture.input_revision,title:'Native observation fixture',
  settings:{dealer:fixture.dealer,yard:fixture.yard,gross_margin:fixture.gross_margin},
  lines:fixture.lines.map(line=>({style:line.style,width:line.width,height:line.height,units:'in',dimension_basis:'frame',qty:line.qty,room:line.room,
    options:{series:line.options.series,color:line.options.color,glass:line.options.glass,grilles:line.options.grilles}}))}).plan;
const context={validateIdentity:value=>/^[a-f0-9-]{36}$/.test(value.native_quote_id)?[]:[{code:'invalid_identity'}]};
test('real saved and reopened V2K observations verify exact native choices and prices',()=>{
  const checked=verifyCatalogObservedQuote(plan,structuredClone(fixture),context);assert.equal(checked.ok,true,JSON.stringify(checked.issues));
  assert.equal(checked.result.lines.length,4);assert.equal(checked.result.totals.customer_total,fixture.totals.customer_total);
});
test('altered native options, layout, per-lite grids and financial fields fail verification',()=>{
  for(let index=0;index<fixture.lines.length;index++)for(const mutate of [
    r=>r.qty++,r=>r.width++,r=>r.room='Other room',r=>r.options.native_geometry.windowset_id++,
    r=>r.options.native_geometry.number_wide=2,r=>r.options.native_grilles[0]['Number High']='9',
    r=>delete r.options.native_answers['Grille Color'],r=>r.options.native_grilles=[],
    r=>r.options.glass='Invented glass',r=>r.options.native_answers['Exterior Color']='Black',
    r=>r.unit_prices.dealer+=5,r=>r.line_totals.customer+=5,r=>r.gross_margin=40,
    r=>r.product_profile_id='catalog_264'
  ]){const actual=structuredClone(fixture);mutate(actual.lines[index]);assert.equal(verifyCatalogObservedQuote(plan,actual,context).ok,false);}
});
test('missing or stale identity, account and request evidence cannot certify a quote',()=>{
  for(const mutate of [q=>q.reopened=false,q=>q.native_source='amsco_online',q=>q.input_revision++,q=>q.quote_id='another',
    q=>q.native_quote_id='',q=>q.yard='another yard',q=>q.gross_margin=40,q=>q.totals.tax=2,q=>q.totals.customer_total+=1,
    q=>q.lines.push(structuredClone(q.lines[0]))]){
    const actual=structuredClone(fixture);mutate(actual);assert.equal(verifyCatalogObservedQuote(plan,actual,context).ok,false);
  }
  assert.equal(verifyCatalogObservedQuote(plan,fixture).ok,false);
});
test('changes between native save stages are rejected independently of final prices',()=>{
  const stages=Object.fromEntries(['before_save','after_save','reopened'].map(n=>[n,structuredClone(fixture)]));
  assert.equal(catalogStagesMatch(stages),true);stages.after_save.lines[0].options.native_grilles[0]['Number Wide']='8';
  assert.equal(catalogStagesMatch(stages),false);
});
