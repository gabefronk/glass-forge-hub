import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createQuoteHandler, sha256, validateLines, validateResult, validateSettings } from "../shared/windowQuotesCore.js";
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
async function fixture() {
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
  const handler = createQuoteHandler({
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
