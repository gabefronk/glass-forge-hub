import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

// Loaded after the alias hook is registered (static imports would resolve first).
const { isPdfUrl, splitLinks, protectUrls, fileLabel } = await import('../src/lib/fileLinks.js');
const { sanitizeText, cleanFeedText } = await import('../src/lib/jobsSanitize.js');
const { jobStatus } = await import('../src/lib/feeUI.js');
const { shiftMonthStr, withComputedAmounts } = await import('../src/lib/feeMath.js');
const { invoicingStats } = await import('../src/lib/invoicingStats.js');
const { isReady, buildSupersededSet } = await import('../src/lib/invoicingFilters.js');

test('PDF links are recognised regardless of case, query strings and signed-URL tokens', () => {
  assert.equal(isPdfUrl('https://media.base44.com/files/Laird%20Lot%2012%20Plans.PDF?token=abc'), true);
  assert.equal(isPdfUrl('https://d1.cloudfront.net/laird/plans.pdf#page=2'), true);
  assert.equal(isPdfUrl('data:application/pdf;base64,JVBERi0='), true);
  assert.equal(isPdfUrl('https://media.base44.com/files/photo.jpg'), false);
  assert.equal(isPdfUrl('https://example.com/pdf-guide'), false);
  assert.equal(isPdfUrl(''), false);
  assert.equal(fileLabel('https://media.base44.com/files/Laird%20Lot%2012%20Plans.pdf?x=1'), 'Laird Lot 12 Plans.pdf');
});

test('links are split out of text without trailing sentence punctuation', () => {
  assert.deepEqual(splitLinks('Plans: https://x.test/a.pdf. Call me'), [
    { type: 'text', value: 'Plans: ' },
    { type: 'link', value: 'https://x.test/a.pdf' },
    { type: 'text', value: '. Call me' },
  ]);
  assert.deepEqual(splitLinks('no links here'), [{ type: 'text', value: 'no links here' }]);
  assert.deepEqual(splitLinks(null), []);
});

test('protected links survive comma splitting and are restored exactly', () => {
  const url = 'https://maps.test/place/40.5,-111.9?sig=a;b';
  const p = protectUrls(`See ${url}, then call`);
  assert.ok(!p.text.includes(','.concat('-111')));
  assert.equal(p.restore(p.text), `See ${url}, then call`);
});

test('job text keeps Laird plan links that the billing filter used to delete or split', () => {
  const cdn = 'Laird plans: https://d1.cloudfront.net/laird/plans.pdf';
  assert.equal(sanitizeText(cdn), cdn); // "net" in the host no longer drops the line
  const map = 'Site https://maps.test/place/40.5,-111.9 gate code 1234';
  assert.equal(sanitizeText(map), map); // commas inside the link are not split
  assert.equal(cleanFeedText('Report photos https://media.base44.com/f/abc.pdf'), 'Report photos https://media.base44.com/f/abc.pdf');
});

test('pricing is still removed from job text, including links that name billing documents', () => {
  assert.equal(sanitizeText('Windows set, Labor $75, trim next week'), 'Windows set, trim next week');
  assert.equal(sanitizeText('Total: 450'), '');
  assert.equal(sanitizeText('https://files.test/Laird-Price-Sheet.pdf'), '');
});

test('job status treats a manually adjusted review line as reviewed', () => {
  const rows = [{ source: 'both', job_date: '2026-01-05', labor_amt: 100, needs_review: true, manually_adjusted: true }];
  assert.equal(jobStatus(rows).key, 'complete');
  // A job-match review hold is its own status, not a missing report (jobReports addendum).
  assert.equal(jobStatus([{ ...rows[0], manually_adjusted: false }]).key, 'needs_review');
});

test('month shifting crosses year boundaries without Date/UTC conversion', () => {
  assert.equal(shiftMonthStr('2026-01', -1), '2025-12');
  assert.equal(shiftMonthStr('2026-12', 1), '2027-01');
  assert.equal(shiftMonthStr('2026-09', 0), '2026-09');
  assert.equal(shiftMonthStr('2026-03', -15), '2024-12');
});

test('Dashboard/sidebar ready-to-bill totals match Invoicing once amounts are recomputed', () => {
  // A ProBuild line whose stored labor_amt is stale (0) but has 2 man hours: Invoicing
  // recomputes labor ($200, fee $20) and counts it ready; raw stored values did not.
  const rows = [
    { id: 'a', invoice_month: '2026-01', job_date: '2026-01-05', billable: true, man_hours: 2, labor_amt: 0, fee_pct: 0.1 },
    { id: 'b', invoice_month: '2026-01', job_date: '2026-01-06', billable: true, calendar_labor_amt: 300, labor_amt: 300, fee_pct: 0.1 },
    { id: 'c', invoice_month: '2026-01', job_date: '2026-01-07', billable: true, labor_amt: 500, fee_pct: 0.1, needs_review: true },
  ];
  const raw = invoicingStats(rows, new Map());
  const computed = invoicingStats(withComputedAmounts(rows), new Map());
  assert.equal(raw.readyCount, 1);
  assert.equal(computed.readyCount, 2);
  assert.equal(computed.readyTotal, 50);
  // The statement export filters the same population.
  const lines = withComputedAmounts(rows);
  const superseded = buildSupersededSet(lines);
  const exported = lines.filter((r) => isReady(r, new Map(), superseded));
  assert.deepEqual(exported.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(withComputedAmounts(null), []);
});
