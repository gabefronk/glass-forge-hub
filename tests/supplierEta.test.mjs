import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierEtaAction, createSupplierEtaHandler } from '../base44/shared/supplierEtaService.mjs';
import { effectiveSupplierEta, projectSupplierEtas, publicEtaOrder, supplierEtaCandidates, supplierEtaReview, supplierEtaFollowUp } from '../base44/shared/supplierEtaCore.mjs';
import { purchasingCalendarEvents, etaText } from '../src/lib/purchasingDates.js';
const sandy = {};
function store(seed = {}) {
  let sequence = 0;
  const data = {
    Jobs: [{ id: 'j1', canonical_name: 'Sandy', builder: 'Builder', po_numbers: ['YA-0005', 'BFS-99'], untouched: { notes: 'Keep this' }, updated_date: 'original' }],
    JobBudgets: [structuredClone(sandy)], PurchaseOrders: [], VendorOrders: [], JobCostInputs: [], MonthCloseSnapshot: [], JobSetupSheets: [],
    ProcurementControl: [{ id: 'control', key: 'global', lock_token: '', revision: 0, last_number: 0 }], ...structuredClone(seed),
  };
  const writes = [];
  const matches = (r, q) => Object.entries(q).every(([k, v]) => r[k] === v);
  const api = Object.fromEntries(Object.keys(data).map(name => [name, {
    list: async (_sort, limit = 1000, skip = 0) => structuredClone(data[name].slice(skip, skip + limit)),
    filter: async (q, _sort, limit = 1000) => structuredClone(data[name].filter(r => matches(r, q)).slice(0, limit)),
    get: async id => { const r = data[name].find(r => r.id === id); if (!r) throw new Error('not found'); return structuredClone(r); },
    create: async payload => {
      const r = { ...structuredClone(payload), id: `${name}-${++sequence}`, updated_date: `v${sequence}` };
      data[name].push(r); writes.push({ name, create: structuredClone(payload) }); return structuredClone(r);
    },
    updateMany: async (q, ops) => {
      let updated = 0;
      for (const row of data[name].filter(r => matches(r, q))) {
        Object.assign(row, structuredClone(ops.$set || {}));
        for (const [k, v] of Object.entries(ops.$inc || {})) row[k] = (row[k] || 0) + v;
        for (const [k, v] of Object.entries(ops.$addToSet || {})) if (!(row[k] || []).includes(v)) row[k] = [...(row[k] || []), v];
        row.updated_date = `v${++sequence}`; updated++;
      }
      writes.push({ name, query: structuredClone(q), ops: structuredClone(ops) }); return { success: true, updated, has_more: false };
    },
  }]));
  return { api, data, writes };
}

const owner={role:'admin',email:'gabriel.fronk.wd@gmail.com'};
const stamp='2026-10-04T18:00:00.000Z',deps={now:()=>stamp};
const po={id:'p1',job_id:'j1',vendor:'AMSCO',po_number:'YA-0101',vendor_quote_ref:'TEST-Q1',status:'confirmed',updated_date:'v0',amount_dealer:123,notes:'private'};
const seed=()=>store({PurchaseOrders:[po,{...po,id:'p2',po_number:'YA-0102'}],SupplierEtaLinks:[],VendorOrders:[{id:'s1',job_id:'j1',vendor:'AMSCO',purchase_order_id:'p1',po_name:'YA-0101',eta_date:'2026-10-06',updated_date:'s0',amount:123,ach_link:'private'}]});
async function setup(){const s=seed();const grant=await supplierEtaAction(s.api,{action:'create',order_ids:['p1'],review_confirmed:true,expires_days:7},owner,deps);return {...s,token:grant.token,link:grant.link};}
const read=s=>supplierEtaAction(s.api,{action:'read',token:s.token},null,deps);
async function save(s,extra={}){const order=(await read(s)).orders[0];return supplierEtaAction(s.api,{action:'save',token:s.token,order_id:'p1',response:'eta',eta_date:'2026-10-09',expected_version:order.version,request_id:crypto.randomUUID(),...extra},null,deps);}
test('owner gate and review precede grant creation',async()=>{const s=seed();await assert.rejects(supplierEtaAction(s.api,{action:'create'},null,deps),{status:401});await assert.rejects(supplierEtaAction(s.api,{action:'create',order_ids:['p1'],expires_days:7},owner,deps),{status:400});assert.equal(s.data.SupplierEtaLinks.length,0);});
test('public response contains only selected order and whitelisted fields',async()=>{const s=await setup();const result=await read(s);assert.deepEqual(result.orders.map(o=>o.id),['p1']);assert.deepEqual(Object.keys(result.orders[0]).sort(),['id','job_name','po_number','quote_number','supplier_order','eta_date','response','responded_at','previous_eta_date','version','supplier'].sort());assert.equal(JSON.stringify(result).includes('private'),false);assert.notEqual(s.data.SupplierEtaLinks[0].token_hash,s.token);});
test('ETA, correction and pending reflect on PO/job calendar without finance or vendor writes',async()=>{const s=await setup();const before=structuredClone(s.data.VendorOrders);await save(s);let data={purchase_orders:s.data.PurchaseOrders,vendor_orders:s.data.VendorOrders,jobs:s.data.Jobs};let eta=purchasingCalendarEvents(data).find(e=>e.id==='purchasing:po:p1:eta');assert.equal(eta.event_date,'2026-10-09');assert.equal(eta.job_id,'j1');assert.equal(etaText(s.data.VendorOrders[0],s.data.PurchaseOrders[0]),'Oct 9, 2026');await save(s,{response:'pending',eta_date:''});assert.equal(purchasingCalendarEvents(data).some(e=>e.id==='purchasing:po:p1:eta'),false);assert.equal(s.data.PurchaseOrders[0].supplier_eta.previous_eta_date,'2026-10-09');await save(s,{eta_date:'2026-10-12'});assert.equal(purchasingCalendarEvents(data).find(e=>e.id===eta.id).event_date,'2026-10-12');assert.equal(s.data.PurchaseOrders[0].supplier_eta.history.length,3);assert.equal(s.data.PurchaseOrders[0].amount_dealer,123);assert.equal(s.data.PurchaseOrders[0].status,'confirmed');assert.deepEqual(s.data.VendorOrders,before);});
test('unrelated order, extra finance fields, stale version and invalid date are rejected',async()=>{const s=await setup();await assert.rejects(save(s,{order_id:'p2'}),{status:403});await assert.rejects(save(s,{amount_dealer:0}),{status:400});await assert.rejects(save(s,{expected_version:'stale'}),{status:409});await assert.rejects(save(s,{eta_date:'2026-02-30'}),{status:400});assert.equal(s.data.PurchaseOrders[0].supplier_eta,undefined);});
test('repeated save is idempotent and cannot change its payload',async()=>{const s=await setup();const request_id=crypto.randomUUID();await save(s,{request_id});const again=await save(s,{request_id});assert.equal(again.duplicate,true);assert.equal(s.data.PurchaseOrders[0].supplier_eta.history.length,1);await assert.rejects(save(s,{request_id,eta_date:'2026-10-15'}),{status:409});});
test('revocation and expiry block read and write',async()=>{const s=await setup();await supplierEtaAction(s.api,{action:'revoke',link_id:s.link.id},owner,deps);await assert.rejects(read(s),{status:401});const q=await setup();q.data.SupplierEtaLinks[0].expires_at=stamp;await assert.rejects(read(q),{status:401});});
test('changed job or supplier cannot remain on existing link',async()=>{const s=await setup();s.data.PurchaseOrders[0].job_id='other';assert.equal((await read(s)).orders.length,0);await assert.rejects(save(s,{order_id:'p1'}));});
test('newer explicit owner correction wins until a newer supplier response',()=>{const row={...po,supplier_eta:{response:'eta',eta_date:'2026-10-09',responded_at:'2026-10-04T17:00:00Z'}};const supplier={eta_date:'2026-10-11',eta_reviewed_at:'2026-10-04T18:00:00Z'};assert.equal(effectiveSupplierEta(row,supplier).date,'2026-10-11');row.supplier_eta.responded_at='2026-10-04T19:00:00Z';assert.equal(effectiveSupplierEta(row,supplier).date,'2026-10-09');});
test('owner ETA edits invalidate a supplier form version',async()=>{const s=await setup();const old=(await read(s)).orders[0].version;s.data.VendorOrders[0].updated_date='new-owner-version';await assert.rejects(save(s,{expected_version:old}),{status:409});});
test('HTTP handler rejects unauthenticated owner operations and hides internals',async()=>{const s=seed();const handler=createSupplierEtaHandler(()=>({auth:{me:async()=>null},asServiceRole:{entities:s.api}}));const r=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({action:'manage'})}));assert.equal(r.status,401);const get=await handler(new Request('https://example.test'));assert.equal(get.headers.get('cache-control'),'no-store');assert.match(get.headers.get('content-security-policy'),/default-src 'none'/);assert.equal((await get.text()).includes('private'),true);});
test('follow-up selection distinguishes missing, pending, overdue and upcoming Denver dates', () => {
 const data={purchase_orders:[po],vendor_orders:[],jobs:[{id:'j1'}]};
 assert.equal(supplierEtaFollowUp(po,data,stamp),'ETA not confirmed');
 const row={...po,supplier_eta:{response:'pending'}};
 assert.equal(supplierEtaFollowUp(row,data,stamp),'Still pending');
 for(const [date,expected] of [['2026-10-03',true],['2026-10-04',false],['2026-10-06',false]]) {
  row.supplier_eta={response:'eta',eta_date:date};
  assert.equal(Boolean(supplierEtaFollowUp(row,data,stamp)),expected);
 }
 row.supplier_eta={response:'eta',eta_date:'2026-10-03'};
 assert.equal(supplierEtaFollowUp(row,data,'2026-10-04T03:00:00Z'),'');
});
test('completed, received, sample, test and merged records cannot enter supplier scope', () => {
 const base={purchase_orders:[po],vendor_orders:[],jobs:[{id:'j1',canonical_name:'Real job'}]};
 for(const patch of [{stage:'closed'},{stage:'installed'},{is_sample:true},{merged_into:'other'},{canonical_name:'TEST ONLY - ETA probe'}]) {
  assert.equal(supplierEtaCandidates({...base,jobs:[{...base.jobs[0],...patch}]}).length,0);
 }
 for(const patch of [{status:'cancelled'},{status:'received'},{is_sample:true},{po_number:'TEST-ETA-1'}]) {
  assert.equal(supplierEtaCandidates({...base,purchase_orders:[{...po,...patch}]}).length,0);
 }
 for(const patch of [{received_date:'2026-10-03'},{picked_up_at:stamp}]) {
  assert.equal(supplierEtaCandidates({...base,vendor_orders:[{id:'s',purchase_order_id:po.id,job_id:'j1',vendor:'AMSCO',...patch}]}).length,0);
 }
});
test('ambiguous supplier links stay in owner review and never use guessed job names', () => {
 const base={purchase_orders:[po],vendor_orders:[],jobs:[{id:'j1'}]};
 const supplier={id:'s',vendor:'AMSCO',order_number:po.vendor_quote_ref,eta_date:'2026-11-02'};
 assert.equal(supplierEtaCandidates({...base,vendor_orders:[supplier]}).length,0);
 assert.match(supplierEtaReview({...base,vendor_orders:[supplier]})[0].reason,/link needs review/);
 const linked={...supplier,purchase_order_id:po.id,job_id:'j1'};
 assert.equal(supplierEtaCandidates({...base,vendor_orders:[linked]}).length,1);
 assert.equal(supplierEtaCandidates({...base,vendor_orders:[linked,{...linked,id:'duplicate'}]}).length,0);
});
test('saving a future ETA leaves the granted order available for corrections', async () => {
 const s=await setup(); await save(s,{eta_date:'2026-11-02'});
 assert.equal((await read(s)).orders.length,1);
 const result=await supplierEtaAction(s.api,{action:'manage'},owner,deps);
 assert.equal(result.orders.find(o=>o.id==='p1').follow_up_reason,'');
 assert.equal(result.orders.find(o=>o.id==='p2').follow_up_reason,'ETA not confirmed');
});

test('all outstanding orders include future ETAs and paid supplier records',async()=>{
 const s=seed();s.data.VendorOrders[0].status='reconciled';
 const result=await supplierEtaAction(s.api,{action:'manage'},owner,deps);
 assert.deepEqual(result.orders.map(o=>o.id),['p1','p2']);
 assert.equal(result.orders[0].eta_date,'2026-10-06');
});
test('unnamed linked order can save and correct ETA without a guessed job',async()=>{
 const s=seed();s.data.PurchaseOrders[0].job_id=null;s.data.PurchaseOrders[0].vendor_quote_ref=null;
 s.data.VendorOrders[0].job_id=null;
 const grant=await supplierEtaAction(s.api,{action:'create',order_ids:['p1'],expires_days:7,review_confirmed:true},owner,deps);
 Object.assign(s,{token:grant.token,link:grant.link});
 assert.match((await read(s)).orders[0].job_name,/YA-0101.*job not linked/);
 await save(s,{eta_date:'2026-11-02'});await save(s,{eta_date:'2026-11-05'});
 assert.equal((await read(s)).orders[0].eta_date,'2026-11-05');
 s.data.VendorOrders[0].picked_up_at=stamp;
 assert.equal((await read(s)).orders.length,0);
 await assert.rejects(supplierEtaAction(s.api,{action:'save',token:s.token,order_id:'p1',response:'pending',eta_date:'',expected_version:'old',request_id:crypto.randomUUID()},null,deps),{status:403});
});
test('completion synonyms and flags remove orders while ETA alone never does',()=>{
 const data={purchase_orders:[po],vendor_orders:[],jobs:[{id:'j1'}]};
 for(const patch of [{status:'Picked Up'},{status:'CANCELED'},{delivered:true},{installed_at:stamp},{picked_up:true}]) {
  assert.equal(supplierEtaCandidates({...data,purchase_orders:[{...po,...patch}]}).length,0);
 }
 const supplier={id:'s',vendor:'AMSCO',purchase_order_id:'p1',job_id:'j1',eta_date:'2027-01-01'};
 assert.equal(supplierEtaCandidates({...data,vendor_orders:[supplier]}).length,1);
 assert.equal(supplierEtaCandidates({...data,vendor_orders:[{...supplier,picked_up_at:stamp}]}).length,0);
});
test('standalone supplier records are explicitly reported rather than silently lost',()=>{
 const data={purchase_orders:[],vendor_orders:[{id:'solo',vendor:'AMSCO',order_number:'09-9999',status:'ordered'}],jobs:[]};
 assert.equal(supplierEtaReview(data)[0].po.po_number,'09-9999');
 assert.match(supplierEtaReview(data)[0].reason,/Hub PO link/);
});

