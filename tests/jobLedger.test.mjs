import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { ledgerJob, ledgerTotals, jobLedger, receiptsLedger } = await import('../src/lib/jobLedger.js');
const { yaOperatingYear, entityViews, isTaxLine } = await import('../src/lib/companyProfit.js');

// A Purchasing card the way purchasingBoardCards builds one.
const card = (id, stage, { sale = null, windows = null, rough = null, typed = false, budgetId = null, scopes } = {}) => ({
  job: { id, canonical_name: id, builder: 'B' }, paymentStage: stage, chosenBudget: budgetId ? { id: budgetId } : null,
  sale: { display: { value: sale, label: typed ? 'Typed customer total' : 'From budget', source: typed ? 'owner' : 'budget_inputs' } },
  windows: { display: { value: windows, source: typed ? 'owner' : 'cost_material_tax', label: typed ? 'Typed budget cost' : 'Budget material' } },
  rough: { display: { value: typed ? 0 : rough } },
  ...(scopes ? { scopes } : {}),
});
const bank = (id, amount, category, jobId, date = '2026-10-01', description = 'Deposit') => ({ id, posted_date: date, amount, category, job_id: jobId, description });

test('the owner\'s Taira example: profit is sale less the all-in cost, split 50/50, no fee and no overhead', () => {
  const taira = card('T', 'ordered', { sale: 178020.51, windows: 132074.19, rough: 2172, budgetId: 'b' });
  const r = ledgerJob(taira, {
    budgets: [{ id: 'b', title: 'Taira', status: 'needs_review', budget_usage: 'draft', inputs: { labor_cost_sub_pay: 2172, additional_install_material: 0 } }],
    costInputs: [{ id: 'jci', job_id: 'T', actual_labor_cost: 2172, route: 'bfs_installed_sale', updated_date: '2026-10-14' }],
    bankLines: [bank('p', -132074.19, 'job_cost', 'T', '2026-10-22', 'Draft Withdrawal')],
  });
  assert.deepEqual([r.cost, r.profit, r.ya, r.gf], [134246.19, 43774.32, 21887.16, 21887.16]);
  assert.deepEqual([r.materials.tag, r.subLabor.basis, r.subLabor.value, r.other.value, r.costComplete], ['feed', 'actual', 2172, 0, true]);
  assert.ok(r.flags.some((f) => /needs review/.test(f)) && r.flags.some((f) => /Draft/.test(f)) && r.flags.some((f) => /BFS installed sale/.test(f)));
});

test('unknown crew stays unknown and is flagged; a typed cost already holds labor; an odd cent goes to YA', () => {
  const unknown = ledgerJob(card('U', 'ordered', { sale: 500, windows: 300, rough: 0, budgetId: 'b' }), { budgets: [{ id: 'b', inputs: { labor_cost_sub_pay: 0 } }] });
  assert.deepEqual([unknown.subLabor.value, unknown.subLabor.tag, unknown.costComplete, unknown.profit], [null, 'unknown', false, 200]);
  assert.ok(unknown.flags.includes('Crew cost unknown: profit is before crew'));
  const typed = ledgerJob(card('Y', 'ordered', { sale: 2411.81, windows: 1256.98, typed: true }), {});
  assert.deepEqual([typed.subLabor.basis, typed.cost, typed.profit, typed.costComplete], ['typed', 1256.98, 1154.83, true]);
  assert.deepEqual([typed.gf, typed.ya], [577.41, 577.42]);
  // Budget labor is an estimate and sits inside Purchasing's labor & material: never counted twice.
  const est = ledgerJob(card('E', 'half_down', { sale: 2863.79, windows: 933.96, rough: 700, budgetId: 'b' }), { budgets: [{ id: 'b', inputs: { labor_cost_sub_pay: 700 } }] });
  assert.deepEqual([est.subLabor.value, est.other.value, est.cost, est.profit], [700, 0, 1633.96, 1229.83]);
});

test('a job with no sale keeps its cost out of profit; totals report it on its own', () => {
  const rows = [
    ledgerJob(card('A', 'half_down', { sale: 1000, windows: 400, rough: 0 }), {}),
    ledgerJob(card('Scott', 'delivered', { windows: 477.46 }), {}),
  ];
  const t = ledgerTotals(rows);
  assert.deepEqual([t.sale, t.cost, t.profit, t.noSale.cost, t.noSale.jobs], [1000, 400, 600, 477.46, ['Scott']]);
  assert.equal(rows[1].profit, null);
  assert.ok(rows[1].flags[0].startsWith('No sale price yet'));
});

test('receipts: a matched bank deposit, a combined deposit and a payment after the bank data each count once', () => {
  const sales = [
    { ref: 'Inv 1', jobId: 'F', amount: 1474.71, open: 0, deposit: { inBank: true, linked: true, bankLineId: 'd1' } },
    { ref: 'Inv 2', jobId: 'F', amount: 870.93, open: 0, impliedSale: 70000, deposit: { inBank: true, linked: false, bankLineId: 'd2' } },
    { ref: 'Inv 3', jobId: 'F', amount: 29659.26, open: 0, deposit: { inBank: false } },
    { ref: 'Inv 4', jobId: 'F', amount: 931.89, open: 931.89, deposit: null },
  ];
  const lines = [bank('d1', 1474.71, 'customer_payment', 'F'), bank('d2', 1313.87, 'customer_payment', ''), bank('x', 5000, 'customer_payment', '')];
  const r = ledgerJob(card('F', 'half_down', { sale: 70000, windows: 1000, rough: 0 }), { sales, bankLines: lines });
  assert.deepEqual(r.receipts.map((x) => [x.amount, x.tag]), [[1474.71, 'feed'], [870.93, 'invoice'], [29659.26, 'invoice']]);
  assert.deepEqual([r.received, r.leftToCollect, r.invoicedOpen, r.sale.tag], [32004.9, 37995.1, 931.89, 'invoice']);
  const rl = receiptsLedger({ rows: [r], bankLines: lines, sales, unassigned: [{ ref: 'Inv 9', customer: 'C', note: 'n', bankLineId: 'x' }] });
  // The combined deposit is explained by Inv 2; the $5,000 is unmatched and shows its QuickBooks document.
  assert.deepEqual(rl.unmatched.map((u) => [u.id, u.note]), [['x', 'Inv 9 C: n']]);
  assert.equal(rl.mappedTotal, 32004.9);
});

test('a sale QuickBooks contradicts is flagged, never changed (Edgren: invoice $14,023.73 vs Hub $14,837.73)', () => {
  const sales = [{ ref: 'Invoice 1006', jobId: 'G', amount: 7011.87, open: 0, impliedSale: 14023.73, deposit: { inBank: true, linked: true, bankLineId: 'g' } }];
  const r = ledgerJob(card('G', 'half_down', { sale: 14837.73, windows: 9538.49, rough: 0 }), { sales, bankLines: [bank('g', 7011.87, 'customer_payment', 'G', '2026-10-15')], notes: {} });
  assert.deepEqual([r.sale.value, r.sale.tag, r.received, r.leftToCollect], [14837.73, 'estimate', 7011.87, 7825.86]);
  assert.ok(r.flags.includes('Sale conflict: QuickBooks implies $14,023.73, the Hub has $14,837.73 ($814.00)'));
});

test('the ledger splits sold jobs into active and completed and leaves quotes out', () => {
  const l = jobLedger({ cards: [card('A', 'half_down', { sale: 1000, windows: 400, rough: 0 }), card('Q', 'sent_to_customer', { sale: 9, windows: 1 }), card('P', 'paid', { sale: 600, windows: 300, typed: true })] });
  assert.deepEqual([l.active.map((r) => r.id), l.completed.map((r) => r.id)], [['A'], ['P']]);
  assert.deepEqual([l.totals.active.profit, l.totals.completed.profit], [600, 300]);
  assert.ok(l.completed[0].flags.some((f) => f.startsWith('Marked Paid, but no payment')));
});

test('YA operating year: genuine expenses only; taxes, payroll, weekly stream, Amex and unsorted wait; loans and draws excluded', () => {
  const L = (amount, category, description = 'x', match_note = '') => ({ posted_date: '2026-05-01', amount, category, description, match_note });
  const op = yaOperatingYear([
    L(10000, 'labor_payment'), L(5000, 'customer_payment'), L(-3000, 'job_cost'), L(-1000, 'crew_pay', 'Check 1'), L(-3000, 'crew_pay', 'Draft Withdrawal Draft'),
    L(-800, 'glass_forge'), L(-200, 'overhead', 'Pekin', 'Insurance'), L(-22538, 'payroll', 'Internal Revenue Service'), L(-6239, 'overhead', 'Tax Utah Gov', 'Taxes'),
    L(-3000, 'payroll', 'Company'), L(-900, 'card', 'Amex'), L(-50, 'other_cost'), L(-499.39, 'loan'), L(-100, 'owner_draw'),
    { posted_date: '2025-12-31', amount: 99999, category: 'labor_payment' },
  ], { from: '2026-01-01', to: '2026-10-23' });
  assert.deepEqual([op.income, op.direct, op.intercompany, op.opex, op.resultBeforePending], [15000, 4000, 800, 200, 10000]);
  assert.deepEqual([op.totals.taxes, op.totals.payroll, op.totals.weekly, op.totals.card, op.totals.unsorted, op.pending], [28777, 3000, 3000, 900, 50, 35727]);
  assert.deepEqual([op.totals.loans, op.totals.ownerDraws, op.excluded], [499.39, 100, 599.39]);
  assert.equal(op.taxLines.length, 2);
  assert.ok(isTaxLine({ description: 'Withdrawal Ach P', match_note: 'Taxes' }) && !isTaxLine({ description: 'Pekin Insurance', match_note: 'Insurance' }));
  // Combined YA + Glass Forge cancels the intercompany payment exactly once.
  const v = entityViews({ ledger: { ya: 300, gf: 300, profit: 600 }, operating: op });
  assert.deepEqual([v.jobs.combined, v.cash.ya, v.cash.gfFromYa, v.cash.combined], [600, 10000, 800, 10800]);
});
