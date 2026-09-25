import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { visitSummary, addDays, sortJobGroups, builderOptions, buildJobsOverview } = await import('../src/lib/jobsOverview.js');

const TODAY = '2026-09-25';

test('addDays crosses month and year ends without UTC drift', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('visitSummary picks next (today counts) and last visit, ignoring cancelled events', () => {
  const v = visitSummary({
    today: TODAY,
    events: [
      { event_date: '2026-09-20' },
      { event_date: '2026-09-25' },
      { event_date: '2026-09-22', source_status: 'cancelled' },
      { event_date: 'not a date' },
    ],
    lines: [{ job_date: '2026-09-10' }, { job_date: '2026-10-02' }, { job_date: '2026-09-20' }],
  });
  assert.deepEqual(v, { nextVisit: '2026-09-25', lastVisit: '2026-09-20', visitCount: 4 });
  assert.deepEqual(visitSummary({ today: TODAY }), { nextVisit: null, lastVisit: null, visitCount: 0 });
});

const g = (id, name, created) => ({ id, job: { id, canonical_name: name }, members: [{ id, created_date: created }] });

test('sortJobGroups: next visit first, unscheduled last; last visit; name; newest', () => {
  const groups = [g('a', 'Bravo', '2026-01-01'), g('b', 'alpha', '2026-03-01'), g('c', 'Charlie', '2026-02-01')];
  const stats = { a: { nextVisit: '2026-10-01', lastVisit: '2026-09-01' }, b: { nextVisit: null, lastVisit: '2026-09-20' }, c: { nextVisit: '2026-09-26', lastVisit: null } };
  assert.deepEqual(sortJobGroups(groups, stats, 'next').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(sortJobGroups(groups, stats, 'last').map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(sortJobGroups(groups, stats, 'name').map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(sortJobGroups(groups, stats, 'recent').map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(groups.map((x) => x.id), ['a', 'b', 'c'], 'input not mutated');
});

test('builderOptions counts distinct builders and skips blanks', () => {
  const groups = [{ job: { builder: 'Pulte' } }, { job: { builder: ' Pulte ' } }, { job: { builder: 'Ivory' } }, { job: {} }];
  assert.deepEqual(builderOptions(groups), [{ name: 'Ivory', count: 1 }, { name: 'Pulte', count: 2 }]);
});

test('buildJobsOverview adds visit dates from linked events and a this-week count', () => {
  const jobs = [
    { id: 'j1', canonical_name: 'Pulte - 12 Oak Ln', builder: 'Pulte', address: '12 Oak Ln', created_date: '2026-09-01T00:00:00Z' },
    { id: 'j2', canonical_name: 'Ivory - 9 Elm St', builder: 'Ivory', address: '9 Elm St', created_date: '2026-09-02T00:00:00Z' },
  ];
  const events = [
    { job_id: 'j1', event_date: '2026-09-28' },
    { job_id: 'j2', event_date: '2026-10-15' },
    { job_id: 'j2', event_date: '2026-09-01' },
  ];
  const { stats, counts } = buildJobsOverview({ jobs, feeLines: [], events, notes: [], today: TODAY });
  assert.equal(stats.j1.nextVisit, '2026-09-28');
  assert.equal(stats.j1.thisWeek, true);
  assert.equal(stats.j2.nextVisit, '2026-10-15');
  assert.equal(stats.j2.lastVisit, '2026-09-01');
  assert.equal(stats.j2.thisWeek, false);
  assert.equal(counts.this_week, 1);
});
