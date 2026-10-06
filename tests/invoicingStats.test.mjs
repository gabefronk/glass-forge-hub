import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
// Loaded after the alias hook is registered (static imports would resolve first).
const { invoicingStats } = await import('../src/lib/invoicingStats.js');

// Gabe's rule for the month total: anything that is done AND reported counts; a visit with no
// field report yet does not count until it is; future (scheduled) work never counts.
test('month total = done + reported; waiting-on-report and scheduled lines stay out until they clear', () => {
  const rows = [
    { id: 'ready', job_date: '2026-09-02', billable: true, calendar_labor_amt: 1000, labor_amt: 1000, fee_pct: 0.1, calendar_event_id: 'e1' },           // fee 100, reported ok
    { id: 'billed', job_date: '2026-09-03', billable: true, calendar_labor_amt: 500, labor_amt: 500, fee_pct: 0.1, billed_to_bfs: true },                // fee 50
    { id: 'pricing', job_date: '2026-09-04', billable: true, calendar_labor_amt: 800, labor_amt: 800, fee_pct: 0.1, needs_review: true, calendar_event_id: 'e2' }, // fee 80, reported, price unsure
    { id: 'noreport', job_date: '2026-09-05', billable: true, calendar_labor_amt: 300, labor_amt: 300, fee_pct: 0.1, calendar_event_id: 'e3' },         // fee 30, crew has not reported
    { id: 'future', job_date: '2099-01-01', billable: true, calendar_labor_amt: 900, labor_amt: 900, fee_pct: 0.1 },                                      // fee 90, scheduled
    { id: 'off', job_date: '2026-09-06', billable: false, calendar_labor_amt: 999, labor_amt: 999, fee_pct: 0.1 },
  ];
  const reports = new Map([['e1', 'ok'], ['e2', 'ok'], ['e3', 'missing']]);
  const s = invoicingStats(rows, reports);
  assert.equal(s.readyTotal, 100); assert.equal(s.readyCount, 1);
  assert.equal(s.billedTotal, 50); assert.equal(s.billedCount, 1);
  assert.equal(s.matchBlockedTotal, 80); assert.equal(s.matchBlockedCount, 1);
  assert.equal(s.reportBlockedTotal, 30); assert.equal(s.reportBlockedCount, 1);
  assert.equal(s.scheduledTotal, 90); assert.equal(s.scheduledCount, 1);
  // the headline: ready + billed + pricing-review (done and reported) = 230; not the $30 waiting
  // on a report, not the $90 scheduled, not the non-billable line
  assert.equal(s.monthEarnedTotal, 230);
  assert.equal(s.monthEarnedCount, 3);
  assert.equal(s.recordedLaborTotal, 2300, 'labor follows the same population');
  // the two reasons a done line is not yet ready are still reported separately for the page's links
  assert.equal(s.heldTotal, 110, 'held = pricing + waiting on report');
});
