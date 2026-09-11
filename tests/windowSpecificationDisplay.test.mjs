import test from "node:test";
import assert from "node:assert/strict";
import { automaticOptionLabel, glassSpecification, resolvedWindowOptions, specificationValue, currentPricePreview, GLASS_THICKNESS_CHOICES } from "../src/components/window-quotes/windowSpecificationDisplay.js";
const settings={glass:"CozE (LowE)",color:"White"};
const line={style:"Studio Single Hung",width:36,height:84,options:{}};
test("resolved non-tempered and pane construction appear without creating explicit choices",()=>{
 const original=structuredClone(line);
 const price={status:"priced",resolved_options:{glass:"CozE (LowE)",tempered:false,glazing_method:'3/4" Insulated',glass_thickness:"DS over DS",super_spacer:false}};
 assert.equal(automaticOptionLabel("tempered",line,settings,price),"No");
 assert.equal(automaticOptionLabel("super_spacer",line,settings,price),"No");
 assert.equal(automaticOptionLabel("glass_thickness",line,settings,price),"Double-strength over double-strength (DS/DS)");
 assert.match(glassSpecification(line,settings,price),/Non-tempered glass.*3\/4″ insulated glass unit.*Double-strength/);
 assert.deepEqual(line,original);
});
test("native thickness follows the new result and stale or pending results cannot masquerade as the new size",()=>{
 const old={inputKey:"small",status:"ready",lines:[{status:"priced",resolved_options:{glass_thickness:"SS over SS"}}]};
 assert.equal(currentPricePreview(old,"small"),old);
 assert.deepEqual(currentPricePreview(old,"large").lines,[]);
 const result={status:"priced",resolved_options:{glass_thickness:"DS over DS"}};
 assert.match(automaticOptionLabel("glass_thickness",{...line,width:60},settings,result),/^Double-strength/);
 assert.equal(resolvedWindowOptions(line,settings,{...result,status:"calculating"}).glass_thickness,undefined);
});
test("an unreturned thickness is identified as unresolved rather than guessed from size or from SS defaults",()=>{
 const source={status:"priced",resolved_options:{tempered:false,glazing_method:'3/4" Insulated'}};
 assert.equal(automaticOptionLabel("glass_thickness",line,settings,source),"— Select —");
 assert.equal(automaticOptionLabel("glass_thickness",line,settings,undefined,"loading"),"Loading…");
 assert.equal(automaticOptionLabel("glass_thickness",{...line,width:""},settings),"— Select —");
 assert.equal(resolvedWindowOptions(line,settings,source).glass_thickness,undefined);
});
test("quote defaults, explicit overrides and fractional pane descriptions retain their meaning",()=>{
 const explicit={...line,options:{tempered:true,glass_thickness:'3/16" over 3/16"'}};
 assert.equal(automaticOptionLabel("tempered",explicit,{tempered:false}),"No");
 assert.equal(automaticOptionLabel("glass_thickness",explicit,settings),"Recalculate automatic selection");
 assert.equal(specificationValue("glass_thickness","3/16 inch over 3/16 inch"),"3/16″ over 3/16″");
 assert.match(glassSpecification(explicit,settings),/Tempered glass.*3\/16″ over 3\/16″/);
 assert.match(specificationValue("glass_thickness","SS"),/pane construction unspecified/);
 assert.ok(GLASS_THICKNESS_CHOICES.every(choice=>choice.value!=="SS"&&choice.value!=="DS"));
});

test("existing source price responses still expose their applied defaults during an update",()=>{
 const price={status:"priced",price_source:"amsco_source_engine",source_engine:{applied_defaults:{tempered:false,glazing_method:'3/4" Insulated'}}};
 assert.equal(automaticOptionLabel("tempered",line,settings,price),"No");
 assert.match(glassSpecification(line,settings,price),/Non-tempered glass.*3\/4″/);
 assert.equal(resolvedWindowOptions(line,settings,price).glass_thickness,undefined);
});

test("different lites display their full constructions without exposing raw metadata",()=>{
 const price={status:"priced",resolved_options:{glass_thickness:"Differ",glass_panes:[{name:"Upper glass",glass_thickness:"SS over SS"},{name:"Lower glass",glass_thickness:"DS over DS"}]}};
 const label=automaticOptionLabel("glass_thickness",line,settings,price);
 assert.match(label,/Upper glass: Single-strength.*Lower glass: Double-strength/);
 assert.match(glassSpecification(line,settings,price),/Upper glass: Single-strength.*Lower glass: Double-strength/);
 assert.equal(specificationValue("glass_thickness","SS over DS"),"Single-strength over Double-strength");
});


test("Studio dropdowns use plain display values without changing requested options or overriding native results",()=>{
 const original=structuredClone(line);
 const source={status:"priced",resolved_options:{tempered:false}};
 assert.equal(automaticOptionLabel("elevation",line,settings,source),"2501 to 6500");
 assert.equal(automaticOptionLabel("super_spacer",line,settings,source),"No");
 assert.equal(automaticOptionLabel("hardware",line,settings,source),"Cam Latch");
 assert.equal(automaticOptionLabel("glass",line,settings,source),"CozE (LowE)");
 assert.equal(automaticOptionLabel("super_spacer",line,settings,{status:"priced",resolved_options:{super_spacer:true}}),"Yes");
 assert.equal(automaticOptionLabel("elevation",line,{elevation:"Below 1000"},source),"Below 1000");
 assert.equal(automaticOptionLabel("hardware",{...line,style:"Hampton Casement"},settings,source),"— Select —");
 assert.equal(resolvedWindowOptions(line,settings,source).super_spacer,undefined);
 assert.deepEqual(line,original);
});
