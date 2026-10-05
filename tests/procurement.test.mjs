import test from 'node:test';
import assert from 'node:assert/strict';
import { amount, prepareBudgetPO, budgetForPO, budgetVersion, budgetFigures, budgetRollup, activeBudgets, referenceConflicts, nextPurchaseOrderNumber, supplierForPO, estimatePatch, validDate } from '../base44/shared/procurementCore.js';
import { issuePurchaseOrder } from '../base44/shared/purchaseOrderService.mjs';
import { procurementAction, estimatePreview, createProcurementHandler } from '../base44/shared/procurementService.mjs';
import { procurementPath } from '../src/lib/procurementRoutes.js';

const owner = { email: 'gabriel.fronk.wd@gmail.com', role: 'admin' };
const stamp = '2026-10-03T12:00:00.000Z';
const deps = { now: () => stamp, uuid: () => 'test-lock-token' };
const sandy = { id: 'b1', job_id: 'j1', title: 'Sandy quote', quote_number: '3526241', vendor: 'AMSCO WINDOWS', updated_date: 'original', inputs: { material_true_cost: 108.24, labor_cost_sub_pay: 125, labor_sell_price: 406.16, actual_total_sell: 600 } };
const existingPO = { id: 'p1', job_id: 'j1', po_number: 'YA-0005', vendor: 'Amsco', vendor_quote_ref: '3526241', amount_dealer: 116.3, status: 'issued' };
const form = (extra = {}) => ({ job_id: 'j1', vendor: 'AMSCO', vendor_quote_ref: 'new-quote', amount_dealer: '116.30', request_key: 'test-request-0001', review_confirmed: true, ...extra });
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

test('job-specific and overview routes preserve context without new jobs', () => {
  assert.equal(procurementPath('j1', 'orders'), '/jobs/j1/budget-orders?section=orders');
  assert.equal(procurementPath('', 'invoicing'), '/purchasing?section=invoicing');
  assert.equal(procurementPath('j1', 'bad'), '/jobs/j1/budget-orders?section=budgets');
});
test('blank is not zero; dates must exist', () => {
  assert.equal(amount(''), null); assert.equal(amount(null), null); assert.equal(amount('0'), 0);
  assert.equal(amount('$1,200.50'), 1200.5); assert.equal(amount('bad'), null);
  assert.equal(validDate('2026-02-30'), false); assert.equal(validDate('2026-10-03'), true);
});
test('legacy Sandy PO matches only one same-job, same-reference, same-supplier quote', () => {
  assert.equal(budgetForPO(existingPO, [sandy]).budget.id, sandy.id);
  assert.equal(budgetForPO({ ...existingPO, job_id: 'other' }, [sandy]).budget, null);
  assert.equal(budgetForPO(existingPO, [sandy, { ...sandy, id: 'b2' }]).budget, null);
  assert.equal(budgetForPO({ ...existingPO, budget_id: 'wrong' }, [sandy]).budget, null);
  assert.equal(budgetForPO({ ...existingPO, budget_id: 'b1', job_id: 'other' }, [sandy]).budget, null);
});
test('PO form never copies whole-job budget cost or total retail sell into supplier payable', () => {
  const prepared = prepareBudgetPO(sandy);
  assert.equal(prepared.form.amount_dealer, ''); assert.equal(prepared.form.amount_customer, ''); assert.equal(prepared.budget_sell, 600);
  const single = { ...sandy, quote: { price_levels: 'single', customer_total: 116.3, quoted_by: 'supplier' } };
  assert.equal(prepareBudgetPO(single).form.amount_dealer, '116.3');
  assert.equal(prepareBudgetPO({ ...single, quote: { ...single.quote, price_levels: 'dealer_and_customer' } }).form.amount_dealer, '');
  assert.equal(prepareBudgetPO({ ...single, quote: { ...single.quote, quoted_by: 'Gabriel Fronk' } }).form.amount_dealer, '');
  assert.throws(() => prepareBudgetPO({ id: 'b' }), /Link/);
});
test('cost review suppresses false 100 percent margin but retains genuine negative margin', () => {
  const missing = { inputs: { material_true_cost: 0, actual_total_sell: 458.78 }, openings_qty: 9, quote: { material_true_cost: null } };
  assert.equal(budgetFigures(missing).margin_pct, null);
  assert.equal(budgetFigures({ ...missing, numbers_reviewed_at: stamp }).margin_pct, 1);
  assert.equal(budgetFigures({ inputs: { material_true_cost: 400, actual_total_sell: 400 } }).margin_dollars, -29.8);
  assert.equal(budgetFigures(sandy).margin_dollars, 341.13);
});
test('reference copies and revisions remain stored but are not counted twice', () => {
  const draft = { ...sandy, id: 'b2', budget_usage: 'draft' };
  assert.deepEqual(activeBudgets([sandy, draft]).map(b => b.id), ['b1']);
  const newer = { ...draft, budget_usage: 'included', replaces_budget_id: 'b1', numbers_reviewed_at: stamp };
  assert.deepEqual(activeBudgets([sandy, newer]).map(b => b.id), ['b2']);
  assert.equal(budgetRollup([sandy, newer]).count, 1);
  assert.equal(budgetRollup([sandy, { ...sandy, id: 'dupe' }]).status, 'needs_review');
});
test('conflicting YA-0005 cannot cross-link supplier order to Sandy', () => {
  const other = { id: 'o1', job_id: 'j2', po_name: 'YA-0005 Hutchins', vendor: 'Amsco' };
  assert.equal(referenceConflicts([existingPO], [other]).length, 1);
  assert.equal(supplierForPO(existingPO, [other]), null);
  assert.equal(nextPurchaseOrderNumber([existingPO], [other], [], [{ quote: { customer_po: 'YA-0007' } }]), 'YA-0008');
});
test('authorization and explicit review happen before issuance', async () => {
  const s = store();
  await assert.rejects(issuePurchaseOrder(s.api, form(), { role: 'admin', email: 'other@example.com' }, deps), /owner-only/);
  await assert.rejects(issuePurchaseOrder(s.api, form({ review_confirmed: false }), owner, deps), /Review/);
  assert.equal(s.writes.length, 0);
});
test('issue and retry preserve job fields, reserve all legacy references, and create only one PO', async () => {
  const s = store({ JobBudgets: [{ ...sandy, quote: { customer_po: 'YA-0007' } }] });
  const before = structuredClone(s.data.Jobs[0]);
  const first = await issuePurchaseOrder(s.api, form(), owner, deps);
  assert.equal(first.po_number, 'YA-0008'); assert.equal(first.status, 'issued'); assert.equal(first.job_update.ok, true);
  const second = await issuePurchaseOrder(s.api, form(), owner, deps);
  assert.equal(second.id, first.id); assert.equal(second.duplicate, true); assert.equal(s.data.PurchaseOrders.length, 1);
  assert.deepEqual(s.data.Jobs[0].untouched, before.untouched); assert.equal(s.data.Jobs[0].canonical_name, before.canonical_name);
  assert.deepEqual(s.data.Jobs[0].po_numbers, ['YA-0005', 'BFS-99', 'YA-0008']);
  assert.equal(s.data.ProcurementControl[0].lock_token, '');
  await assert.rejects(issuePurchaseOrder(s.api, form({ amount_dealer: 200 }), owner, deps), /already issued/);
});
test('source budget snapshot is stable after later quote changes; stale source versions fail', async () => {
  const s = store();
  const body = form({ budget_id: 'b1', budget_version: budgetVersion(sandy), vendor_quote_ref: '3526241' });
  await assert.rejects(issuePurchaseOrder(s.api, { ...body, budget_version: 'stale' }, owner, deps), /budget changed/);
  const po = await issuePurchaseOrder(s.api, body, owner, deps);
  s.data.JobBudgets[0].inputs.actual_total_sell = 999;
  assert.equal(po.budget_snapshot.inputs.actual_total_sell, 600);
});
test('existing PO for a scope blocks duplicate issuance unless separately explained', async () => {
  const s = store({ PurchaseOrders: [existingPO] });
  await assert.rejects(issuePurchaseOrder(s.api, form({ vendor_quote_ref: '3526241' }), owner, deps), /already has YA-0005/);
  assert.equal(s.data.PurchaseOrders.length, 1);
});
test('concurrent issuance uses a shared compare-and-set lock', async () => {
  const s = store();
  const results = await Promise.allSettled([
    issuePurchaseOrder(s.api, form(), owner, deps),
    issuePurchaseOrder(s.api, form({ request_key: 'test-request-0002', vendor_quote_ref: 'other' }), owner, deps),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(s.data.PurchaseOrders.length, 1);
});
test('unknown create outcome holds the lock; a saved-but-lost response is recovered by request key', async () => {
  const s = store(); s.api.PurchaseOrders.create = async () => { throw new Error('network'); };
  await assert.rejects(issuePurchaseOrder(s.api, form(), owner, deps), /uncertain/);
  assert.notEqual(s.data.ProcurementControl[0].lock_token, '');
  const t = store(); const create = t.api.PurchaseOrders.create;
  t.api.PurchaseOrders.create = async payload => { await create(payload); throw new Error('response lost'); };
  const result = await issuePurchaseOrder(t.api, form(), owner, deps);
  assert.equal(result.po_number, 'YA-0006'); assert.equal(t.data.PurchaseOrders.length, 1); assert.equal(t.data.ProcurementControl[0].lock_token, '');
});
test('preview and sync estimates never overwrite actual costs, revenue or unrelated accounting fields', async () => {
  const record = { id: 'c1', job_id: 'j1', month: '2026-10', updated_date: 'original', product_sell: 600, actual_labor_cost: 160, installation_revenue: 275, route: 'direct_manufacturer_turnkey', notes: 'preserve', allocated_overhead: 42 };
  const s = store({ JobCostInputs: [record] });
  const body = { action: 'sync_estimate', job_id: 'j1', month: '2026-10', request_key: 'estimate-test-0001', review_confirmed: true };
  const preview = await estimatePreview(s.api, body);
  await procurementAction(s.api, { ...body, preview_version: preview.version }, owner, deps);
  const after = s.data.JobCostInputs[0];
  for (const k of ['product_sell', 'actual_labor_cost', 'installation_revenue', 'route', 'notes', 'allocated_overhead']) assert.equal(after[k], record[k]);
  assert.equal(after.budget_snapshot.margin_dollars, 341.13);
  assert.deepEqual(Object.keys(estimatePatch({}, 'owner', stamp)).sort(), ['budget_snapshot', 'budget_synced_at', 'budget_synced_by']);
  assert.equal(s.data.PurchaseOrders.length, 0);
});
test('closed month and stale preview refuse writes to accounting', async () => {
  const s = store({ MonthCloseSnapshot: [{ id: 'closed', month: '2026-10' }] });
  const body = { action: 'sync_estimate', job_id: 'j1', month: '2026-10', request_key: 'estimate-test-0001', review_confirmed: true };
  const p = await estimatePreview(s.api, body);
  await assert.rejects(procurementAction(s.api, { ...body, preview_version: p.version }, owner, deps), /closed/);
  assert.equal(s.data.JobCostInputs.length, 0);
  const t = store(); await assert.rejects(procurementAction(t.api, { ...body, preview_version: 'stale' }, owner, deps), /changed/);
  assert.equal(t.data.JobCostInputs.length, 0);
});
test('supplier save refuses a colliding PO reference without rewriting existing records', async () => {
  const s = store({ PurchaseOrders: [existingPO], VendorOrders: [{ id: 'o1', job_id: 'other', po_name: 'YA-0005', vendor: 'AMSCO' }] });
  await assert.rejects(procurementAction(s.api, { action: 'save_supplier_order', job_id: 'j1', purchase_order_id: 'p1', order_number: '09-1234', amount: 116.3, review_confirmed: true, request_key: 'supplier-test-01' }, owner, deps), /conflicting jobs/);
  assert.equal(s.data.VendorOrders.length, 1);
});
test('future status transitions automatically retain a dated history without changing source amounts', async () => {
  const s = store({ PurchaseOrders: [{ ...existingPO, updated_date: 'original' }] });
  const response = await procurementAction(s.api, { action: 'po_status', po_id: 'p1', status: 'confirmed', note: 'Supplier confirmed', expected_updated_date: 'original', request_key: 'status-date-test-01', review_confirmed: true }, owner, deps);
  assert.equal(response.purchase_order.status_history.at(-1).at, stamp);
  assert.equal(response.purchase_order.status_history.at(-1).status, 'confirmed');
  assert.equal(response.purchase_order.amount_dealer, existingPO.amount_dealer);
});
test('supplier confirmation history matches its initial status with or without ETA', async () => {
  for (const eta_date of ['', '2026-10-06']) {
    const s = store({ PurchaseOrders: [existingPO] });
    const response = await procurementAction(s.api, { action: 'save_supplier_order', job_id: 'j1', purchase_order_id: 'p1', order_number: '09-1234', amount: 116.3, eta_date, review_confirmed: true, request_key: 'supplier-date-test-01' }, owner, deps);
    assert.equal(response.order.status, eta_date ? 'eta_set' : 'ordered');
    assert.equal(response.order.status_history.at(-1).status, response.order.status);
    assert.equal(response.order.status_history.at(-1).at, stamp);
    const paid = await procurementAction(s.api, { action: 'vendor_status', order_id: response.order.id, status: 'paid', note: 'ACH receipt reviewed', expected_updated_date: response.order.updated_date, request_key: 'supplier-paid-test-01', review_confirmed: true }, owner, deps);
    assert.equal(paid.order.status_history.at(-1).at, stamp);
    assert.equal(paid.order.paid_at, stamp);
  }
});
test('API handler refuses crew before any private entity read', async () => {
  const handler = createProcurementHandler(() => ({ auth: { me: async () => ({ role: 'user', email: 'crew@example.com' }) }, get asServiceRole() { throw new Error('must not read'); } }));
  const res = await handler(new Request('https://unit.test', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 403);
});

test('shop PO issues and retries without creating or touching jobs and blocks duplicate scope', async () => {
 const s = store(); const before = structuredClone(s.data.Jobs);
 const body = form({job_id:'', purchase_type:'shop', vendor:'FHC',vendor_quote_ref:'GAFRAME pallets',amount_dealer:1254.48,notes:'Five pallets: three for shipment and two spares.'});
 const po = await issuePurchaseOrder(s.api, body, owner, deps);
 assert.equal(po.purchase_type,'shop');assert.equal(po.job_id,'');assert.equal(po.amount_dealer,1254.48);assert.equal(po.job_update.skipped,true);
 assert.deepEqual(s.data.Jobs,before);
 const retry = await issuePurchaseOrder(s.api,body,owner,deps);assert.equal(retry.id,po.id);assert.equal(s.data.PurchaseOrders.length,1);
 await assert.rejects(issuePurchaseOrder(s.api,{...body,request_key:'second-shop-request'},owner,deps),/already has/);
});
test('shop PO rejects hidden job links, customer amounts and missing purpose', async () => {
 for (const extra of [{job_id:'j1'},{budget_id:'b1'},{setup_sheet_id:'sheet'},{amount_customer:1500},{notes:''}]) {
  const s=store();await assert.rejects(issuePurchaseOrder(s.api,form({job_id:'',purchase_type:'shop',notes:'Packaging supplies for shop',...extra}),owner,deps));
  assert.equal(s.data.PurchaseOrders.length,0);
 }
 const s=store();await assert.rejects(issuePurchaseOrder(s.api,form({job_id:''}),owner,deps),/existing job/);
});
