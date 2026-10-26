import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { companyYear, monthFigures, pipeline, withSplitPlan, shopCost, glassForgeHalf, denverMonth, companyYearCsv } = await import('../src/lib/companyOverview.js');

const install = (id, month, labor, extra = {}) => ({ id, invoice_month: month, job_date: `${month}-10`, billable: true, fee_type: 'labor_pct', labor_amt: labor, calendar_labor_amt: labor, fee_pct: 0.1, ...extra });
const split = (id, month, sale, cost, extra = {}) => ({ id, invoice_month: month, job_date: `${month}-12`, billable: true, fee_type: 'profit_split', labor_amt: 0, split_pct: 0.5, sale_price: sale, cost, ...extra });
const card = (id, stage, sale, cost) => ({ job: { id, canonical_name: id }, paymentStage: stage, windows: { display: { value: cost } }, rough: { display: { value: 0 } }, sale: { display: { value: sale } }, profitDisplay: { value: sale == null ? null : sale - cost } });

test('a month splits install labor and the 10% fee from profit-split sales, cost and Glass Forge half', () => {
  const m = monthFigures([install('a', '2026-09', 1000), install('b', '2026-09', 500), split('c', '2026-09', 10000, 6000)], '2026-09', 250);
  assert.deepEqual(
    { labor: m.labor, sales: m.sales, income: m.income, jobCost: m.jobCost, shop: m.shop, fee: m.fee, split: m.split, glassForge: m.glassForge, profit: m.profit },
    { labor: 1500, sales: 10000, income: 11500, jobCost: 6000, shop: 250, fee: 150, split: 2000, glassForge: 2150, profit: 3100 },
  );
  assert.equal(Math.round(m.margin * 1000), 270);
});

test('YTD runs January to this month, ties to Invoicing rows and leaves out superseded, collection and future lines', () => {
  const rows = [
    install('jan', '2026-01', 1000),
    install('feb', '2026-02', 3000),
    install('gone', '2026-02', 9999),
    install('held', '2026-02', 777, { customer_collection_state: 'prepared' }),
    install('oct', '2026-03', 400, { job_date: '2026-03-05' }),
    install('later', '2026-03', 600, { job_date: '2026-03-20' }),
    install('lastyear', '2025-12', 5000),
  ];
  const y = companyYear({ rows, superseded: new Set(['gone']), today: '2026-03-15' });
  assert.deepEqual(y.months.map((m) => [m.month, m.labor]), [['2026-01', 1000], ['2026-02', 3000], ['2026-03', 400]]);
  assert.equal(y.ytd.labor, 4400);
  assert.equal(y.ytd.glassForge, 440);
  assert.equal(y.ytd.profit, 3960);
});

test('projection adds open Purchasing jobs and the months left at the average of the months before this one', () => {
  const rows = [install('a', '2026-01', 2000), install('b', '2026-02', 4000), install('c', '2026-10', 500)];
  const cards = [card('open', 'ordered', 10000, 6000), card('paid', 'paid', 8000, 4000), card('quote', 'sent_to_customer', 5000, 1000)];
  const y = companyYear({ rows, cards, today: '2026-10-26' });
  // Jan–Sep average: 6,000 / 9 = 666.67 a month, two months left.
  assert.equal(y.pace.average, 666.67);
  assert.equal(y.pace.labor, 1333.34);
  assert.equal(y.pace.fee, 133.33);
  assert.equal(y.pace.to, '2026-09');
  assert.deepEqual(y.pipeline.jobs.map((j) => j.id), ['open']);
  assert.equal(y.pipeline.glassForge, 2000);
  assert.equal(y.pipeline.ya, 2000);
  assert.equal(y.projected.income, round(6500 + 10000 + 1333.34));
  assert.equal(y.projected.glassForge, round(650 + 2000 + 133.33));
  assert.equal(y.projected.profit, round(5850 + 2000 + 1333.34 - 133.33));
});
const round = (n) => Math.round(n * 100) / 100;

test('pipeline halves profit in cents the way the split line does and flags jobs with no sale or cost', () => {
  assert.equal(glassForgeHalf(297.03), 148.52);
  const p = pipeline([card('a', 'half_down', 600, 302.97), card('b', 'delivered', null, 477.46)]);
  assert.equal(p.jobs.find((j) => j.id === 'a').glassForge, 148.52);
  assert.equal(p.jobs.find((j) => j.id === 'a').ya, 148.51);
  assert.equal(p.missing, 1);
  assert.equal(p.cost, 780.43);
});

test('a job marked Paid before Invoicing syncs still lands in its month through the pending split line', () => {
  const plan = { creates: [split(undefined, '2026-10', 7022.31, 2748.78, { purchasing_split_job_id: 'ammon', fee_amt: 2136.77, manually_adjusted: true })], updates: [{ id: 'x', sale_price: 900, cost: 500, fee_amt: 200, manually_adjusted: true }], deletes: ['stale'] };
  const rows = withSplitPlan([split('x', '2026-10', 800, 500), split('stale', '2026-10', 100, 0)], plan);
  assert.deepEqual(rows.map((r) => r.id), ['x', 'pending-split-ammon']);
  const m = monthFigures(rows, '2026-10');
  assert.equal(m.sales, 7922.31);
  assert.equal(m.split, 2336.77);
});

test('shop purchases count in the Denver month they were raised; cancelled and job POs do not', () => {
  const pos = [
    { purchase_type: 'shop', amount_dealer: 1029.69, created_date: '2026-10-25T18:00:00.000000', status: 'issued' },
    { purchase_type: 'shop', amount_dealer: 50, created_date: '2026-11-01T03:00:00', status: 'ordered' },
    { purchase_type: 'shop', amount_dealer: 99, created_date: '2026-10-05T18:00:00', status: 'cancelled' },
    { amount_dealer: 5000, created_date: '2026-10-05T18:00:00', job_id: 'j' },
  ];
  assert.equal(denverMonth('2026-11-01T03:00:00'), '2026-10');
  assert.equal(shopCost(pos, '2026-10'), 1079.69);
});

test('CSV lists each month and the YTD row with costs as negatives', () => {
  const y = companyYear({ rows: [install('a', '2026-01', 1000), split('b', '2026-02', 3000, 1000)], today: '2026-02-20' });
  const csv = companyYearCsv(y).split('\n');
  assert.equal(csv.length, 4);
  assert.equal(csv[2], '"Feb 2026",0.00,3000.00,3000.00,-1000.00,0.00,0.00,-1000.00,1000.00');
  assert.equal(csv[3], '"2026 to date",1000.00,3000.00,4000.00,-1000.00,0.00,-100.00,-1000.00,1900.00');
});
