import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {minimumStandardGlass,sourceGlassConstruction} from '../shared/amscoGlassConstruction.js';
const base={series:'Studio',product_type:'Single Hung',operation:'Single Hung',shape:'Rectangle',unit_type:'Complete Unit',dimension_basis:'frame',glass:'CozE (LowE)',glazing_method:'3/4" Insulated',tilted:false,tempered:false,width:35.5,height:83.5};
test('minimum thickness matches the independently compiled PK361 question filters',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/pk361-glass-filter-vectors.json',import.meta.url),'utf8'));
 assert.ok(fixture.vectors.length>300);
 for(const [w,h,tempered,expected] of fixture.vectors) assert.equal(minimumStandardGlass(w,h,tempered),expected,JSON.stringify({w,h,tempered}));
});
test('3070 and 4070 use actual individual panes, preserving automatic selection',()=>{
 for(const width of [35.5,47.5]) {
  const input={...base,width},before=structuredClone(input),result=sourceGlassConstruction(input);
  assert.equal(result.glass_thickness,'SS over SS');
  assert.deepEqual(result.panes.map(p=>[p.width,p.height]),[[width-1.625,40.0625],[width-4.0625,39.3125]]);
  assert.deepEqual(input,before);
 }
});
test('a larger picture window automatically changes construction',()=>{
 const picture={...base,product_type:'Direct Set',operation:'Fixed'};
 for(const [size,expected] of [[48,'SS over SS'],[50,'DS over DS'],[62,'3/16" over 3/16"']]) assert.equal(sourceGlassConstruction({...picture,width:size,height:size}).glass_thickness,expected);
 assert.equal(sourceGlassConstruction({...picture,width:8,height:20}).glass_thickness,'SS over DS');
});
test('sliders retain different constructions and reverse their locations with operation',()=>{
 const input={...base,product_type:'Single Vent',operation:'XO',width:72,height:67};
 const xo=sourceGlassConstruction(input),ox=sourceGlassConstruction({...input,operation:'OX'});
 assert.equal(xo.glass_thickness,'Differ');
 assert.deepEqual(xo.panes.map(p=>[p.name,p.glass_thickness]),[['Left glass','SS over SS'],['Right glass','DS over DS']]);
 assert.deepEqual(ox.panes.map(p=>[p.name,p.glass_thickness]),[['Left glass','DS over DS'],['Right glass','SS over SS']]);
});
test('verified Hampton controls resolve annealed and tempered construction',()=>{
 const input={...base,series:'Hampton',product_type:'Casement',operation:'Left',width:24,height:48};
 assert.equal(sourceGlassConstruction(input).glass_thickness,'SS over SS');
 assert.equal(sourceGlassConstruction({...input,width:33,height:33,tempered:true}).glass_thickness,'DS over DS');
});
test('unsupported geometry or glazing cannot acquire a standard construction',()=>{
 for(const patch of [{series:'Serenity'},{product_type:'Door'},{width:0},{width:100,height:100},{glazing_method:'1" Insulated'},{tempered:true},{shape:'Arch'},{operation:'Fixed'}]) assert.equal(sourceGlassConstruction({...base,...patch}),null);
});
