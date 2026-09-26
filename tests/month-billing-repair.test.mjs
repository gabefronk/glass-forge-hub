import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { extractLaborAmount, extractExplicitService, parseServiceBilling, computeLaborAmt, computeFeeAmt, duplicatePostIds, pricingReview, extractPhotoUrls, denverDate, denverMidnight } from "../base44/shared/billingCore.js";

test("real calendar note formats preserve explicit amounts and reject ambiguity", () => {
  // "Labor$-3168-win" is the supported ticket notation (dash as separator, like "Labor-$18,000-win").
  for (const [text, amount] of [["SUB LABOR 4,883.00", 4883], ["Subpay $75 – invoice to framers",75],["Subpay: $150",150],["Labor $2,333-win",2333],["Labor-$18,000-win",18000],["Labor to pull basement storage window - $110",110],["LABOR: $3117/WIN2",3117],["Labor$-3168-win",3168]]) assert.equal(extractLaborAmount(text),amount);
  for (const text of ["Labor$-3168", "Labor 3 hours", "Labor\nSale Price $30,906.03"]) assert.equal(extractLaborAmount(text),null);
  assert.ok(pricingReview("Labor$-3168")?.reason);
  assert.equal(pricingReview("Labor$-3168-win"),null);
  assert.equal(pricingReview("Profit: $4,605.81\nSplit: $2,302.91")?.amount,2302.91);
});
test("explicit material hours use configured rates and null hours stay absent", () => {
  for (const [note, hours, material, rate] of [["1vinyl man hour",1,"vinyl",100],["2 man hours composite",2,"composite",125],["1 vinyl hour",1,"vinyl",100],["Glass changed 5 composite man hours",5,"composite",125],["1 wood man hour",1,"wood",150]]) {
    const ext = extractExplicitService(note);
    assert.equal(ext.man_hours,hours,note);
    const service=parseServiceBilling(note,ext.man_hours,ext.trip_charges);
    assert.equal(service.material,material,note);assert.equal(service.rate,rate,note);
    assert.equal(computeLaborAmt({man_hours:hours,service_material:material}),hours*rate);
  }
  assert.equal(extractExplicitService("about 1 in half hours to unload").man_hours,null);
  assert.equal(parseServiceBilling("photos uploaded",null,null).total,0);
  assert.equal(parseServiceBilling("trip charge",null,1).total,75);
  assert.equal(parseServiceBilling("4 man hours",4,null).review,true);
  assert.equal(extractExplicitService("no charge 2 man hours").needs_review,true);
});
test("calendar amounts, manual overrides, zero percent and penny rounding", () => {
  assert.equal(computeLaborAmt({calendar_labor_amt:150,man_hours:2,note_text:"Subpay: $150"}),150);
  assert.equal(computeLaborAmt({calendar_labor_amt:75,man_hours:2,service_material:"composite",note_text:"Labor $75 trip charge"}),325);
  assert.equal(computeFeeAmt({manually_adjusted:true,labor_amt:120,fee_amt:19,fee_pct:.1}),19);
  assert.equal(computeFeeAmt({man_hours:2,fee_pct:0}),0);
  assert.equal(computeFeeAmt({fee_type:"profit_split",sale_price:15269.60,cost:10663.79,split_pct:.5}),2302.91);
});
test("one charge per post, preserving independent work and manual entries", () => {
  const rows=[{id:"calendar",probuild_post_id:"p",calendar_event_id:"e",man_hours:4},{id:"standalone",probuild_post_id:"p",man_hours:4},{id:"independent",probuild_post_id:"p",calendar_labor_amt:1200},{id:"other",probuild_post_id:"q",man_hours:4}];
  assert.deepEqual([...duplicatePostIds(rows)],["standalone"]);
});
test("nested attachment URLs and Denver month boundaries", () => {
  assert.deepEqual(extractPhotoUrls({attachments:{a:{downloadURL:"https://example.com/photo.jpg"}},photos:[{url:"https://example.com/second.jpg"}]}),["https://example.com/photo.jpg","https://example.com/second.jpg"]);
  assert.equal(denverDate("2026-10-01T03:00:00Z"),"2026-09-30");
  assert.equal(denverMidnight("2026-09-01"),"2026-09-01T06:00:00.000Z");
  assert.equal(denverMidnight("2026-01-01"),"2026-01-01T07:00:00.000Z");
});
function entity(initial=[]) {
  const rows=structuredClone(initial);
  return { rows, list:async(_sort,limit=1000,skip=0)=>structuredClone(rows.slice(skip,skip+limit)),
    bulkCreate:async data=>{const created=data.map((r,i)=>({...r,id:"new-"+(rows.length+i)}));rows.push(...created);return structuredClone(created).reverse();},
    bulkUpdate:async data=>{assert.equal(new Set(data.map(r=>r.id)).size,data.length,"one patch per entity");for(const p of data){const r=rows.find(r=>r.id===p.id);assert.ok(r,"update target exists");Object.assign(r,p);}return data;} };
}
async function moduleUrl(url) {
  if (!url.pathname.endsWith(".ts")) return url.href;
  let source = await readFile(url, "utf8");
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) {
    source = source.replace(match[0], "from " + JSON.stringify(await moduleUrl(new URL(match[1], url))));
  }
  source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return "data:text/javascript;base64," + Buffer.from(source).toString("base64");
}
async function handler(name, client, posts=[]) {
  globalThis.__billingTestClient=client;globalThis.__billingTestPosts=posts;
  const url=new URL("../base44/functions/"+name+"/entry.ts",import.meta.url);
  let source=await readFile(url,"utf8");
  source=source.replace(/import \{ createClientFromRequest \} from [^;]+;/,'const createClientFromRequest = () => globalThis.__billingTestClient;');
  source=source.replace(/import \{ toMs, getProbuildIdToken, fetchProbuildProjects, fetchProbuildPostsForProject, filterProjectsByWindow \} from [^;]+;/, 'const getProbuildIdToken=async()=>"test", fetchProbuildProjects=async()=>[{id:"project",name:"test job"}], filterProjectsByWindow=p=>({qualifying:p,stats:{}}), fetchProbuildPostsForProject=async()=>globalThis.__billingTestPosts;');
  for (const match of [...source.matchAll(/from ['"](\.\.\/[^'"]+)['"]/g)]) {
    source = source.replace(match[0], "from " + JSON.stringify(await moduleUrl(new URL(match[1], url))));
  }

  return (await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64")+"#"+Math.random())).default;
}
function client(fees,events=[]) {
  const entities={FeeLines:entity(fees),CalendarEvents:entity(events),Jobs:entity([{id:"job",canonical_name:"test job",aliases:[]}]),MonthCloseSnapshot:entity(),FieldReports:entity(),AppSettings:entity(),ReportAudit:entity()};
  return {asServiceRole:{entities},entities};
}
test("calendar reverse merge reserves the post, records returned IDs and is idempotent",async()=>{
  const c=client([{id:"postrow",job_id:"job",job_date:"2026-09-02",invoice_month:"2026-09",source:"probuild",probuild_post_id:"post",man_hours:2,service_material:"composite",note_text:"2 composite man hours",billable:true}], [{id:"cal1",source:"google",google_event_id:"g1",event_date:"2026-09-02",job_name:"test job",scope_notes:"Visit"},{id:"cal2",source:"google",google_event_id:"g2",event_date:"2026-09-03",job_name:"test job",scope_notes:"Return visit"}]);
  const run=await handler("fetchCalendarEvents",c);
  const request=()=>new Request("https://test/",{method:"POST",body:JSON.stringify({start_date:"2026-09-01",end_date:"2026-09-30"})});
  let res=await run(request());assert.equal(res.status,200,await res.text());
  const rows=c.entities.FeeLines.rows,merged=rows.filter(r=>r.source==="both");
  assert.equal(merged.length,1);assert.equal(merged[0].labor_amt,250);
  assert.equal(rows.find(r=>r.id==="postrow").superseded_by,merged[0].id);
  res=await run(request());assert.equal(res.status,200,await res.text());
  assert.equal(rows.filter(r=>r.source==="both").length,1);
  assert.equal(rows.find(r=>r.source==="both").labor_amt,250);
});
test("ProBuild refresh preserves calendar identity and custom fee, and only adds photos",async()=>{
  const c=client([{id:"merged",job_id:"job",source:"both",calendar_event_id:"g1",calendar_note_text:"Appointment instructions",job_date:"2026-09-06",invoice_month:"2026-09",job_name_raw:"Calendar title",probuild_post_id:"post",fee_pct:.15,billable:true,man_hours:3}]);
  const run=await handler("fetchProbuildPosts",c,[{projectId:"project",postId:"post",post:{createdAt:"2026-09-07T19:00:00Z",message:"3 composite man hours",attachments:[{downloadURL:"https://example.com/photo.jpg"}]}}]);
  const res=await run(new Request("https://test/",{method:"POST",body:JSON.stringify({start_date:"2026-09-01",end_date:"2026-09-30"})}));
  assert.equal(res.status,200,await res.text());
  const r=c.entities.FeeLines.rows[0];
  // Append-only (2026-09-15): the existing line keeps its identity and amounts;
  // the only write is the additive photo fill, and no duplicate line is created.
  assert.equal(c.entities.FeeLines.rows.length,1);
  assert.equal(r.job_date,"2026-09-06");assert.equal(r.job_name_raw,"Calendar title");assert.equal(r.source,"both");
  assert.equal(r.calendar_event_id,"g1");assert.equal(r.calendar_note_text,"Appointment instructions");assert.equal(r.fee_pct,.15);assert.equal(r.man_hours,3);
  assert.equal(r.labor_amt,undefined);assert.equal(r.fee_amt,undefined);
  assert.equal(c.entities.FieldReports.rows.length,1);assert.match(c.entities.FieldReports.rows[0].message,/3 composite man hours/);assert.equal(r.photo_urls.length,1);
});

test("month-wide report audit sends one update per event and keeps the fresh status",async()=>{
  const c=client([],[{id:"old-event",event_date:"2020-01-02",job_name:"test job",report_required:true,report_status:"missing_all",match_method:"none",matched_post_ids:[]}]);
  const run=await handler("auditFieldReports",c);
  const res=await run(new Request("https://test/",{method:"POST",body:JSON.stringify({start_date:"2020-01-01",end_date:"2020-01-31",force:true})}));
  assert.equal(res.status,200,await res.text());
  assert.equal(c.entities.CalendarEvents.rows[0].report_status,"no_source_data");
  assert.equal(c.entities.CalendarEvents.rows[0].report_required,true);
});
