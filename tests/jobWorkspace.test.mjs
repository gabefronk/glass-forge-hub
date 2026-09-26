import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { jobSnapshot, workLines } = await import('../src/lib/jobWorkspace.js');
const TODAY = '2026-09-25';
const job = { po_numbers: ['7249419'], oe_numbers: ['79567505-00'] };

test('today visit leads with the time and first line of scope', () => {
  const s = jobSnapshot({ job, today: TODAY, status: { key: 'active', label: 'Active' }, events: [
    { event_date: '2026-09-21', job_name: 'Rainey warranty', scope_notes: 'Glass received' },
    { event_date: '2026-09-25', job_name: 'Rainey warranty', created_by: 'iryedra@gmail.com', scope_notes: 'Replace 1626 FX glass, primary bath<br>Labor $450<br>PO 7302254<br>Replace 2646 SH pantry deadlight', po_number: '7302254' },
  ] });
  assert.equal(s.step.tag, 'Today');
  assert.equal(s.step.text, 'Today, all day. Replace 1626 FX glass, primary bath');
  assert.equal(s.kind, 'Service');
  assert.deepEqual(s.work, ['Replace 1626 FX glass, primary bath', 'Replace 2646 SH pantry deadlight']);
  assert.deepEqual(s.facts.map((f) => f.v), ['Today · all day', 'Ragen', '7249419', '79567505-00']);
  assert.deepEqual(s.refs, ['PO 7249419', 'PO 7302254', 'OE 79567505-00']);
});

test('a late report outranks the next visit', () => {
  const s = jobSnapshot({ job: {}, today: TODAY, status: { key: 'needs_report', label: 'Needs report' }, events: [
    { event_date: '2026-09-22', report_status: 'pending', days_late: 3, scope_notes: 'Install Bonelli handle' },
    { event_date: '2026-09-29', scope_notes: 'Return trip' },
  ] });
  assert.equal(s.step.tag, 'Report late');
  assert.equal(s.step.tone, 'bad');
  assert.match(s.step.text, /Sep 22 visit still has no field report/);
});

test('cancelled visits are ignored and empty jobs say so', () => {
  const s = jobSnapshot({ job: {}, today: TODAY, status: { key: 'active', label: 'Active' }, events: [{ event_date: '2026-09-30', source_status: 'cancelled' }] });
  assert.equal(s.next, null);
  assert.equal(s.step.text, 'No visit on the calendar yet.');
  assert.deepEqual(workLines('- one;  two\n$1,200 labor'), ['one', 'two']);
});

test('a job worked from a field report shows that visit and its work, not "none yet"', () => {
  const s = jobSnapshot({ job: {}, today: TODAY, status: { key: 'complete', label: 'Complete' }, events: [],
    rows: [{ job_date: '2026-09-23', source: 'probuild', calendar_creator: 'iryedra@gmail.com', po_number: '6534825' }],
    fieldReports: [{ job_date: '2026-09-23', message: 'Pulled the stationary panel\nReseated it in the cavity\nWater tested, no leaks' }] });
  assert.equal(s.facts[0].k, 'Last visit');
  assert.equal(s.facts[0].v, 'Sep 23');
  assert.equal(s.facts[1].v, 'Ragen');
  assert.equal(s.facts[2].v, '6534825');
  assert.equal(s.step.tag, 'Done');
  assert.equal(s.step.text, 'Work complete. Last visit was Sep 23.');
  assert.deepEqual(s.work, ['Pulled the stationary panel', 'Reseated it in the cavity', 'Water tested, no leaks']);
  assert.equal(s.workFrom, 'from the Sep 23 report');
});

test('job names display with capital first letters, keeping existing capitals', async () => {
  const { titleCase } = await import('../src/lib/displayName.js');
  assert.equal(titleCase('patterson homes - 10 beck hillside estates'), 'Patterson Homes - 10 Beck Hillside Estates');
  assert.equal(titleCase('AV24 - Aria-Belle - 1212 North Luna Circle - RETRO'), 'AV24 - Aria-Belle - 1212 North Luna Circle - RETRO');
  assert.equal(titleCase('d r horton 165 viridian'), 'D R Horton 165 Viridian');
  assert.equal(titleCase('911 - pulte home - 347 sunset flat'), '911 - Pulte Home - 347 Sunset Flat');
  assert.equal(titleCase(''), '');
});
