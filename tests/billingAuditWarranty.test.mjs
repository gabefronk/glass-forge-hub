// Semantic regression for the jobIngestDedupe "g4" fixture: a "Pulte warranty"
// calendar visit with a PO and no labor must (1) still match the canonical Pulte
// job and (2) be flagged for billing review — service work with no labor amount
// and no explicit no-charge decision. fetchCalendarEvents sets needs_review=true
// when assessBillingLine returns kind 'review'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { assessBillingLine } from '../base44/shared/billingAudit.js';

const out = await build({ entryPoints: [fileURLToPath(new URL('../base44/shared/ingestShared.ts', import.meta.url))], bundle: true, platform: 'neutral', format: 'esm', write: false, logLevel: 'silent' });
const ingest = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// Same Pulte duplicates as base44/tests/jobIngestDedupe.test.mjs.
const PULTE = [
  { id: 'job-c', canonical_name: 'pulte home - 2154 jordanelle ridge', aliases: ['pulte home - 2154 jordanelle ridge'], created_date: '2026-08-01T10:00:00' },
  { id: 'job-b', canonical_name: 'Pulte Homes - 2154 Jordanelle Ridge', address: '2154 Jordanelle Ridge Dr, Heber City, UT 84032', po_numbers: ['4455667'], created_date: '2026-07-10T10:00:00' },
  { id: 'job-d', canonical_name: 'Pulte Home - 2156 Jordanelle Ridge', builder: 'Pulte Home', created_date: '2026-06-02T10:00:00' },
  { id: 'job-a', canonical_name: 'Pulte Home - 2154 Jordanelle Ridge', builder: 'Pulte Home', address: '', created_date: '2026-06-01T10:00:00' },
];
const g4Event = { source: 'google', source_status: 'confirmed', google_event_id: 'g4', event_date: '2026-09-05', job_name: 'Pulte warranty', po_number: '4455667', scope_notes: '' };
const g4Row = { source: 'calendar', written_by: 'calendar', calendar_event_id: 'g4', job_name_raw: 'Pulte warranty', job_date: '2026-09-05', po_number: '4455667', labor_amt: 0, fee_pct: 0.1 };

test('g4 warranty: job matching is preserved (PO lands on canonical job-a, no match review)', () => {
  const m = ingest.matchJob('pulte warranty', PULTE, '4455667', null, null, { rawName: 'Pulte warranty' });
  assert.equal(m.job_id, 'job-a');
  assert.equal(m.autoCreate, false);
  assert.equal(m.needs_review, false);
});

test('g4 warranty: billing audit flags review (service, no labor, no no-charge decision)', () => {
  const a = assessBillingLine(g4Row, g4Event, '2026-10-06');
  assert.equal(a.kind, 'review');
  assert.match(a.reason, /Service work has no labor amount/);
});

test('control: same warranty with explicit no-charge is not a review, with labor is standard', () => {
  assert.equal(assessBillingLine(g4Row, { ...g4Event, scope_notes: 'Warranty - no charge' }, '2026-10-06').kind, 'no_charge');
  // Labor is computed from calendar_labor_amt (billingCore.computeLaborAmt), not labor_amt.
  assert.equal(assessBillingLine({ ...g4Row, calendar_labor_amt: 200 }, g4Event, '2026-10-06').kind, 'standard');
});