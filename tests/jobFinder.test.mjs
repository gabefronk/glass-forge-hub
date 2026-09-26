import test from 'node:test';
import assert from 'node:assert/strict';
import { findJobs, findEvents, matchScore, resolveDate } from '../base44/shared/jobFinder.js';

const jobs = [
  { id: 'j1', canonical_name: 'holmes homes - 412 oquirrh west', aliases: [], builder: 'Holmes Homes', po_numbers: ['7104345'], oe_numbers: [] },
  { id: 'j2', canonical_name: 'holmes homes - 422 oquirrh west', aliases: [], builder: 'Holmes Homes', address: '7597 S Clipper Hill Rd West Jordan', po_numbers: [], oe_numbers: [] },
  { id: 'j3', canonical_name: 'home sweet home - brewer', aliases: ['ya - home sweet home brewer res'], po_numbers: [], oe_numbers: [] },
];
const events = [
  { id: 'e1', job_id: 'j1', job_name: 'Holmes Homes - 412 Oquirrh West', address: '7577 S Oak Hallow Rd West Jordan, UT 84081', event_date: '2026-09-29', start_time: '08:00', google_event_id: 'g1', labor_amt: 900, scope_notes: 'Labor $900' },
  { id: 'e2', job_name: 'Holmes Homes - 412 Oquirrh West', address: '7577 S Oak Hallow Rd West Jordan, UT 84081', event_date: '2026-09-20', google_event_id: 'g2' },
  { id: 'e3', job_name: 'YA - #1 Home Sweet Home - Brewer', address: '1149 N Titan Dr Lehi, UT 84043', event_date: '2026-09-25', google_event_id: 'g3' },
  { id: 'e4', job_name: 'Wartman Cash - Scott Beers', address: '199 E Elm St, Murray', event_date: '2026-09-26', google_event_id: 'gfjobs-x' },
];
const today = '2026-09-26';

test('lot numbers must match exactly', () => {
  assert.ok(matchScore('412 oquirrh', 'Holmes Homes - 412 Oquirrh West') >= 0.99);
  assert.ok(matchScore('412 oquirrh', 'Holmes Homes - 422 Oquirrh West') < 0.6);
});

test('find_job returns the address from the calendar when the job has none, and no money', () => {
  const r = findJobs({ query: 'oquirrh west 412', today }, jobs, events);
  assert.equal(r.results[0].job_id, 'j1');
  assert.equal(r.results[0].address, '7577 S Oak Hallow Rd West Jordan, UT 84081');
  assert.equal(r.results[0].address_source, 'calendar_event');
  assert.equal(r.results[0].next_visits[0].event_id, 'e1');
  const json = JSON.stringify(r);
  assert.ok(!json.includes('900') && !json.includes('labor'));
});

test('find_job by address and by PO', () => {
  assert.equal(findJobs({ query: '7597 clipper hill', today }, jobs, events).results[0].job_id, 'j2');
  assert.equal(findJobs({ query: 'PO 7104345', today }, jobs, events).results[0].job_id, 'j1');
});

test('find_job falls back to unlinked calendar events by name', () => {
  const r = findJobs({ query: 'brewer', today }, jobs, events);
  assert.equal(r.results[0].job_id, 'j3');
  assert.equal(r.results[0].address, '1149 N Titan Dr Lehi, UT 84043');
});

test('find_events by date and by text; marks synthetic rows unmovable', () => {
  const day = findEvents({ date: '2026-09-26', today }, events);
  assert.deepEqual(day.events.map((e) => e.event_id), ['e4']);
  assert.equal(day.events[0].movable, false);
  const txt = findEvents({ query: 'beers', today }, events);
  assert.equal(txt.events[0].event_id, 'e4');
  assert.equal(findEvents({ today }, events).from, today);
});

test('resolveDate handles words and rejects junk', () => {
  assert.equal(resolveDate('2026-10-01'), '2026-10-01');
  assert.equal(resolveDate('next week'), '');
  assert.match(resolveDate('today'), /^\d{4}-\d{2}-\d{2}$/);
});
