import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { pipelineJob, pipelineView, earnTiming, importedLaborDiagnostic } = await import('../src/lib/companyPicture.js');
const { BOOKS_PL, QBO_SALES } = await import('../src/lib/booksSnapshot.js');

const card = (id, stage, { sale = null, windows = null, typed = false, budgetId = null } = {}) => ({
  job: { id, canonical_name: id }, paymentStage: stage, chosenBudget: budgetId ? { id: budgetId } : null,
  sale: { display: { value: sale, label: typed ? 'Typed customer total' : 'From budget' } },
  windows: { display: { value: windows, source: typed ? 'owner' : 'budget', label: typed ? 'Typed budget cost' : 'Quote' } },
  rough: { display: { value: typed ? 0 : null } },
});
const bank = (amount, category, jobId, date = '2026-10-01') => ({ posted_date: date, amount, category, job_id: jobId });

test('a half-down job: received in the bank, supplier paid, crew from the budget, overhead unknown', () => {
  const j = pipelineJob(card('A', 'half_down', { sale: 10000, windows: 6000, budgetId: 'b1' }), {
    budgets: [{ id: 'b1', inputs: { labor_cost_sub_pay: 1000, additional_install_material: 200 } }],
    bankLines: [bank(5000, 'customer_payment', 'A'), bank(-6000, 'job_cost', 'A'), bank(-999, 'crew_pay', null)],
    orders: [{ job_id: 'A', eta_date: '2026-11-09' }],
  });
  assert.deepEqual([j.materials, j.crew.value, j.crew.basis, j.received, j.toCollect, j.supplierPaid, j.supplierLeft, j.crewLeft], [6200, 1000, 'estimate', 5000, 5000, 6000, 200, 1000]);
  // Known margin before overhead: 10,000 - 6,200 - 1,000; never a total profit while overhead is unknown.
  assert.deepEqual([j.knownMargin, j.totalProfit, j.unknowns], [2800, null, ['overhead']]);
  // Net remaining: 5,000 to collect - 200 supplier left - 1,000 crew.
  assert.equal(j.netRemaining, 3800);
  assert.deepEqual([j.yaShare, j.gfShare], [1400, 1400]);
  assert.deepEqual(j.timing, { year: '2026', label: '2026 (ETA 2026-11-09)', eta: '2026-11-09' });
  assert.equal(j.billed, null);
});

test('unknown crew stays unknown (never $0); a typed cost hides crew inside it', () => {
  const unknown = pipelineJob(card('B', 'ordered', { sale: 500, windows: 300, budgetId: 'b2' }), { budgets: [{ id: 'b2', inputs: { labor_cost_sub_pay: 0 } }] });
  assert.deepEqual([unknown.crew.value, unknown.crew.basis, unknown.unknowns], [null, 'unknown', ['crew / labor', 'overhead']]);
  assert.equal(unknown.knownMargin, 200); // before crew and overhead, both named
  const typed = pipelineJob(card('C', 'ordered', { sale: 2411.81, windows: 1256.98, typed: true }), {});
  assert.deepEqual([typed.crew.basis, typed.crew.value, typed.materials, typed.knownMargin], ['typed', null, 1256.98, 1154.83]);
  const entered = pipelineJob(card('D', 'half_down', { sale: 100, windows: 60, budgetId: 'b3' }), {
    budgets: [{ id: 'b3', inputs: { labor_cost_sub_pay: 25 } }], costInputs: [{ job_id: 'D', actual_labor_cost: 0, updated_date: '2026-10-14' }],
  });
  assert.deepEqual([entered.crew.basis, entered.crew.value], ['actual', 0]);
  const noSale = pipelineJob(card('E', 'delivered', { windows: 477.46 }), {});
  assert.deepEqual([noSale.sale, noSale.knownMargin, noSale.yaShare, noSale.toCollect, noSale.unknowns], [null, null, null, null, ['sale', 'crew / labor', 'overhead']]);
});

test('QuickBooks sales: billed, invoiced unpaid, and cash counted once (in the bank, or after the bank data)', () => {
  const sales = [
    { jobId: 'F', amount: 870.93, open: 0, deposit: { inBank: true, linked: false } }, // inside an unlinked combined bank deposit
    { jobId: 'F', amount: 29659.26, open: 0, deposit: { inBank: false } }, // paid after the bank lines end
    { jobId: 'F', amount: 931.89, open: 931.89, deposit: null }, // open invoice
    { jobId: 'F', amount: 1474.71, open: 0, deposit: { inBank: true, linked: true } }, // the linked bank line below
  ];
  const j = pipelineJob(card('F', 'half_down', { sale: 70000, windows: 1000 }), { sales, bankLines: [bank(1474.71, 'customer_payment', 'F')] });
  assert.deepEqual([j.billed, j.invoicedUnpaid, j.receivedLinked, j.paidInBankUnlinked, j.received, j.paidAfterBank, j.collected], [32936.79, 931.89, 1474.71, 870.93, 2345.64, 29659.26, 32004.90]);
  assert.equal(j.toCollect, 70000 - 32004.90);
  assert.equal(j.toBill, 70000 - 32936.79);
});

test('earn timing: installed this year, ETA months, December at risk, none unknown', () => {
  assert.equal(earnTiming('installed', []).year, '2026');
  assert.equal(earnTiming('ordered', [{ eta_date: '2026-12-07' }]).year, '2026?');
  assert.equal(earnTiming('ordered', [{ eta_date: '2027-01-10' }]).year, '2027');
  assert.equal(earnTiming('ordered', [{ eta_date: '2026-10-05', received_date: '2026-10-06' }]).year, 'unknown');
  assert.equal(earnTiming('ordered', []).label, 'Unknown (no supplier ETA)');
});

test('pipeline view keeps signed jobs only and totals YA and Glass Forge separately', () => {
  const v = pipelineView({ cards: [card('A', 'half_down', { sale: 1000, windows: 400 }), card('Q', 'sent_to_customer', { sale: 9999, windows: 1 }), card('P', 'paid', { sale: 50, windows: 10 })] });
  assert.deepEqual(v.jobs.map((j) => j.id), ['A']);
  assert.deepEqual([v.totals.knownMargin, v.totals.yaShare, v.totals.gfShare, v.totals.crewUnknown], [600, 300, 300, 1]);
});

test('July diagnostic: imported sheet lines with stored labor that the earned formula leaves at $0', () => {
  const l = (id, extra) => ({ id, invoice_month: '2026-07', source: 'sheet-import', billable: true, labor_amt: 1000, ...extra });
  const d = importedLaborDiagnostic([
    l('a'), l('b', { labor_amt: 2500 }),
    l('calendar', { calendar_labor_amt: 1000 }), // counted by the earned formula already
    l('hours', { man_hours: 2 }), // ditto
    l('zero', { labor_amt: 0 }), l('gone', { superseded_by: 'x' }), l('nobill', { billable: false }),
    l('probuild', { source: 'probuild' }), l('aug', { invoice_month: '2026-08' }),
  ]);
  assert.deepEqual(d, { month: '2026-07', count: 2, labor: 3500, fee: 350 });
});

test('the QuickBooks snapshot adds up the way the report does', () => {
  const v = (label, i) => BOOKS_PL.rows.find((r) => r[0] === label)[i];
  for (const i of [1, 2]) {
    const income = BOOKS_PL.rows.filter((r) => r[3] === 'income').reduce((n, r) => n + r[i], 0);
    const expenses = BOOKS_PL.rows.filter((r) => r[3] === 'expense').reduce((n, r) => n + r[i], 0);
    assert.equal(Math.round(income * 100) / 100, v('Total income', i));
    assert.equal(Math.round(expenses * 100) / 100, v('Total expenses', i));
    assert.equal(Math.round((income - expenses) * 100) / 100, v('Net income', i));
  }
  // Accrual less cash income is QuickBooks' open receivables ($17,182.53).
  assert.equal(Math.round((v('Total income', 1) - v('Total income', 2)) * 100) / 100, 17182.53);
  assert.ok(QBO_SALES.every((s) => s.jobId && s.evidence));
});
