import test from 'node:test';
import assert from 'node:assert/strict';
import { purchasingMatches } from '../src/lib/purchasingMatches.js';
import { purchasingWorkflow } from '../src/lib/purchasingWorkflow.js';
const b = { id: 'b', job_id: 'j', vendor: 'Pella', quote_number: 'Q1', inputs: { material_true_cost: 100, actual_total_sell: 200 } };
const p = { id: 'p', job_id: 'j', vendor: 'Pella', vendor_quote_ref: 'Q1', po_number: 'YA-0001' };
const s = { id: 's', job_id: 'j', vendor: 'Pella', po_name: 'YA-0001', eta_date: '2026-10-15' };
test('unique same-job references are recognized without modifying records', () => {
 const records = JSON.stringify([b,p,s]);
 const result = purchasingMatches('j',[b],[p],[s]);
 assert.equal(result.budgetPairs.length,1);
 assert.equal(result.supplierPairs.length,1);
 assert.equal(JSON.stringify([b,p,s]),records);
});
test('ambiguous quotes, suppliers and conflicting references are not matched', () => {
 assert.equal(purchasingMatches('j',[b,{...b,id:'b2'}],[p],[s]).budgetPairs.length,0);
 assert.equal(purchasingMatches('j',[b],[p],[s,{...s,id:'s2'}]).supplierPairs.length,0);
 const result=purchasingMatches('j',[b],[p],[s],[{number:p.po_number,job_ids:['j','other']}]);
 assert.equal(result.budgetPairs.length,0); assert.equal(result.supplierPairs.length,0);
});
test('foreign jobs, deleted quotes and cancelled POs cannot complete a connection', () => {
 assert.equal(purchasingMatches('j',[{...b,deleted_at:'y'}],[p],[s]).budgetPairs.length,0);
 assert.equal(purchasingMatches('j',[b],[{...p,status:'cancelled'}],[s]).supplierPairs.length,0);
 assert.equal(purchasingMatches('j',[b],[p],[{...s,job_id:'other',purchase_order_id:'p'}]).supplierPairs.length,0);
});
test('one supplier document cannot silently cover multiple orders', () => {
 const result=purchasingMatches('j',[b],[p,{...p,id:'p2',po_number:'YA-0002'}],[{...s,po_name:'YA-0001 YA-0002'}]);
 assert.equal(result.supplierPairs.length,0);
});
test('ready unmatched scope opens a preselected PO draft', () => {
 const result=purchasingWorkflow({job:{id:'j'},budgets:[b]});
 assert.deepEqual(result.next.editor,{mode:'po',budget_id:'b',job_id:'j'});
});
test('missing confirmation opens its existing PO, and late delivery opens its supplier', () => {
 const input={job:{id:'j'},budgets:[b],purchaseOrders:[p],today:'2026-10-20'};
 assert.equal(purchasingWorkflow(input).next.editor.po_id,'p');
 assert.equal(purchasingWorkflow({...input,supplierOrders:[s]}).next.editor.order_id,'s');
 assert.equal(purchasingWorkflow({...input,supplierOrders:[{...s,received_date:'2026-10-16'}]}).next.key,'invoicing');
});
test('reviewed new draft still needs its include or replace decision', () => {
 const draft={...b,id:'draft',quote_number:'Q2',budget_usage:'draft',numbers_reviewed_at:'2026-10-01'};
 const result=purchasingWorkflow({job:{id:'j'},budgets:[b,draft],purchaseOrders:[p]});
 assert.deepEqual(result.next.editor,{mode:'usage',budget_id:'draft'});
});
test('future delivery does not create an unnecessary review action', () => {
 const result=purchasingWorkflow({job:{id:'j'},budgets:[b],purchaseOrders:[p],supplierOrders:[s],today:'2026-10-01'});
 assert.equal(result.next.key,'invoicing'); assert.equal(result.matchedCount,2);
});
