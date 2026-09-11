import test from "node:test";
import assert from "node:assert/strict";
import {createOwnershipMatcher,filterOwnedCalendar} from "../base44/functions/ownedCalendar/engine.js";
import {createOwnedCalendarHandler} from "../base44/functions/ownedCalendar/handler.js";
const row={builder:"Holmes Homes",subdivision:"Deer Springs",lot:"214",oe:"79570526-01",po:"1234567"};
const event={id:"one",source:"google",job_name:"Holmes Homes - 214 Deer Springs",event_date:"2026-09-09",oe_number:row.oe,po_number:row.po,start_time:"08:00",end_time:"11:00",scope_notes:"Install five windows",address:"1 Main St"};
test("OE order families and exact PO are primary ownership keys",()=>{
 const match=createOwnershipMatcher([row]);
 assert.equal(match({...event,job_name:"Different calendar abbreviation"}).method,"oe");
 assert.equal(match({...event,oe_number:"",job_name:"Different calendar abbreviation"}).method,"po");
 assert.equal(match({...event,oe_number:"79570526-02"}).method,"oe");
 assert.equal(match({...event,oe_number:"79570526"}).method,"oe");
 assert.equal(match({...event,oe_number:"79570527-01"}),null);
 assert.equal(match({...event,po_number:"7654321"}),null);
 assert.equal(match({...event,oe_number:"missing",po_number:""}),null);
});
test("missing order permits exact full builder subdivision and whole lot",()=>{
 const match=createOwnershipMatcher([row]),noOrder={...event,oe_number:"",po_number:""};
 assert.equal(match(noOrder).method,"builder_subdivision_lot");
 for(const title of ["Holmes Homes - 2140 Deer Springs","Other Homes - 214 Deer Springs","Holmes Homes - 214 Other Springs","Deer Springs 214"])assert.equal(match({...noOrder,job_name:title}),null);
 assert.equal(match({...noOrder,builder:"Other Homes"}),null);
});
test("Edge and Utah events without tracker ownership stay excluded",()=>{
 const result=filterOwnedCalendar([{...event,id:"edge",job_name:"EDGE - 518 RIVER POINT",oe_number:"",po_number:""},{...event,id:"utah",job_name:"Utah 7000 2 Sage Hills",oe_number:"",po_number:"6543689"},event],[row]);
 assert.deepEqual(result.counts,{source_events:3,unmatched_events:2,duplicate_events:0,visible_events:1,removed_events:2});
 assert.equal(result.groups[0][0].id,"one");
});
test("same-source and cross-source duplicates merge, with alternatives retained",()=>{
 const result=filterOwnedCalendar([event,{...event,id:"two"},{...event,id:"out",source:"outlook"}],[row]);
 assert.equal(result.groups.length,1);assert.equal(result.groups[0].length,3);assert.equal(result.counts.duplicate_events,2);
 const outlookOnly=result.groups.map(group=>group.find(e=>e.source==="outlook")).filter(Boolean);assert.equal(outlookOnly.length,1);
});
test("all-day placeholder merges only with identical notes and common order",()=>{
 const allDay={...event,id:"all",source:"outlook",start_time:"",end_time:""};
 const result=filterOwnedCalendar([allDay,event],[row]);assert.equal(result.groups.length,1);assert.equal(result.groups[0][0].start_time,"08:00");
 assert.equal(filterOwnedCalendar([{...allDay,scope_notes:"Deliver screens"},event],[row]).groups.length,2);
});
test("distinct visits and scopes are preserved, and placeholders cannot bridge times",()=>{
 const afternoon={...event,id:"afternoon",start_time:"14:00",end_time:"15:00"};
 const allDay={...event,id:"all",start_time:"",end_time:""};
 assert.equal(filterOwnedCalendar([allDay,event,afternoon],[row]).groups.length,2);
 assert.equal(filterOwnedCalendar([event,{...event,id:"service",job_name:"Holmes Homes - 214 Deer Springs service",scope_notes:"Service window"}],[row]).groups.length,2);
 assert.equal(filterOwnedCalendar([event,{...event,id:"tomorrow",event_date:"2026-09-10"}],[row]).groups.length,2);
});
test("shared PO does not merge different known lots",()=>{
 const r2={...row,lot:"215"};
 const result=filterOwnedCalendar([event,{...event,id:"other",job_name:"Holmes Homes - 215 Deer Springs"}],[row,r2]);
 assert.equal(result.groups.length,2);
});
test("month counts do not accumulate prior months",()=>{
 const result=filterOwnedCalendar([event,{...event,id:"oct",event_date:"2026-10-01"}],[row]);
 assert.equal(result.by_month["2026-10"].source_events,1);
});
test("missing identifiers do not collapse distinct timed events",()=>{
 const a={...event};delete a.id;const b={...a,start_time:"15:00"};
 assert.equal(filterOwnedCalendar([a,b],[row]).groups.length,2);
});
const req=()=>new Request("https://example.com",{method:"POST",body:"{}"});
function harness(role="admin",fail=false){
 let snapshotReads=0;
 const client={auth:{me:async()=>role?{role}:null},entities:{CalendarEvents:{list:async()=>[event]},OutlookCalendarSnapshot:{filter:async()=>{snapshotReads++;return [{id:"s",events:[{...event,job_name:"EDGE - 518 RIVER POINT",oe_number:"",po_number:""}],complete:true}];}}}};
 const handler=createOwnedCalendarHandler({getClient:()=>client,readTracker:async()=>{if(fail)throw Error("checksum mismatch");return {rows:[row],snapshot:{source_captured_at:"2026-09-11"},appended:[]};}});
 return {handler,reads:()=>snapshotReads};
}
test("handler verifies tracker and excludes unmatched sources from display groups",async()=>{
 const {handler}=harness();const response=await handler(req()),data=await response.json();
 assert.equal(response.status,200);assert.equal(data.groups.length,1);assert.equal(data.ownership.counts.unmatched_events,1);
 assert.equal(JSON.stringify(data.groups).includes("EDGE"),false);assert.equal(JSON.stringify(data.groups).includes("sale_price"),false);
});
test("manager access preserves Outlook permission boundary",async()=>{
 const h=harness("manager");const data=await (await h.handler(req())).json();assert.equal(h.reads(),0);assert.equal(data.outlook,null);assert.equal(data.excluded_events,undefined);assert.equal(data.groups.length,1);
});
test("unauthorized and unverifiable tracker fail closed",async()=>{
 assert.equal((await harness(null).handler(req())).status,401);assert.equal((await harness("user").handler(req())).status,403);
 const response=await harness("admin",true).handler(req());assert.equal(response.status,503);assert.equal((await response.json()).groups,undefined);
});
