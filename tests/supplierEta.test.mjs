import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierEtaAction, createSupplierEtaHandler } from '../base44/shared/supplierEtaService.mjs';
import { effectiveSupplierEta, projectSupplierEtas, publicEtaOrder } from '../base44/shared/supplierEtaCore.mjs';
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
const po={id:'p1',job_id:'j1',vendor:'AMSCO',po_number:'TEST-ETA-1',vendor_quote_ref:'TEST-Q1',status:'confirmed',updated_date:'v0',amount_dealer:123,notes:'private'};
const seed=()=>store({PurchaseOrders:[po,{...po,id:'p2',po_number:'TEST-ETA-2'}],SupplierEtaLinks:[],VendorOrders:[{id:'s1',job_id:'j1',vendor:'AMSCO',purchase_order_id:'p1',po_name:'TEST-ETA-1',eta_date:'2026-10-06',updated_date:'s0',amount:123,ach_link:'private'}]});
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
