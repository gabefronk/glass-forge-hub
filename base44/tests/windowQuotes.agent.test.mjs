import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createQuoteHandler, HttpError, sha256, validateLines, validateResult, validateSettings, publicQuote, publicMessages, sanitizePublic } from "../shared/windowQuotesCore.js";
globalThis.crypto ??= webcrypto;
const clone = x => JSON.parse(JSON.stringify(x));
const path = (o, key) => key.split(".").reduce((v, k) => v?.[k], o);
function matches(row, query) {
  return Object.entries(query || {}).every(([key, value]) => {
    if (key === "$or") return value.some(q => matches(row, q));
    const actual = path(row, key);
    if (value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value).every(([op, expected]) => op === "$in" ? expected.includes(actual) : op === "$lte" ? actual <= expected : op === "$gt" ? actual > expected : false);
    return actual === value;
  });
}
async function fixture(executionService) {
  let sequence = 0, timestamp = Date.parse("2026-09-06T18:00:00Z");
  const records = { QuoteRequests: [], QuoteMessages: [], QuoteWorkers: [], Jobs: [] };
  const controls = { failAfterJobCreate: false, failBeforeJobCreate: false, failMessageProjection: false, failWorkerRelease: false };
  const entities = Object.fromEntries(Object.entries(records).map(([name, rows]) => [name, {
    async filter(query, sort, limit = 1000) {
      const output = rows.filter(r => matches(r, query));
      if (sort) output.sort((a,b) => String(path(a, sort.replace(/^-/, "")) ?? "").localeCompare(String(path(b, sort.replace(/^-/, "")) ?? "")) * (sort.startsWith("-") ? -1 : 1));
      return clone(output.slice(0, limit));
    },
    async list(sort, limit) { return this.filter({}, sort, limit); },
    async create(data) {
      if (name === "QuoteMessages" && controls.failMessageProjection) throw new Error("projection unavailable");
      if (name === "Jobs" && controls.failBeforeJobCreate) { controls.failBeforeJobCreate = false; throw new Error("create did not persist"); }
      const row = { ...(name === "QuoteWorkers" ? {poll_generation:0,busy_token:"",active_quote_id:""} : {}), ...clone(data), id: name + "-" + (++sequence), created_date: new Date(timestamp + sequence).toISOString(), updated_date: new Date(timestamp + sequence).toISOString() };
      rows.push(row);
      if (name === "Jobs" && controls.failAfterJobCreate) { controls.failAfterJobCreate = false; throw new Error("response lost after create"); }
      return clone(row);
    },
    async updateMany(query, update) {
      if (name === "QuoteWorkers" && controls.failWorkerRelease && update.$set?.busy_token === "") { controls.failWorkerRelease = false; throw new Error("worker release failed"); }
      let updated = 0;
      for (const row of rows) if (matches(row, query)) { Object.assign(row, clone(update.$set || {})); updated++; }
      return { success: true, updated };
    }
  }]));
  const handler = createQuoteHandler({ executionService,
    getClient: req => ({ asServiceRole:{entities}, auth:{me:async() => {
      const role = req.headers.get("test-role");
      if (!role) throw new Error("anonymous");
      return {id:"person",email:"admin@example.test",role};
    }}}),
    now: () => new Date(timestamp), uuid: () => "lease-" + (++sequence)
  });
  const call = async (body, auth = "admin") => {
    const headers = {"Content-Type":"application/json"};
    if (auth.startsWith("key:")) headers["X-Quote-Worker-Key"] = auth.slice(4);
    else if (auth) headers["test-role"] = auth;
    const response = await handler(new Request("https://example.test/windowQuotes", {method:"POST",headers,body:JSON.stringify(body)}));
    return {status:response.status, ...await response.json()};
  };
  const key = "test-only-worker-key-of-sufficient-length";
  await entities.QuoteWorkers.create({name:"Test worker",token_hash:await sha256(key),enabled:true,allowed_dealers:["BFS"]});
  const worker = "key:" + key;
  const create = async (changes = {}) => call({ action:"create",request_id:"request-" + (++sequence),title:"Test quote",message:"Build these windows from scratch",settings:{dealer:"BFS",yard:"BFS-UTAH DESIGN",gross_margin:29.71},lines:[{width:59.25,height:47.25,qty:1,style:"Studio FlushFin SingleVent",dimension_basis:"frame",units:"in"}],...changes});
  const claim = async quote => { await call({action:"queue",quote_id:quote.id}); return (await call({action:"worker_poll"},worker)).quote; };
  const result = {
    verified:true,native_quote_id:"12345678-1234-1234-1234-123456789abc",native_quote_number:"1234567",
    native_quote_url:"https://amsco.wtsparadigm.com/quotes/12345678-1234-1234-1234-123456789abc/details",
    lines:[{qty:1,customer_unit:142.27,customer_extended:142.27}],totals:{dealer_cost:100,customer_total:142.27,list_total:190,gross_margin:29.71,currency:"USD"}
  };
  const ready = async quote => {
    const claimed = await claim(quote);
    const response = await call({action:"worker_update",quote_id:quote.id,lease_token:claimed.lease_token,input_revision:claimed.input_revision,status:"ready",result},worker);
    assert.equal(response.status,200,JSON.stringify(response));
    return response.quote;
  };
  return {call,create,claim,ready,result,records,controls,entities,worker,advance:ms=>timestamp+=ms};
}
test("MCP prevents direct quote-table CRUD and exposes only guarded quote functions",()=>{
  const config=JSON.parse(readFileSync(new URL("../mcp/config.json",import.meta.url),"utf8"));
  assert.equal(config.auth,"oauth");
  for(const entity of ["QuoteWorkers","QuoteRequests","QuoteMessages"]) assert.deepEqual(config.tools.entity_overrides[entity].operations,[]);
  const tools=config.tools.functions.filter(t=>["windowQuotes","windowQuotesDraft"].includes(t.handler));
  assert.equal(tools.length,6);
  const expected={submit_window_takeoff:["windowQuotesDraft","create"],queue_window_quote:["windowQuotes","queue"],get_window_quote_status:["windowQuotes","detail"],list_window_quotes:["windowQuotes","list"],reply_window_quote:["windowQuotes","message"],update_window_takeoff:["windowQuotes","update"]};
  assert.equal(new Set(tools.map(t=>t.name)).size,6);
  for(const tool of tools) {
    assert.deepEqual([tool.handler,tool.input_schema.properties.action.enum[0]],expected[tool.name]);
    assert.ok(tool.input_schema.required.includes("action"));
    assert.equal(tool.input_schema.properties.action.enum.length,1);
    assert.ok(!tool.input_schema.properties.action.enum[0].startsWith("worker_"));
  }
});
test("authentication separates administrators from scoped workers", async () => {
  const f=await fixture();
  assert.equal((await f.call({action:"list"},"")).status,401);
  assert.equal((await f.call({action:"list"},"member")).status,403);
  assert.equal((await f.call({action:"list"},f.worker)).status,401);
  assert.equal((await f.call({action:"worker_poll"})).status,401);
  assert.equal((await f.call({action:"worker_poll"},"key:incorrect-key-but-long-enough-for-validation")).status,401);
});
test("drafts allow missing finance and lines but queue requires explicit settings", async () => {
  const f=await fixture();
  const created=await f.create({settings:{dealer:"",yard:"",gross_margin:null},lines:[]});
  assert.equal(created.status,200);
  assert.deepEqual(created.quote.settings,{yard:""});
  assert.equal((await f.call({action:"queue",quote_id:created.quote.id})).status,400);
  const edited=await f.call({action:"update",quote_id:created.quote.id,settings:{dealer:"BFS",yard:"Design",gross_margin:0},source:{filename:"takeoff.csv"}});
  assert.equal(edited.status,200);
  assert.equal((await f.call({action:"queue",quote_id:created.quote.id})).status,200);
  assert.equal((await f.call({action:"worker_poll"},f.worker)).quote.lines.length,0);
});
test("dimension validation rejects bad provided values without inventing missing fields", () => {
  assert.throws(()=>validateLines([{qty:1.1}]));
  assert.throws(()=>validateLines([{width:-1}]));
  assert.throws(()=>validateLines([{units:"ft"}]));
  assert.throws(()=>validateSettings({gross_margin:100}));
  assert.deepEqual(validateLines([{style:"Single Hung"}]),[{style:"Single Hung"}]);
});
test("retry request and message IDs preserve a single canonical request/conversation", async () => {
  const f=await fixture();
  const first=await f.create({request_id:"stable"});
  const retry=await f.create({request_id:"stable"});
  assert.equal(first.quote.id,retry.quote.id);
  assert.equal(f.records.QuoteRequests.length,1);
  f.controls.failMessageProjection=true;
  const payload={action:"message",quote_id:first.quote.id,message:"Use Taupe",client_message_id:"client-123"};
  const one=await f.call(payload),two=await f.call(payload);
  assert.equal(one.quote.input_revision,two.quote.input_revision);
  const detail=await f.call({action:"detail",quote_id:first.quote.id});
  assert.equal(detail.messages.length,2);
  assert.equal((await f.call({...payload,message:"Different"})).status,409);
  assert.equal(detail.quote.lease_token,undefined);
});
test("one worker cannot concurrently claim two different quotes", async () => {
  const f=await fixture();
  for(let i=0;i<2;i++){const q=(await f.create()).quote;await f.call({action:"queue",quote_id:q.id});}
  const polls=await Promise.all([f.call({action:"worker_poll"},f.worker),f.call({action:"worker_poll"},f.worker)]);
  assert.equal(polls.filter(x=>x.quote).length,1);
  assert.equal(f.records.QuoteRequests.filter(q=>q.worker_status==="running").length,1);
});
test("two workers race for a single quote using a conditional claim", async () => {
  const f=await fixture();
  const secondKey="second-test-worker-key-sufficient-length";
  await f.entities.QuoteWorkers.create({name:"Second",token_hash:await sha256(secondKey),enabled:true,allowed_dealers:["BFS"]});
  const q=(await f.create()).quote;
  await f.call({action:"queue",quote_id:q.id});
  const polls=await Promise.all([f.call({action:"worker_poll"},f.worker),f.call({action:"worker_poll"},"key:"+secondKey)]);
  assert.equal(polls.filter(x=>x.quote).length,1);
});
test("paired dealer scope, immutable finance, and revision leases are enforced",async()=>{
  const f=await fixture();
  const btb=(await f.create({settings:{dealer:"BTB",yard:"BTB",gross_margin:30}})).quote;
  await f.call({action:"queue",quote_id:btb.id});
  assert.equal((await f.call({action:"worker_poll"},f.worker)).quote,null);
  const q=(await f.create()).quote, claim=await f.claim(q);
  const update={action:"worker_update",quote_id:q.id,lease_token:claim.lease_token,status:"running"};
  assert.equal((await f.call({...update,settings:{gross_margin:40}},f.worker)).status,400);
  assert.equal((await f.call({...update,input_revision:999},f.worker)).status,409);
  assert.equal((await f.call({action:"message",quote_id:q.id,message:"Change",client_message_id:"x"})).status,409);
  const parsed=await f.call({...update,settings:{color:"Taupe"},lines:[{style:"Single Hung"}]},f.worker);
  assert.equal(parsed.status,200);
  assert.equal(parsed.quote.settings.gross_margin,29.71);
});
test("expired lease recovers the persisted checkpoint and rejects the old writer",async()=>{
  const f=await fixture(),q=(await f.create()).quote,first=await f.claim(q);
  await f.call({action:"worker_update",quote_id:q.id,lease_token:first.lease_token,status:"running",checkpoint:{native_quote_id:"already-created"}},f.worker);
  f.advance(601000);
  const second=(await f.call({action:"worker_poll"},f.worker)).quote;
  assert.equal(second.checkpoint.native_quote_id,"already-created");
  assert.notEqual(second.lease_token,first.lease_token);
  assert.equal((await f.call({action:"worker_update",quote_id:q.id,lease_token:first.lease_token,status:"failed"},f.worker)).status,409);
  assert.equal((await f.call({action:"worker_heartbeat",quote_id:q.id,lease_token:second.lease_token},f.worker)).status,200);
});
test("ready requires actual matching AMSCO link, verification and customer total",async()=>{
  const f=await fixture();
  assert.throws(()=>validateResult({...f.result,verified:false}));
  assert.throws(()=>validateResult({...f.result,native_quote_url:"https://example.test/quotes/"+f.result.native_quote_id}));
  assert.throws(()=>validateResult({...f.result,native_quote_url:"https://amsco.wtsparadigm.com/quotes/different"}));
  assert.throws(()=>validateResult({...f.result,totals:{dealer_cost:100}}));
  const q=(await f.create()).quote;
  const ready=await f.ready(q);
  assert.equal(ready.result.totals.total,142.27);
  assert.equal(ready.lease_token,undefined);
});
test("clarifications release lease and a user reply creates a new queued revision",async()=>{
  const f=await fixture(),q=(await f.create({lines:[]})).quote,c=await f.claim(q);
  const payload={action:"worker_update",quote_id:q.id,lease_token:c.lease_token,status:"needs_details",message:"Are these frame or call sizes?",missing_details:["dimension basis"]};
  const first=await f.call(payload,f.worker),retry=await f.call(payload,f.worker);
  assert.equal(first.status,200);assert.equal(retry.status,200);
  assert.equal(f.records.QuoteWorkers[0].busy_token,"");
  assert.equal((await f.call({action:"detail",quote_id:q.id})).messages.length,2);
  const reply=await f.call({action:"message",quote_id:q.id,client_message_id:"basis-answer",message:"Frame sizes"});
  assert.equal(reply.quote.worker_status,"draft");
  assert.equal(reply.quote.input_revision,2);
  assert.equal((await f.claim(reply.quote)).lease_revision,2);
});
test("concurrent won conversion produces one job and an immutable accepted snapshot",async()=>{
  const f=await fixture(),q=await f.ready((await f.create()).quote);
  const responses=await Promise.all([f.call({action:"convert_won",quote_id:q.id,customer_name:"Example"}),f.call({action:"convert_won",quote_id:q.id,customer_name:"Example"})]);
  assert.equal(f.records.Jobs.length,1);
  assert.ok(responses.some(x=>x.status===200));
  const again=await f.call({action:"convert_won",quote_id:q.id});
  assert.equal(again.status,200);
  assert.equal(again.quote.job_id,f.records.Jobs[0].id);
  const snapshot=clone(again.quote.accepted_snapshot);
  await f.call({action:"update",quote_id:q.id,title:"New revision"});
  const reread=await f.call({action:"detail",quote_id:q.id});
  assert.deepEqual(reread.quote.accepted_snapshot,snapshot);
});
test("failed conversion stays open and can be retried after its uncertainty lease",async()=>{
  const f=await fixture(),q=await f.ready((await f.create()).quote);
  assert.equal((await f.call({action:"convert_won",quote_id:q.id,customer_name:42})).status,400);
  assert.equal(f.records.QuoteRequests[0].accepted_revision,0);
  f.controls.failBeforeJobCreate=true;
  assert.equal((await f.call({action:"convert_won",quote_id:q.id})).status,503);
  assert.equal(f.records.QuoteRequests[0].sales_status,"open");
  assert.equal(f.records.Jobs.length,0);
  assert.equal((await f.call({action:"convert_won",quote_id:q.id})).status,409);
  f.advance(601000);
  assert.equal((await f.call({action:"convert_won",quote_id:q.id})).status,200);
  assert.equal(f.records.Jobs.length,1);
  assert.equal(f.records.QuoteRequests[0].sales_status,"won");
});
test("worker completion retry repairs a failed slot release and cannot read a later dealer revision",async()=>{
  const f=await fixture(),q=(await f.create()).quote,c=await f.claim(q);
  const payload={action:"worker_update",quote_id:q.id,lease_token:c.lease_token,status:"needs_details",message:"Confirm glass",event_id:"event-1"};
  f.controls.failWorkerRelease=true;
  assert.equal((await f.call(payload,f.worker)).status,503);
  assert.notEqual(f.records.QuoteWorkers[0].busy_token,"");
  assert.equal((await f.call(payload,f.worker)).status,200);
  assert.equal(f.records.QuoteWorkers[0].busy_token,"");
  await f.call({action:"update",quote_id:q.id,settings:{dealer:"BTB",yard:"BTB yard",gross_margin:25}});
  const replay=await f.call(payload,f.worker);
  assert.ok(replay.status===403||replay.status===409);
  assert.equal(replay.quote,undefined);
});
test("heartbeat renewal between worker read and slot claim prevents a second run",async()=>{
  const f=await fixture(),q=(await f.create()).quote,c=await f.claim(q);
  const next=(await f.create()).quote;
  await f.call({action:"queue",quote_id:next.id});
  f.advance(601000);
  const originalFilter=f.entities.QuoteWorkers.filter;
  f.entities.QuoteWorkers.filter=async function(query,...rest) {
    const snapshot=await originalFilter.call(this,query,...rest);
    if(query.token_hash) f.records.QuoteWorkers[0].busy_until="2026-09-06T18:30:00.000Z";
    return snapshot;
  };
  assert.equal((await f.call({action:"worker_poll"},f.worker)).quote,null);
  assert.equal(f.records.QuoteWorkers[0].busy_token,c.lease_token);
  assert.equal(f.records.QuoteRequests.filter(q=>q.worker_status==="running").length,1);
});
test("heartbeat renewal between candidate read and reclaim cannot be stolen",async()=>{
  const f=await fixture(),q=(await f.create()).quote,c=await f.claim(q);
  f.advance(601000);
  const originalFilter=f.entities.QuoteRequests.filter;
  f.entities.QuoteRequests.filter=async function(query,...rest) {
    const snapshot=await originalFilter.call(this,query,...rest);
    if(query.$or) f.records.QuoteRequests[0].lease_expires_at="2026-09-06T18:30:00.000Z";
    return snapshot;
  };
  const reclaim=await f.call({action:"worker_poll"},f.worker);
  assert.equal(reclaim.status,200);
  assert.equal(reclaim.quote,null);
  assert.equal(f.records.QuoteRequests[0].lease_token,c.lease_token);
});
test("simultaneous creates return a canonical request and only that record can queue",async()=>{
  const f=await fixture();
  const responses=await Promise.all([f.create({request_id:"same-simultaneous"}),f.create({request_id:"same-simultaneous"})]);
  assert.equal(responses[0].quote.id,responses[1].quote.id);
  const canonicalId=responses[0].quote.id;
  for(const record of f.records.QuoteRequests) {
    const response=await f.call({action:"queue",quote_id:record.id});
    assert.equal(response.status,record.id===canonicalId?200:409);
  }
  const claim=(await f.call({action:"worker_poll"},f.worker)).quote;
  assert.equal(claim.id,canonicalId);
  assert.equal((await f.call({action:"list"})).quotes.length,1);
});
test("an exact edited-input retry does not create another revision",async()=>{
  const f=await fixture(),q=(await f.create()).quote;
  const payload={action:"update",quote_id:q.id,settings:{yard:"Different yard",dealer:"BFS",gross_margin:29.71},title:""};
  const one=await f.call(payload),two=await f.call(payload);
  assert.equal(one.status,200);assert.equal(two.status,200);
  assert.equal(one.quote.input_revision,two.quote.input_revision);
  assert.equal(one.quote.title,q.title);
  assert.equal(one.quote.request_text,"Build these windows from scratch");
});
test("an uncertain job-create response reconciles by source quote without duplication",async()=>{
  const f=await fixture(),q=await f.ready((await f.create()).quote);
  f.controls.failAfterJobCreate=true;
  assert.equal((await f.call({action:"convert_won",quote_id:q.id})).status,503);
  assert.equal(f.records.Jobs.length,1);
  const retry=await f.call({action:"convert_won",quote_id:q.id});
  assert.equal(retry.status,200);
  assert.equal(f.records.Jobs.length,1);
  assert.equal(retry.quote.job_id,f.records.Jobs[0].id);
});

test("public quote projection removes recursive native links and private recovery while retaining prices",()=>{
  const quote={id:"q",input_revision:2,worker_status:"ready",history:[{result:{native_quote_url:"https://amsco.wtsparadigm.com/quotes/abc"}}],checkpoint:{native_quote_url:"https://amsco.wtsparadigm.com/quotes/abc"},lease_token:"private-lease",conversation:[{role:"user",content:"Quote my windows"}],result:{verified:true,native_quote_number:"123",native_quote_url:"https://amsco.wtsparadigm.com/quotes/abc",native_quote:{url:"https://amsco.wtsparadigm.com/quotes/abc"},lines:[{qty:1,width:36,customer_extended:123,options:{accountLink:"/quotes/abc",notes:"Taupe [View](https://amsco.wtsparadigm.com/quotes/abc)"}}],totals:{customer_total:123}},accepted_snapshot:{result:{verified:true,native_quote_url:"https://amsco.wtsparadigm.com/quotes/abc",totals:{total:123}},checkpoint:{secret:"private"}}};
  const original=clone(quote),safe=publicQuote(quote);
  assert.equal(safe.history,undefined);assert.equal(safe.checkpoint,undefined);assert.equal(safe.lease_token,undefined);
  assert.equal(safe.result.native_quote_url,undefined);assert.equal(safe.result.native_quote_number,"123");
  assert.equal(safe.result.lines[0].options.accountLink,undefined);
  assert.equal(safe.result.lines[0].options.notes,"Taupe");
  assert.equal(safe.result.totals.customer_total,123);assert.equal(safe.accepted_snapshot.result.totals.total,123);
  assert.ok(!JSON.stringify(safe).includes("wtsparadigm"));assert.deepEqual(quote,original);
});
test("plain, markdown, bare, encoded and nested native addresses are removed, internal app links remain",()=>{
  const values=["https://amsco.wtsparadigm.com/quotes/abc","//amsco.wtsparadigm.com/quotes/abc","amsco.wtsparadigm.com/quotes/abc","[View quote](https://amsco.wtsparadigm.com/quotes/abc)","<https://amsco.wtsparadigm.com/quotes/abc>",encodeURIComponent("https://amsco.wtsparadigm.com/quotes/abc"),"https://webcp-prod-auth.myparadigmcloud.com/webcp/token","https://webcp-prod-gs.azurewebsites.net/system"];
  const safe=sanitizePublic({values,internal:"/WindowQuotes?id=q",options:{glass:"CozE",url:"https://amsco.wtsparadigm.com/quotes/abc"},account_url:"/quotes/abc"});
  assert.ok(!JSON.stringify(safe).match(/wtsparadigm|myparadigmcloud|azurewebsites/i));
  assert.equal(safe.internal,"/WindowQuotes?id=q");assert.equal(safe.options.glass,"CozE");assert.equal(safe.options.url,undefined);assert.equal(safe.account_url,undefined);
});
test("typed chat keeps all user input and clarification, suppresses progress, synthesizes one exact ready message",()=>{
  const quote={id:"q",input_revision:3,worker_status:"ready",result:{verified:true},conversation:[
    {role:"user",content:"Initial request",revision:1,kind:"initial_request"},
    {role:"assistant",content:"Starting now",revision:1,kind:"progress"},
    {role:"assistant",content:"Frame or call dimensions?",revision:1,kind:"clarification"},
    {role:"user",content:"Call dimensions",revision:2,kind:"clarification_reply"},
    {role:"user",content:"And use Taupe",revision:3,kind:"user_message"},
    {role:"assistant",content:"Saving all lines",revision:3,kind:"progress"},
    {role:"assistant",content:"Ready https://amsco.wtsparadigm.com/quotes/abc",revision:3,kind:"ready"},
    {role:"system",content:"Debug trace",revision:3}
  ]};
  assert.deepEqual(publicMessages(quote).map(m=>m.content),["Initial request","Frame or call dimensions?","Call dimensions","And use Taupe","Your quote is ready to be viewed."]);
  assert.equal(publicMessages(quote).at(-1).kind,"ready");
});
test("legacy clarification uses status history, preserves replies and hides completed progress",()=>{
  const quote={id:"legacy",input_revision:2,worker_status:"ready",result:{verified:true},history:[{revision:1,worker_status:"needs_details"}],conversation:[
    {role:"user",content:"Initial",revision:1},
    {role:"assistant",content:"Starting configurator",revision:1},
    {role:"assistant",content:"Please specify glass",revision:1},
    {role:"user",content:"CozE",revision:2},
    {role:"assistant",content:"Applied glass and saved native quote",revision:2},
    {role:"assistant",content:"Here is your native link https://amsco.wtsparadigm.com/quotes/abc",revision:2}
  ]};
  assert.deepEqual(publicMessages(quote).map(m=>m.content),["Initial","Please specify glass","CozE","Your quote is ready to be viewed."]);
});
test("current missing details provide a question even when the worker did not store a message",()=>{
  const quote={id:"q",input_revision:1,worker_status:"needs_details",missing_details:["Please confirm frame or call dimensions"],conversation:[{role:"user",content:"Initial",revision:1},{role:"assistant",content:"Starting",revision:1,kind:"progress"}]};
  assert.deepEqual(publicMessages(quote).map(m=>m.content),["Initial","Please confirm frame or call dimensions"]);
  assert.equal(publicMessages({...quote,worker_status:"failed"}).length,1);
  assert.equal(publicMessages({...quote,worker_status:"needs_sign_in"}).length,1);
});
test("worker transport and stored audit keep private recovery; every app action response is sanitized",async()=>{
  const f=await fixture(),q=(await f.create({message:"Initial https://amsco.wtsparadigm.com/quotes/source"})).quote,c=await f.claim(q);
  assert.ok(c.messages[0].content.includes("wtsparadigm.com"));
  const progress=await f.call({action:"worker_update",quote_id:q.id,lease_token:c.lease_token,status:"running",message:"Saved native draft https://amsco.wtsparadigm.com/quotes/abc",checkpoint:{native_quote_url:"https://amsco.wtsparadigm.com/quotes/abc",completed_lines:[1]}},f.worker);
  assert.equal(progress.quote.checkpoint.completed_lines[0],1);
  assert.ok(progress.quote.checkpoint.native_quote_url.includes("wtsparadigm.com"));
  assert.equal(f.records.QuoteRequests[0].conversation.at(-1).kind,"progress");
  assert.ok(f.records.QuoteRequests[0].conversation.at(-1).content.includes("wtsparadigm.com"));
  const detail=await f.call({action:"detail",quote_id:q.id}),list=await f.call({action:"list"});
  assert.equal(detail.messages.length,1);assert.ok(!JSON.stringify(detail).includes("wtsparadigm.com"));assert.ok(!JSON.stringify(list).includes("wtsparadigm.com"));
  const ready=await f.call({action:"worker_update",quote_id:q.id,lease_token:c.lease_token,status:"ready",message:"Native quote saved",result:f.result},f.worker);
  assert.ok(ready.quote.result.native_quote_url.includes("wtsparadigm.com"));
  const converted=await f.call({action:"convert_won",quote_id:q.id});
  assert.equal(converted.status,200);assert.ok(!JSON.stringify(converted).includes("wtsparadigm.com"));
  assert.ok(f.records.Jobs[0].accepted_quote_snapshot.result.native_quote_url.includes("wtsparadigm.com"));
  const final=await f.call({action:"detail",quote_id:q.id});
  assert.deepEqual(final.messages.map(m=>m.content),["Initial","Your quote is ready to be viewed."]);
});

test("injected create/message autostart with no pricing defaults and preserve internal recovery",async()=>{
  const calls=[];
  const service={configured:true,async afterInput({db,q,user,action}) {
    calls.push({q:clone(q),user,action});
    await db.QuoteRequests.updateMany({id:q.id,state_version:q.state_version},{$set:{worker_status:"needs_details",missing_details:["Which dealer and yard?"],state_version:q.state_version+1,execution_provider:"superagent",agent_run:{id:"private-run"}}});
    return (await db.QuoteRequests.filter({id:q.id}))[0];
  }};
  const f=await fixture(service),created=await f.create({settings:{},lines:[]});
  assert.equal(created.status,200);assert.equal(created.quote.worker_status,"needs_details");
  assert.deepEqual(created.quote.settings,{});assert.equal(created.quote.agent_run,undefined);
  assert.equal(calls[0].action,"create");assert.equal(calls[0].user.role,"admin");
  assert.equal(calls[0].q.conversation[0].content,"Build these windows from scratch");
  assert.deepEqual(calls[0].q.history,[]);
  const stored=f.records.QuoteRequests[0];
  stored.checkpoint={native_quote_id:"private-draft",completed_lines:["100"]};
  const response=await f.call({action:"message",quote_id:stored.id,message:"BFS at the Design yard",client_message_id:"answer-1"});
  assert.equal(response.status,200);assert.equal(response.quote.worker_status,"needs_details");
  assert.equal(calls[1].action,"message");assert.equal(calls[1].q.input_revision,2);
  assert.equal(calls[1].q.history[0].worker_status,"needs_details");
  assert.equal(calls[1].q.checkpoint.native_quote_id,"private-draft");
  assert.equal(calls[1].q.conversation.at(-1).content,"BFS at the Design yard");
  assert.equal(response.quote.checkpoint,undefined);assert.equal(response.quote.history,undefined);
});

test("injected queue leaves transition and missing-setting clarification to the service",async()=>{
  const seen=[];
  const f=await fixture({configured:true,async afterInput({db,q,action}) {
    seen.push([action,q.worker_status,clone(q.settings)]);
    if(action==="queue") {
      assert.equal(q.worker_status,"draft");
      await db.QuoteRequests.updateMany({id:q.id},{$set:{worker_status:"queued",execution_provider:"superagent"}});
      return (await db.QuoteRequests.filter({id:q.id}))[0];
    }
    return q;
  }});
  const q=(await f.create({settings:{},lines:[]})).quote;
  const response=await f.call({action:"queue",quote_id:q.id});
  assert.equal(response.status,200);assert.equal(response.quote.worker_status,"queued");
  assert.deepEqual(seen,[["create","draft",{}],["queue","draft",{}]]);
});

test("injected input retries preserve canonical revisions while service dedupes dispatch",async()=>{
  const dispatches=new Set(),calls=[];
  const f=await fixture({configured:true,async afterInput({q,action}) {
    calls.push(action);dispatches.add(q.id+":"+q.input_revision);return q;
  }});
  const q=(await f.create({request_id:"agent-stable"})).quote;
  await f.create({request_id:"agent-stable"});
  const payload={action:"message",quote_id:q.id,message:"Use Taupe",client_message_id:"agent-message"};
  const first=await f.call(payload),retry=await f.call(payload);
  assert.equal(first.status,200);assert.equal(retry.status,200);
  assert.equal(first.quote.input_revision,2);assert.equal(retry.quote.input_revision,2);
  assert.equal(f.records.QuoteRequests.length,1);assert.equal(f.records.QuoteRequests[0].conversation.length,2);
  assert.equal(dispatches.size,2);assert.deepEqual(calls,["create","create","message","message"]);
  assert.equal((await f.call({...payload,message:"Conflicting retry"})).status,409);
  assert.equal(calls.length,4);
});

test("injected update never invokes the service or starts an autosave",async()=>{
  let calls=0;
  const f=await fixture({configured:true,async afterInput({q}) {calls++;return q;}});
  const q=(await f.create()).quote;
  const changed=await f.call({action:"update",quote_id:q.id,title:"Changed title",settings:{}});
  assert.equal(changed.status,200);assert.equal(changed.quote.worker_status,"draft");
  assert.equal(changed.quote.input_revision,2);assert.equal(calls,1);
  assert.equal((await f.call({action:"detail",quote_id:q.id})).status,200);assert.equal(calls,1);
});

test("injected list never treats configuration as browser online and does not query local workers",async()=>{
  const service={configured:true,async afterInput({q}) {return q;}};
  const f=await fixture(service);
  f.entities.QuoteWorkers.filter=async()=>{throw new Error("local workers must not be read");};
  let response=await f.call({action:"list"});
  assert.equal(response.status,200);
  assert.deepEqual(response.worker,{configured:true,online:false,provider:"superagent",name:"Window quoting",last_seen_at:null,browser_authenticated:null});
  service.configured=false;response=await f.call({action:"list"});
  assert.equal(response.status,200);assert.equal(response.worker.online,false);assert.equal(response.worker.configured,false);
});

test("retired worker actions return 410 before client or worker-key authentication",async()=>{
  let clientCalls=0;
  const handler=createQuoteHandler({executionService:{configured:false,async afterInput({q}) {return q;}},getClient:()=>{clientCalls++;throw new Error("must not authenticate");}});
  for(const action of ["worker_poll","worker_update","worker_heartbeat"]) {
    const response=await handler(new Request("https://example.test/windowQuotes",{method:"POST",body:JSON.stringify({action})}));
    assert.equal(response.status,410);assert.match((await response.json()).error,/retired/);
  }
  assert.equal(clientCalls,0);
});

test("agent recovery fields are recursively private and execution_provider remains public",()=>{
  const safe=sanitizePublic({execution_provider:"superagent",agent_run:{id:"run"},agent_conversation_id:"conversation",agent_operation_id:"operation",agent_dispatch_token:"dispatch",execution_token:"execution",nested:{agent_browser_session_id:"browser",agentTaskId:"task",AGENT_RECOVERY_SECRET:"secret",execution_provider:"superagent",price:123}});
  assert.deepEqual(safe,{execution_provider:"superagent",nested:{execution_provider:"superagent",price:123}});
});

test("injected queue refuses ready/shadow drafts and new inputs remain guarded while running",async()=>{
  let calls=0;
  const f=await fixture({configured:true,async afterInput({q}) {calls++;return q;}});
  const created=(await f.create()).quote,stored=f.records.QuoteRequests[0];
  stored.worker_status="ready";
  assert.equal((await f.call({action:"queue",quote_id:created.id})).status,409);
  stored.worker_status="running";
  assert.equal((await f.call({action:"message",quote_id:created.id,message:"Change",client_message_id:"new-running-input"})).status,409);
  assert.equal((await f.call({action:"update",quote_id:created.id,title:"Change"})).status,409);
  assert.equal(calls,1);
  const shadow=await f.entities.QuoteRequests.create({...stored,id:undefined,worker_status:"draft"});
  assert.equal((await f.call({action:"queue",quote_id:shadow.id})).status,409);
  assert.equal((await f.call({action:"message",quote_id:shadow.id,message:"Change",client_message_id:"shadow-input"})).status,409);
  assert.equal(calls,1);
});

test("service failure retains saved input for same-ID retry and exports intentional errors",async()=>{
  let failOnce=true;
  const f=await fixture({configured:true,async afterInput({q}) {
    if(failOnce){failOnce=false;throw new HttpError(409,"Dispatch already running");}return q;
  }});
  const first=await f.create({request_id:"uncertain-agent-create"});
  assert.equal(first.status,409);assert.equal(first.error,"Dispatch already running");
  assert.equal(f.records.QuoteRequests.length,1);
  const retry=await f.create({request_id:"uncertain-agent-create"});
  assert.equal(retry.status,200);assert.equal(f.records.QuoteRequests.length,1);
});

test("service cannot return another quote and service errors do not leak private details",async()=>{
  const f=await fixture({configured:true,async afterInput(){return {id:"other-quote",agent_dispatch_token:"secret"};}});
  const response=await f.create();assert.equal(response.status,503);assert.ok(!JSON.stringify(response).includes("secret"));
});

test("explicit create auto_start false saves a draft and later queue invokes the service",async()=>{
  const calls=[];
  const f=await fixture({configured:true,async afterInput({db,q,action}) {
    calls.push(action);
    await db.QuoteRequests.updateMany({id:q.id},{$set:{worker_status:"queued"}});
    return (await db.QuoteRequests.filter({id:q.id}))[0];
  }});
  const created=await f.create({request_id:"intentional-draft",auto_start:false,settings:{}});
  const retry=await f.create({request_id:"intentional-draft",auto_start:false,settings:{}});
  assert.equal(created.status,200);assert.equal(created.quote.worker_status,"draft");
  assert.equal(retry.quote.id,created.quote.id);assert.deepEqual(calls,[]);
  const queued=await f.call({action:"queue",quote_id:created.quote.id});
  assert.equal(queued.status,200);assert.equal(queued.quote.worker_status,"queued");
  assert.deepEqual(calls,["queue"]);
});

test("quick request notes and product preferences survive draft, edits and queue", async () => {
  const dispatched = [];
  const f = await fixture({ configured: true, async afterInput({ q }) { dispatched.push(clone(q)); return q; } });
  const settings = { color: "Taupe", glass: "CozE (LowE)" };
  const notes = "Four single-hung windows, 36 x 60 call size, kitchen has white inside and outside.";
  const created = await f.create({ auto_start: false, settings, message: notes, lines: [] });
  assert.equal(created.status, 200); assert.equal(created.quote.worker_status, "draft");
  assert.equal(created.quote.request_text, notes); assert.deepEqual(created.quote.settings, settings);
  assert.equal(dispatched.length, 0);
  const editedSettings = { color: "Black exterior / White interior", glass: settings.glass };
  const edited = await f.call({ action: "update", quote_id: created.quote.id, settings: editedSettings });
  assert.equal(edited.status, 200); assert.equal(edited.quote.input_revision, 2);
  assert.equal(dispatched.length, 0);
  const detail = await f.call({ action: "detail", quote_id: created.quote.id });
  assert.deepEqual(detail.quote.settings, editedSettings); assert.equal(detail.quote.request_text, notes);
  await f.call({ action: "queue", quote_id: created.quote.id });
  assert.equal(dispatched.length, 1); assert.deepEqual(dispatched[0].settings, editedSettings);
  assert.equal(dispatched[0].conversation[0].content, notes);
});



