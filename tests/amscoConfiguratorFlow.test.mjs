import test from "node:test";
import assert from "node:assert/strict";
import { newConfiguratorLine, isPristineConfiguratorLine, changeProduct, changeConfiguratorSeries, changeNumberWide, callSizeMenu, chooseCallWidth, configurationReadiness, frameSize, COZE_CHOICES } from "../src/components/window-quotes/amscoConfiguratorFlow.js";
import { validateBuilderDraft, normalizeManualBuilderDraft, builderReviewResponse } from "../base44/shared/windowQuoteBuilder.js";
const settings = { dealer: "BFS", yard: "BFS-UTAH DESIGN(11)", gross_margin: 30, color: "White", glass: "CozE (LowE)" };
function selected() {
  return changeNumberWide(changeProduct(newConfiguratorLine(), "Studio Single Hung"), 1);
}
test("new quote starts unselected and cannot advance or save an implicit single hung", () => {
  const line = newConfiguratorLine();
  assert.equal(line.style, "");
  assert.ok(isPristineConfiguratorLine(line));
  assert.equal(configurationReadiness(line).canSave, false);
  const styled = changeProduct(line, "Studio Single Hung");
  assert.equal(configurationReadiness(styled).product, false);
  const wide = changeNumberWide(styled, 1);
  assert.equal(configurationReadiness(wide).product, true);
  assert.equal(configurationReadiness(wide).size, false);
});
test("Studio SH call dropdown uses Navigator menu values instead of PK361 price brackets", () => {
  const menu = callSizeMenu(selected());
  assert.deepEqual(menu.widths, [12,18,24,30,36,42,48]);
  assert.deepEqual(menu.heightsByWidth["36"], [24,30,36,42,48,54,60,66,72,78,84,90,96]);
  assert.equal(menu.widths.includes(54), false);
  assert.equal(menu.heightsByWidth["36"].includes(102), false);
  assert.equal(callSizeMenu(newConfiguratorLine()), null);
  assert.equal(callSizeMenu(changeNumberWide(selected(), 2)), null);
});
test("product, series and assembly changes invalidate dependent dimensions and operation only", () => {
  const original = { ...selected(), width:36,height:60,room:"Kitchen",qty:2,options:{...selected().options,operation:"Single Hung",sash_split:"Even",tempered:true,grilles:"None",color:"Black"} };
  for (const next of [changeProduct(original,"Studio XO Slider"),changeConfiguratorSeries(original,"Hampton"),changeNumberWide(original,2)]) {
    assert.equal(next.width,""); assert.equal(next.height,""); assert.equal(next.options.operation,undefined);
    assert.equal(next.options.tempered,true); assert.equal(next.options.color,"Black"); assert.equal(next.options.grilles,"None");
    assert.equal(next.room,"Kitchen"); assert.equal(next.qty,2); assert.equal(original.width,36);
  }
  assert.equal(changeConfiguratorSeries(original,"Hampton").style,"");
});
test("width change retains only a height available for the new width", () => {
  const line={style:"V2K BW Single Vent",width:48,height:60,options:{series:"V2K BW",number_wide:1}};
  assert.equal(chooseCallWidth(line,24).height,"");
  assert.equal(chooseCallWidth(line,72).height,60);
  assert.deepEqual(chooseCallWidth(line,""),{width:"",height:"",dimension_basis:"call"});
});
test("custom measurements and existing edit rows are retained, with quantity validation", () => {
  const line={...selected(),width:35.25,height:59.125,dimension_basis:"frame"};
  assert.equal(configurationReadiness(line).canSave,true);
  assert.equal(configurationReadiness({...line,qty:0}).canSave,false);
  assert.equal(configurationReadiness({...line,qty:1.5}).canSave,false);
  assert.equal(configurationReadiness({...line,qty:1001}).canSave,false);
  const legacy={...line,options:{series:line.options.series}};
  assert.equal(configurationReadiness(legacy,{legacy:true}).canSave,true);
  assert.deepEqual(frameSize(line),{width:35.25,height:59.125});
  assert.deepEqual(frameSize({...selected(),width:36,height:60}),{width:35.5,height:59.5});
  assert.equal(frameSize({...changeNumberWide(selected(),2),width:72,height:60}),null);
});
test("new dropdown selections retain types and all CozE requests through server validation", async () => {
  for (const glass of COZE_CHOICES) {
    const line={...selected(),width:36,height:60,options:{...selected().options,glass,tempered:false,sash_split:"Even"}};
    const draft=validateBuilderDraft({settings,lines:[line],source:{amsco_configurator:{version:1}}});
    assert.equal(draft.lines[0].options.glass,glass);
    assert.equal(draft.lines[0].options.number_wide,1);
    const review=await builderReviewResponse(normalizeManualBuilderDraft(draft),{allowOnline:true});
    assert.equal(review.draft.lines[0].options.glass,glass);
  }
});
