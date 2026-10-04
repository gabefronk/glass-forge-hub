import test from 'node:test';
import assert from 'node:assert/strict';
import { purchasingWorkflow } from '../src/lib/purchasingWorkflow.js';
import { buildSetupDraft, contractTermsReady } from '../src/lib/jobSetup.js';
import { aggregateJobMoney } from '../src/lib/jobMoneyPanel.js';
test('workflow prioritizes conflicts without claiming a paid or completed job', () => {
  const model = purchasingWorkflow({ job: { id: 'j' }, conflicts: [{ job_ids: ['j'], number: 'YA-1' }], month: '2026-09' });
  assert.equal(model.next.key, 'orders');
  assert.match(model.next.href, /month=2026-09/);
  assert.equal(model.steps.length, 5);
  assert.ok(model.steps.every(s => !/paid|complete|done/i.test(s.status)));
});
test('unknown setup and same-number unlinked supplier records never imply readiness', () => {
  const model = purchasingWorkflow({ job: { id: 'j' }, setupState: 'error',
    purchaseOrders: [{ id: 'po', job_id: 'j', po_number: 'YA-1' }],
    supplierOrders: [{ id: 's', job_id: 'j', po_name: 'YA-1' }] });
  assert.equal(model.steps[1].status, 'Status unavailable');
  assert.equal(model.steps[3].status, 'Check PO links');
  assert.match(model.steps[3].detail, /1 POs without an explicit confirmation/);
});
test('workflow does not count cancelled or other-job orders', () => {
  const model = purchasingWorkflow({ job: { id: 'j' }, purchaseOrders: [
    { id: 'cancel', job_id: 'j', status: 'cancelled' }, { id: 'other', job_id: 'other' },
  ] });
  assert.equal(model.steps[2].detail, '0 active POs');
});
test('existing installation work is not forced through a new customer contract', () => {
  const model = purchasingWorkflow({ job: { id: 'bfs-install', po_numbers: ['BFS-1'] }, month: '2026-09' });
  assert.equal(model.next.key, 'invoicing');
  assert.equal(model.steps[1].status, 'Available if needed');
});
test('a converted window sale continues its customer setup', () => {
  const model = purchasingWorkflow({ job: { id: 'direct', source_window_quote_id: 'q1' } });
  assert.equal(model.next.key, 'setup');
});
test('accepted installed package autofill retains installation selling price and extras', () => {
  const sheet = buildSetupDraft({ job: { id: 'j', accepted_quote_snapshot: {
    result: { totals: { customer_total: 1000, subtotal: 950, tax: 50 }, lines: [{ qty: 1, product: 'Window', customer_extended: 950 }] },
    install_summary: { enabled: true, complete: true, cost: 200, sell: 400, extra_sell: 100, customer_total: 1500 },
  } } });
  assert.equal(sheet.pricing.contract_total, 1500);
  assert.equal(sheet.pricing.tax, '');
  assert.equal(sheet.pricing.sell_price, '');
  assert.equal(sheet.costs.labor, 200);
  assert.deepEqual(sheet.scope_lines.map(line => line.customer_price), [950, 400, 100]);
  assert.match(sheet.sources.contract_total, /installation/);
  assert.equal(contractTermsReady(sheet), false);
});
test('incomplete accepted installation does not quietly fall back to a product-only contract', () => {
  const sheet = buildSetupDraft({ job: { accepted_quote_snapshot: {
    result: { totals: { total: 1000 } }, install_summary: { enabled: true, complete: false },
  } } });
  assert.equal(sheet.pricing.contract_total, '');
  assert.equal(sheet.pricing.tax, '');
});
test('job money retains independently billable work and suppresses its zero calendar twin', () => {
  const result = aggregateJobMoney('j', { feeLines: [
    { id: 'cal', job_id: 'j', labor_amt: 0, manually_adjusted: true, fee_pct: 0.1 },
    { id: 'work', job_id: 'j', labor_amt: 500, manually_adjusted: true, fee_pct: 0.1, superseded_by: 'cal', billed_to_bfs: true, paid_to_ya: true },
  ] });
  assert.deepEqual(result.feeLines.map(row => row.id), ['work']);
  assert.equal(result.totals.feeBilled, 50);
  assert.equal(result.totals.feePaid, 50);
});
