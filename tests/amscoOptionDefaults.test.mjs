import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogOptionDefaults} from '../base44/shared/amscoOptionDefaults.js';
import {AMSCO_SERIES,stylesForSeries,diagramPanels,applyConfiguratorSelections} from '../src/components/window-quotes/amscoConfiguratorModel.js';
import {changeProduct,frameSize} from '../src/components/window-quotes/amscoConfiguratorFlow.js';
import {automaticOptionLabel,resolvedWindowOptions,glassThicknessCorrection} from '../src/components/window-quotes/windowSpecificationDisplay.js';
const settings={color:'White',glass:'CozE (LowE)'};
const picture={style:'Studio Picture',width:60,height:66,qty:1,units:'in',dimension_basis:'call',options:{series:AMSCO_SERIES[0].value,number_wide:1}};
test('every listed window operation loads basic defaults without a price or database',()=>{
 let checked=0;
 for(const series of AMSCO_SERIES) for(const style of stylesForSeries(series.value)){
  const line={...picture,style:style.value,options:{series:series.value}};
  const before=structuredClone(line);
  const values=resolvedWindowOptions(line,settings,{status:'native_unavailable'});
  for(const key of ['unit_type','glazing_method','tempered','patterned_glass','argon','capillary_tubes','super_spacer','elevation','grilles'])
   assert.notEqual(values[key],undefined,style.value+' / '+series.value+' / '+key);
  assert.equal(values.unit_type,'Complete Unit');
  assert.equal(values.capillary_tubes,false);
  assert.equal(values.super_spacer,['Hampton','Serenity'].includes(series.family));
  assert.equal(values.hardware,diagramPanels(line).kind==='fixed'?undefined:/casement|awning/i.test(style.value)?'Standard':'Cam Latch');
  assert.deepEqual(line,before);
  checked++;
 }
 assert.ok(checked>=60);
 assert.deepEqual(catalogOptionDefaults({style:'Custom'},settings),{});
 assert.deepEqual(catalogOptionDefaults({style:'',options:{series:AMSCO_SERIES[0].value}},settings),{});
});
test('60 x 66 picture glass resolves before pricing, recalculates with size and preserves explicit overrides',()=>{
 const before=structuredClone(picture);
 const values=resolvedWindowOptions(picture,settings,{status:'native_unavailable'});
 assert.equal(values.glass_thickness,'3/16" over 3/16"');
 assert.equal(values.hardware,undefined);assert.equal(values.screen,undefined);
 assert.equal(automaticOptionLabel('capillary_tubes',picture,settings,undefined,'loading'),'No');
 assert.equal(automaticOptionLabel('super_spacer',picture,settings),'No');
 assert.equal(automaticOptionLabel('glass_thickness',picture,settings),'3/16″ over 3/16″');
 assert.deepEqual(frameSize(picture),{width:59.5,height:65.5});
 const small={...picture,width:36,height:36};
 assert.equal(resolvedWindowOptions(small,settings).glass_thickness,'SS over SS');
 const manual={...picture,options:{...picture.options,glass_thickness:'SS over SS'}};
 assert.equal(resolvedWindowOptions(manual,settings).glass_thickness,'SS over SS');
 assert.equal(glassThicknessCorrection(manual,settings),'3/16" over 3/16"');
 assert.equal(glassThicknessCorrection(picture,settings),null);
 assert.equal(glassThicknessCorrection({...manual,options:{...manual.options,glass_thickness:'3/16" over 3/16"'}},settings),null);
 assert.deepEqual(picture,before);
});
test('unported acoustic, shaped, multi-wide and alternate-glass construction stays automatic instead of inventing SS glass',()=>{
 for(const line of [
  {...picture,style:'Serenity Direct Set',options:{series:'Serenity'}},
  {...picture,style:'Studio Radius'},
  {...picture,options:{...picture.options,number_wide:2}},
  {...picture,options:{...picture.options,glass:'CozE HV (LowE 366)'}},
  {...picture,options:{...picture.options,tempered:true}}
 ]){
  assert.equal(catalogOptionDefaults(line,settings).glass_thickness,undefined);
  assert.equal(automaticOptionLabel('glass_thickness',line,settings),'By window size');
 }
 const acoustic={...picture,style:'Serenity Direct Set',options:{series:'Serenity'}};
 assert.equal(automaticOptionLabel('glass_thickness',acoustic,settings,{status:'priced',resolved_options:{glass_thickness:'STC 40'}}),'STC 40');
});
test('accessory defaults follow two-tone interior and reset when changing to fixed or crank operation',()=>{
 const colored={...picture,style:'Studio XO Slider',options:{series:AMSCO_SERIES[0].value,color:'Black exterior / White interior'}};
 assert.equal(catalogOptionDefaults(colored,settings).hardware_color,'White');
 const previous=applyConfiguratorSelections({...colored,options:{...colored.options,hardware:'Cam Latch'}},settings);
 const fixed=changeProduct(previous,'Studio Picture');
 assert.equal(fixed.options.hardware,undefined);assert.equal(fixed.options.hardware_color,undefined);assert.equal(fixed.options.screen,undefined);
 assert.equal(resolvedWindowOptions(fixed,settings).hardware,undefined);
 const crank=changeProduct(previous,'Hampton Casement','Hampton');
 assert.equal(resolvedWindowOptions(crank,settings).hardware,'Standard');
 assert.equal(resolvedWindowOptions(crank,settings).hardware_color,'White');
 const altitude={...picture,options:{...picture.options,elevation:'Above 8001'}};
 assert.equal(catalogOptionDefaults(altitude,settings).capillary_tubes,undefined);
 assert.equal(automaticOptionLabel('capillary_tubes',altitude,settings),'By installation elevation');
});
