import test from "node:test";
import assert from "node:assert/strict";
import {validateImportedSnapshot,importedQuoteRecord,quoteNumber,imagePath} from "../base44/shared/amscoQuoteImportModel.js";
import {createImportService,publicImport} from "../base44/shared/amscoQuoteImportService.js";
import {quoteListRow} from "../src/components/window-quotes/quoteListModel.js";

const gid = n => "00000000-0000-0000-0000-"+String(n).padStart(12,"0");
function snapshot() { return {
  quote_number:"3517014",quote_id:gid(1),title:"House pack",line_count:3,
  details:{Client:"BFS",Created:"9/9/2026"},customer:{Name:"Customer"},notes:["Quote note"],attachments:[],
  checked:{quote_details:true,customer:true,notes:true,line_items:true,totals:true},
  lines:["window","door","service"].map((kind,i)=>({native_line_id:gid(i+2),native_line_number:String((i+1)*100),kind,qty:2,room:kind,style:kind,description:"Original "+kind+" specifications",notes:"Line note",options:{},ratings:{},unit_prices:{list:200,dealer:80,customer:100},line_totals:{list:400,dealer:160,customer:200}})),
  totals:{subtotal:600,customer_total:870,dealer_total:480,labor:200,tax:70},warnings:[]
};}
function database() {
  let n=1;
  const match=(row,q)=>Object.entries(q).every(([k,v])=>row[k]===v);
  const entity=rows=>({
    rows,
    async filter(q,sort,limit){ const found=rows.filter(r=>match(r,q));return structuredClone(sort?.startsWith("-")?found.reverse().slice(0,limit):found.slice(0,limit));},
    async create(v){const row={...structuredClone(v),id:"r"+n++,created_date:String(n)};rows.push(row);return structuredClone(row);},
    async updateMany(q,p){let updated=0;for(const row of rows)if(match(row,q)){Object.assign(row,structuredClone(p.$set));updated++;}return{updated};}
  });
  return {AmscoQuoteImports:entity([]),QuoteRequests:entity([]),QuoteWorkers:entity([{id:"6a9dac833d04a18f0fd555f0",name:"Base44 Window Quotes browser",busy_token:"",poll_generation:0}])};
}
const admin={role:"admin",email:"owner@example.test"};
test("saved mixed lines and quote-level labor/tax retain exact original values",()=>{
  const result=validateImportedSnapshot(snapshot(),"3517014");
  assert.equal(result.unit_count,6);assert.deepEqual(result.lines.map(l=>l.kind),["window","door","service"]);
  assert.equal(result.totals.customer_total,870);assert.equal(result.lines[2].description,"Original service specifications");
  assert.equal(result.lines[0].options.glass_thickness,undefined);
});
test("reject wrong number, missing lines, duplicate identities, unchecked pages",()=>{
  for(const mutate of [
    s=>s.quote_number="3517015",s=>s.line_count=4,s=>s.lines[1].native_line_id=s.lines[0].native_line_id,
    s=>s.lines[1].native_line_number=s.lines[0].native_line_number,s=>s.checked.notes=false
  ]){const s=snapshot();mutate(s);assert.throws(()=>validateImportedSnapshot(s,"3517014"));}
});
test("reject price strings, missing customer prices and unreconciled quote charges",()=>{
  for(const mutate of [
    s=>s.lines[0].unit_prices.customer="100",s=>delete s.lines[0].line_totals.customer,
    s=>s.lines[0].line_totals.customer=230,s=>s.totals.subtotal=620,s=>delete s.totals.labor,
    s=>s.totals.tax=NaN
  ]){const s=snapshot();mutate(s);assert.throws(()=>validateImportedSnapshot(s,"3517014"));}
});
test("drawing paths cannot point to arbitrary URLs or API endpoints",()=>{
  assert.equal(imagePath("/api/app/images/6/_dynamic/1/2026-09-11/200x200/3753312078.png"),"/api/app/images/6/_dynamic/1/2026-09-11/200x200/3753312078.png");
  for(const path of ["https://evil.test/x.png","/api/quotes","/api/app/images/../secret","//evil.test/x.png"])assert.throws(()=>imagePath(path));
  assert.throws(()=>quoteNumber("3517014;delete"));
});
test("import result is visibly sourced but never mislabeled as engine verified",()=>{
  const record=importedQuoteRecord(validateImportedSnapshot(snapshot(),"3517014"),admin.email,"2026-09-11","import1");
  assert.equal(record.result.verified,false);
  const row=quoteListRow(record,"Imported");assert.equal(row.number,"3517014");assert.equal(row.total,870);assert.equal(row.client,"Customer");
});
test("private capabilities never enter the public import envelope",()=>{
  const value=publicImport({id:"x",status:"searching",run:{execution_token:"secret"},owner_email:"private"});
  assert.equal(JSON.stringify(value).includes("secret"),false);assert.equal(value.run,undefined);
});
test("lookup dispatches once, guarded report previews all lines and commit is idempotent",async()=>{
  const db=database();let sends=0;
  const service=createImportService({transport:{getConversation:async()=>({}),sendMessage:async()=>{sends++;}}});
  const body={action:"lookup",request_id:"client1",quote_number:"3517014"};
  const first=await service.userAction({db,user:admin,body});
  await service.userAction({db,user:admin,body});assert.equal(sends,1);
  const row=db.AmscoQuoteImports.rows[0];
  const capability={import_id:row.id,execution_token:row.run.execution_token};
  await assert.rejects(()=>service.agentAction({db,body:{...capability,execution_token:"wrong",action:"read"}}));
  await service.agentAction({db,body:{...capability,action:"report",status:"preview",browser_released:true,snapshot:snapshot()}});
  assert.equal(db.QuoteWorkers.rows[0].busy_token,"");
  const saved=await service.userAction({db,user:admin,body:{action:"commit",import_id:first.import.id,snapshot:{fake:true}}});
  const again=await service.userAction({db,user:admin,body:{action:"commit",import_id:first.import.id}});
  assert.equal(saved.import.imported_quote_id,again.import.imported_quote_id);assert.equal(db.QuoteRequests.rows.length,1);
  assert.equal(db.QuoteRequests.rows[0].result.snapshot.line_count,3);
});
test("signed-out connection creates a clear terminal state, never an empty imported quote",async()=>{
  const db=database();const service=createImportService({transport:null});
  const result=await service.userAction({db,user:admin,body:{action:"lookup",request_id:"offline",quote_number:"3517014"}});
  assert.equal(result.import.status,"needs_sign_in");assert.equal(db.QuoteRequests.rows.length,0);
});
test("browser lock owned by pricing is not stolen",async()=>{
  const db=database();db.QuoteWorkers.rows[0].busy_token="pricing-operation";
  const service=createImportService({transport:{sendMessage:async()=>assert.fail("must not dispatch")}});
  const result=await service.userAction({db,user:admin,body:{action:"lookup",request_id:"busy",quote_number:"3517014"}});
  assert.equal(result.import.status,"queued");assert.equal(db.QuoteWorkers.rows[0].busy_token,"pricing-operation");
});
test("network uncertainty never redispatches or releases another active operation",async()=>{
  const db=database();let sends=0;
  const service=createImportService({transport:{getConversation:async()=>({}),sendMessage:async()=>{sends++;throw Object.assign(new Error("timeout"),{uncertain:true});}}});
  const first=await service.userAction({db,user:admin,body:{action:"lookup",request_id:"uncertain",quote_number:"3517014"}});
  await service.userAction({db,user:admin,body:{action:"status",import_id:first.import.id}});
  assert.equal(sends,1);assert.equal(first.import.status,"searching");assert.ok(db.QuoteWorkers.rows[0].busy_token);
});
test("ordinary users and other administrators cannot read or commit someone else's search",async()=>{
  const db=database();const service=createImportService({});
  await assert.rejects(()=>service.userAction({db,user:{role:"user"},body:{action:"lookup",request_id:"no",quote_number:"3517014"}}),/Administrator/);
  const first=await service.userAction({db,user:admin,body:{action:"lookup",request_id:"own",quote_number:"3517014"}});
  await assert.rejects(()=>service.userAction({db,user:{role:"admin",email:"other@example.test"},body:{action:"status",import_id:first.import.id}}),/another user/);
});
test("invalid report leaves existing quote data and browser ownership untouched",async()=>{
  const db=database();const service=createImportService({transport:{getConversation:async()=>({}),sendMessage:async()=>({})}});
  await service.userAction({db,user:admin,body:{action:"lookup",request_id:"invalid",quote_number:"3517014"}});
  const row=db.AmscoQuoteImports.rows[0],s=snapshot();s.line_count=13;
  await assert.rejects(()=>service.agentAction({db,body:{action:"report",import_id:row.id,execution_token:row.run.execution_token,status:"preview",browser_released:true,snapshot:s}}));
  assert.equal(db.AmscoQuoteImports.rows[0].status,"searching");assert.equal(db.QuoteRequests.rows.length,0);assert.ok(db.QuoteWorkers.rows[0].busy_token);
});

test("XML preview is private, preserves its source and commits without using the AMSCO browser",async()=>{
 const db=database();db.QuoteWorkers.rows[0].busy_token="active-pricing";
 let reads=0;
 const service=createImportService({readExport:async()=>{reads++;return "xml";},parseXml:()=>snapshot()});
 const body={action:"xml_preview",request_id:"xml1",filename:"quote.xml",file_uri:"private/test/quote.xml"};
 const first=await service.userAction({db,user:admin,body});
 await service.userAction({db,user:admin,body});assert.equal(reads,1);
 assert.equal(first.import.source_file,undefined);
 const saved=await service.userAction({db,user:admin,body:{action:"commit",import_id:first.import.id}});
 assert.ok(saved.import.imported_quote_id);assert.equal(db.QuoteWorkers.rows[0].busy_token,"active-pricing");
 assert.equal(db.QuoteWorkers.rows[0].import_commit_token,"");
});
test("concurrent previews of the same saved quote cannot create duplicate quote rows",async()=>{
 const db=database();const service=createImportService({readExport:async()=>"xml",parseXml:()=>snapshot()});
 const previews=await Promise.all(["a","b"].map(request_id=>service.userAction({db,user:admin,body:{action:"xml_preview",request_id}})));
 const results=await Promise.allSettled(previews.map(p=>service.userAction({db,user:admin,body:{action:"commit",import_id:p.import.id}})));
 assert.equal(db.QuoteRequests.rows.length,1);
 for(let i=0;i<results.length;i++)if(results[i].status==="rejected")await service.userAction({db,user:admin,body:{action:"commit",import_id:previews[i].import.id}});
 assert.equal(db.QuoteRequests.rows.length,1);
 assert.equal(db.AmscoQuoteImports.rows[0].imported_quote_id,db.AmscoQuoteImports.rows[1].imported_quote_id);
});
test("a saved insert with an uncertain response is recovered without repeating the create",async()=>{
 const db=database();const service=createImportService({readExport:async()=>"xml",parseXml:()=>snapshot()});
 const preview=await service.userAction({db,user:admin,body:{action:"xml_preview",request_id:"uncertain-save"}});
 const create=db.QuoteRequests.create;db.QuoteRequests.create=async v=>{await create(v);throw new Error("network timeout");};
 await assert.rejects(()=>service.userAction({db,user:admin,body:{action:"commit",import_id:preview.import.id}}));
 assert.ok(db.QuoteWorkers.rows[0].import_commit_token);
 const recovered=await service.userAction({db,user:admin,body:{action:"status",import_id:preview.import.id}});
 assert.equal(recovered.import.status,"imported");assert.equal(db.QuoteRequests.rows.length,1);
 assert.equal(db.QuoteWorkers.rows[0].import_commit_token,"");
});
test("expired queued searches finish without taking a browser lock",async()=>{
 const db=database();db.QuoteWorkers.rows[0].busy_token="other";
 let now=new Date("2026-09-11T10:00:00Z");
 const service=createImportService({now:()=>now,transport:{}});
 const first=await service.userAction({db,user:admin,body:{action:"lookup",request_id:"expired",quote_number:"3517014"}});
 now=new Date("2026-09-11T11:00:00Z");
 const result=await service.userAction({db,user:admin,body:{action:"status",import_id:first.import.id}});
 assert.equal(result.import.status,"failed");assert.equal(db.QuoteWorkers.rows[0].busy_token,"other");
});
