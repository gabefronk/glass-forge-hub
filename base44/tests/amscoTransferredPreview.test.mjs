import test from 'node:test';
import assert from 'node:assert/strict';
import { transferredPreviewComparison } from '../shared/amscoTransferredPreview.js';

const settings={dealer:'BFS',yard:'BFS-UTAH DESIGN(11)',gross_margin:30,color:'White',glass:'CozE (LowE)'};
const line={id:'control',style:'Hampton Casement',width:24,height:48,units:'in',dimension_basis:'frame',qty:2,options:{series:'Hampton'},room:'Control'};
test('the builder comparison matches Hampton pricing without changing the verified result',()=>{
  const observed={status:'priced',unit_prices:{list:725.4,dealer:330.49,customer:472.13},line_totals:{customer:944.26}};
  const original=structuredClone(observed);
  const comparison=transferredPreviewComparison({line,settings,observed});
  assert.equal(comparison.status,'matches_verified_price');assert.equal(comparison.calculated_list,725.4);
  assert.equal(comparison.production_ready,false);assert.deepEqual(observed,original);
});
test('an unavailable or differing native price is not silently accepted',()=>{
  assert.equal(transferredPreviewComparison({line,settings,observed:{status:'calculating'}}).status,'awaiting_verified_price');
  const mismatch=transferredPreviewComparison({line,settings,observed:{unit_prices:{list:725.5}}});
  assert.equal(mismatch.status,'price_difference');assert.equal(mismatch.difference,-.1);
});
test('unsupported options and measurement types stay explicit',()=>{
  assert.equal(transferredPreviewComparison({line:{...line,options:{screen:'No'}},settings}).status,'not_calculated');
  assert.equal(transferredPreviewComparison({line:{...line,dimension_basis:'rough'},settings}).status,'not_calculated');
  assert.equal(transferredPreviewComparison({line:{...line,options:{tempered:true}},settings}).status,'not_calculated');
  assert.equal(transferredPreviewComparison({line,settings:{...settings,argon:true}}).status,'not_calculated');
});
