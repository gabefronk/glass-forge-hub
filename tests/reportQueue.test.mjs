import test from "node:test";
import assert from "node:assert/strict";
import { reportQueueEvents } from "../src/lib/reportQueue.js";
test("report queue removes non-work reminders but retains free installer visits",()=>{
 const events=[
 {id:"r",job_name:"Renta",event_date:"2026-09-28"},
 {id:"t",job_name:"Thomas",event_date:"2026-09-28",scope_notes:"Pella del to BFS –9/17 QTY.2",labor_amt:0},
 {id:"s",job_name:"Sheetrock",event_date:"2026-09-28",scope_notes:"Sheetrock window install. No charge",labor_amt:0},
 {id:"c",job_name:"Callback",event_date:"2026-09-28",scope_notes:"Warranty service. No charge",labor_amt:0},
 {id:"a",job_name:"Alta",event_date:"2026-09-28",scope_notes:"Replace glass unit",labor_amt:0},
 {id:"future",job_name:"Install",event_date:"2026-10-10",labor_amt:350},
 {id:"cancel",job_name:"Install",event_date:"2026-09-28",source_status:"cancelled",labor_amt:350},
 ];
 assert.deepEqual(reportQueueEvents(events,"2026-10-04").map(e=>e.id),["s","c","a"]);
 assert.equal(events.length,7);
});
test("only matching source identities collapse, not separate visits with the same name",()=>{
 const base={job_name:"Same job",event_date:"2026-09-28",labor_amt:350,google_calendar_id:"cal"};
 const rows=[{...base,id:"one",google_event_id:"a"},{...base,id:"two",google_event_id:"a"},{...base,id:"three",google_event_id:"b"}];
 assert.deepEqual(reportQueueEvents(rows,"2026-10-04").map(e=>e.id),["one","three"]);
});
