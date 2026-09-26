import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

// Loaded after the alias hook is registered (static imports would resolve first).
const { groupJobs, parseStreetAddress, jobCustomer } = await import('../src/lib/jobDedupe.js');
const { buildReportEvidence, visitsMissingReport, eventReportCleared } = await import('../src/lib/jobReports.js');
const { jobStatus } = await import('../src/lib/feeUI.js');
const { buildJobsOverview } = await import('../src/lib/jobsOverview.js');

const TODAY = '2026-09-18';

// ── Fixtures modelled on the screenshot: searching "2154" showed three Pulte
// Home - 2154 Jordanelle Ridge records and two Structura Construction Lindenb… records.
const pulteA = { id: 'job-a', canonical_name: 'Pulte Home - 2154 Jordanelle Ridge', builder: 'Pulte Home', address: '', created_date: '2026-06-01T10:00:00' };
const pulteB = { id: 'job-b', canonical_name: 'Pulte Homes - 2154 Jordanelle Ridge', address: '2154 Jordanelle Ridge Dr, Heber City, UT 84032', created_date: '2026-07-10T10:00:00' };
const pulteC = { id: 'job-c', canonical_name: 'pulte home - 2154 jordanelle ridge', aliases: ['pulte home - 2154 jordanelle ridge'], created_date: '2026-08-01T10:00:00' };
const pulteNextLot = { id: 'job-d', canonical_name: 'Pulte Home - 2156 Jordanelle Ridge', builder: 'Pulte Home', created_date: '2026-06-02T10:00:00' };
const structura1 = { id: 's1', canonical_name: 'Structura Construction Lindenberg Apartments', builder: 'Structura Construction', created_date: '2026-05-01T10:00:00' };
const structura2 = { id: 's2', canonical_name: 'Structura Construction - Lindenberg Apartments', builder: 'Structura Construction', created_date: '2026-05-20T10:00:00' };

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

test('addresses normalize street types, directionals, city/state/ZIP and units deterministically', () => {
  assert.deepEqual(parseStreetAddress('2154 Jordanelle Ridge Dr, Heber City, UT 84032'),
    { number: '2154', firstWord: 'jordanelle', street: '2154 jordanelle rdg', suffix: 'dr', unit: '' });
  assert.equal(parseStreetAddress('2154 Jordanelle Ridge Drive 84032').street, '2154 jordanelle rdg');
  assert.equal(parseStreetAddress('1450 West Lindenberg Avenue').street, parseStreetAddress('1450 W. Lindenberg Ave').street);
  // Five-digit house numbers are kept (only a trailing ZIP is dropped).
  assert.equal(parseStreetAddress('11354 W Watercourse Rd').number, '11354');
  assert.equal(parseStreetAddress('2154 Jordanelle Ridge #2').unit, 'unit 2');
  assert.equal(parseStreetAddress('Lindenberg Apartments'), null);
  assert.equal(parseStreetAddress(''), null);
  // "Pulte Home" must not cut the front off "Pulte Homes - …".
  assert.equal(jobCustomer({ canonical_name: 'Pulte Homes - 2154 Jordanelle Ridge', builder: 'Pulte Home' }).rest, '2154 Jordanelle Ridge');
  assert.equal(jobCustomer(pulteB).customer, 'pulte home');
});

test('the three Pulte 2154 Jordanelle Ridge records show as one job; the next lot stays separate', () => {
  const { groups, groupByJobId } = groupJobs([pulteC, pulteNextLot, pulteB, pulteA]);
  assert.equal(groups.length, 2);
  const g = groupByJobId.get('job-b');
  assert.equal(g, groupByJobId.get('job-a'));
  assert.equal(g, groupByJobId.get('job-c'));
  assert.equal(g.id, 'job-a', 'canonical record is the oldest');
  assert.deepEqual(g.memberIds, ['job-a', 'job-b', 'job-c']);
  assert.equal(g.merged, true);
  assert.equal(g.mergeReason, 'Same customer and address');
  assert.deepEqual(g.review, []);
  const lot = groupByJobId.get('job-d');
  assert.equal(lot.merged, false);
  assert.deepEqual(lot.review, [], 'a different house number is not a duplicate');
});

test('grouping is order-independent and never mutates the records', () => {
  const input = deepFreeze([pulteA, pulteB, pulteC, pulteNextLot, structura1, structura2].map((j) => ({ ...j })));
  const before = JSON.stringify(input);
  const forward = groupJobs(input);
  const backward = groupJobs([...input].reverse());
  const shape = (r) => r.groups.map((g) => [g.id, g.memberIds.join(','), g.review.map((x) => x.reason + ':' + x.jobIds.join(',')).join('|')]);
  assert.deepEqual(shape(forward), shape(backward));
  assert.equal(JSON.stringify(input), before);
});

test('Structura records with the same name but no address are flagged for review, not merged', () => {
  const { groupByJobId } = groupJobs([structura1, structura2]);
  const a = groupByJobId.get('s1');
  const b = groupByJobId.get('s2');
  assert.notEqual(a, b);
  assert.equal(a.merged, false);
  assert.deepEqual(a.review.map((r) => r.reason), ['Same customer and job name']);
  assert.deepEqual(a.review[0].jobs, [{ id: 's2', name: structura2.canonical_name }]);
  assert.deepEqual(b.review[0].jobIds, ['s1']);
});

test('Structura records with the same customer and address are merged', () => {
  const s3 = { id: 's3', canonical_name: 'Structura Construction - Lindenberg Bldg A', builder: 'Structura Construction', address: '1450 W Lindenberg Ave', created_date: '2026-04-01' };
  const s4 = { id: 's4', canonical_name: 'Structura Construction Lindenberg', builder: 'Structura Construction Inc.', address: '1450 West Lindenberg Avenue, Heber City, UT', created_date: '2026-04-02' };
  const { groups } = groupJobs([s3, s4]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].memberIds, ['s3', 's4']);
});

test('uncertain matches are flagged, never merged', () => {
  // Conflicting street types.
  const dr = { id: 't1', canonical_name: 'Holmes Homes - 88 Oak Dr', created_date: '2026-01-01' };
  const ct = { id: 't2', canonical_name: 'Holmes Homes - 88 Oak Ct', created_date: '2026-01-02' };
  let r = groupJobs([dr, ct]);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groupByJobId.get('t1').review.map((x) => x.reason), ['Same customer and address, but different street types (Dr vs Ct)']);
  // Different window quotes at the same address.
  const q1 = { id: 'q1', canonical_name: 'Holmes Homes - 12 Elm St', source_window_quote_id: 'wq-1', created_date: '2026-01-01' };
  const q2 = { id: 'q2', canonical_name: 'Holmes Homes - 12 Elm St', source_window_quote_id: 'wq-2', created_date: '2026-01-02' };
  r = groupJobs([q1, q2]);
  assert.equal(r.groups.length, 2);
  assert.match(r.groupByJobId.get('q2').review[0].reason, /different window quotes/);
  // A unit on the same street number: review, not merge.
  const unit = { id: 'job-e', canonical_name: 'Pulte Home - 2154 Jordanelle Ridge Unit 2', builder: 'Pulte Home', created_date: '2026-06-03' };
  r = groupJobs([pulteA, unit]);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groupByJobId.get('job-e').review[0].jobIds, ['job-a']);
  // Another customer at the same address is neither merged nor flagged.
  const toll = { id: 'toll', canonical_name: 'Toll Brothers - 2154 Jordanelle Ridge', builder: 'Toll Brothers', created_date: '2026-06-05' };
  r = groupJobs([pulteA, toll]);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groupByJobId.get('toll').review, []);
});

// ── Needs report ──────────────────────────────────────────────────────────
const visit827 = { id: 'r827', job_id: 'job-a', source: 'calendar', job_date: '2026-08-27', labor_amt: 300, calendar_event_id: 'g-827' };
const event827 = { id: 'e827', job_id: 'job-a', google_event_id: 'g-827', event_date: '2026-08-27', report_required: true, report_status: 'ok' };

test('REPORT COMPLETE on Aug 27 clears the job badge (the reported bug)', () => {
  // Before: billing lines alone keep the job in Needs report, as in the screenshot.
  assert.equal(jobStatus([visit827], null, TODAY).key, 'needs_report');
  const evidence = buildReportEvidence({ events: [event827] });
  assert.deepEqual(visitsMissingReport([visit827], evidence, TODAY), []);
  assert.equal(jobStatus([visit827], evidence, TODAY).key, 'complete');
});

test('unrelated reports never clear a genuinely missing report', () => {
  const visit820 = { id: 'r820', job_id: 'job-a', source: 'calendar', job_date: '2026-08-20', labor_amt: 300, calendar_event_id: 'g-820' };
  const rows = [visit820, visit827, { id: 'p821', job_id: 'job-a', source: 'probuild', job_date: '2026-08-21', labor_amt: 200 }];
  const evidence = buildReportEvidence({
    events: [
      { job_id: 'job-a', google_event_id: 'g-820', event_date: '2026-08-20', report_status: 'missing_all', days_late: 20 },
      event827,
      { job_id: 'job-z', google_event_id: 'g-z', event_date: '2026-08-20', report_status: 'ok' },
    ],
    notes: [
      { job_id: 'job-a', note_date: '2026-08-27', completion: 'complete' },
      { job_id: 'job-z', note_date: '2026-08-20', attachments: ['https://x.test/p.jpg'] },
    ],
  });
  assert.deepEqual(visitsMissingReport(rows, evidence, TODAY).map((r) => r.id), ['r820']);
  assert.equal(jobStatus(rows, evidence, TODAY).key, 'needs_report');
});

test("a visit's own pending event is not overridden by another event's report that day", () => {
  const row = { id: 'r902', job_id: 'job-a', source: 'calendar', job_date: '2026-09-02', labor_amt: 300, calendar_event_id: 'g-902a' };
  const evidence = buildReportEvidence({
    events: [
      { job_id: 'job-a', google_event_id: 'g-902a', event_date: '2026-09-02', report_status: 'pending' },
      { job_id: 'job-a', google_event_id: 'g-902b', event_date: '2026-09-02', report_status: 'ok' },
    ],
  });
  assert.equal(jobStatus([row], evidence, TODAY).key, 'needs_report');
});

test('which event states clear a visit', () => {
  assert.equal(eventReportCleared({ report_status: 'ok' }), true);
  assert.equal(eventReportCleared({ report_status: 'waived' }), true);
  assert.equal(eventReportCleared({ report_status: 'rescheduled' }), true);
  assert.equal(eventReportCleared({ report_required: false, report_status: 'pending' }), true);
  for (const s of ['pending', 'missing_photos', 'missing_notes', 'missing_all', 'no_source_data', 'pre_compliance', undefined]) {
    assert.equal(eventReportCleared({ report_status: s }), false, String(s));
  }
});

test('without a linked event, only same-job same-date evidence clears the visit', () => {
  const row = { id: 'r1', job_id: 'job-a', source: 'calendar', job_date: '2026-08-12', labor_amt: 300 };
  const status = (evidence) => jobStatus([row], buildReportEvidence(evidence), TODAY).key;
  assert.equal(status({ events: [{ job_id: 'job-a', event_date: '2026-08-12', report_status: 'waived' }] }), 'complete');
  assert.equal(status({ notes: [{ job_id: 'job-a', note_date: '2026-08-12', completion: 'incomplete' }] }), 'complete');
  assert.equal(status({ notes: [{ job_id: 'job-a', note_date: '2026-08-12', attachments: ['a.jpg'] }] }), 'complete');
  assert.equal(status({ notes: [{ job_id: 'job-a', note_date: '2026-08-12', body: 'called the super' }] }), 'needs_report');
  assert.equal(status({ notes: [{ job_id: 'job-a', note_date: '2026-08-13', completion: 'complete' }] }), 'needs_report');
  assert.equal(status({ events: [{ job_id: 'job-b', event_date: '2026-08-12', report_status: 'ok' }] }), 'needs_report');
});

test('a ProBuild line that supersedes the visit clears it even on the next day', () => {
  const row = { id: 'r3', job_id: 'job-a', source: 'calendar', job_date: '2026-08-27', labor_amt: 0, calendar_event_id: 'g-3' };
  const post = { id: 'p3', job_id: 'job-a', source: 'probuild', job_date: '2026-08-28', labor_amt: 200, superseded_by: 'r3' };
  const evidence = buildReportEvidence({ events: [{ job_id: 'job-a', google_event_id: 'g-3', event_date: '2026-08-27', report_status: 'pending' }] });
  assert.equal(jobStatus([row, post], evidence, TODAY).key, 'complete');
  assert.equal(jobStatus([row, { ...post, superseded_by: 'other' }], evidence, TODAY).key, 'needs_report');
});

test('a visit rescheduled to a later date is not due yet', () => {
  const row = { id: 'r4', job_id: 'job-a', source: 'calendar', job_date: '2026-09-10', labor_amt: 300, calendar_event_id: 'g-4' };
  const evidence = buildReportEvidence({ events: [{ job_id: 'job-a', google_event_id: 'g-4', event_date: '2026-09-25', report_status: 'pending' }] });
  assert.equal(jobStatus([row], null, TODAY).key, 'needs_report');
  assert.equal(jobStatus([row], evidence, TODAY).key, 'active');
});

test('a job-match review hold is "Needs review", not "Needs report"', () => {
  const evidence = buildReportEvidence({ events: [event827] });
  assert.equal(jobStatus([{ ...visit827, needs_review: true }], evidence, TODAY).key, 'needs_review');
  assert.equal(jobStatus([{ ...visit827, needs_review: true, manually_adjusted: true }], evidence, TODAY).key, 'complete');
  // A genuinely missing report still wins over the review hold.
  assert.equal(jobStatus([{ ...visit827, needs_review: true }], null, TODAY).key, 'needs_report');
});

test('Jobs hub counts: duplicates shown once, completed reports leave the Needs report count', () => {
  const jobs = [pulteA, pulteB, pulteC, pulteNextLot, structura1, structura2];
  const feeLines = [
    visit827,                                                                                            // Pulte A: visit, report complete
    { id: 'pb827', job_id: 'job-b', source: 'probuild', job_date: '2026-08-27', labor_amt: 200 },          // its report, filed on duplicate B
    { id: 'rd', job_id: 'job-d', source: 'calendar', job_date: '2026-08-20', labor_amt: 300, calendar_event_id: 'g-d' }, // next lot: missing
    { id: 'rs', job_id: 's1', source: 'calendar', job_date: '2026-09-05', labor_amt: 300, calendar_event_id: 'g-s' },    // waived
  ];
  const events = [
    event827,
    { job_id: 'job-d', google_event_id: 'g-d', event_date: '2026-08-20', report_status: 'missing_all' },
    { job_id: 's1', google_event_id: 'g-s', event_date: '2026-09-05', report_status: 'waived' },
  ];

  // Old behaviour, one status per record from billing lines only: 3 "Needs report", 6 rows.
  const perRecord = jobs.map((j) => jobStatus(feeLines.filter((r) => r.job_id === j.id), null, TODAY).key);
  assert.equal(perRecord.filter((k) => k === 'needs_report').length, 3);

  const after = buildJobsOverview({ jobs, feeLines, events, notes: [], today: TODAY });
  assert.equal(after.evidenceAvailable, true);
  assert.equal(after.groups.length, 4, 'three Pulte records shown as one job');
  assert.equal(after.counts.records, 6);
  assert.equal(after.stats['job-a'].status.key, 'complete');
  assert.equal(after.stats['job-d'].status.key, 'needs_report', 'the genuinely missing report still counts');
  assert.equal(after.stats.s1.status.key, 'complete');
  assert.deepEqual(
    { needs_report: after.counts.needs_report, complete: after.counts.complete, active: after.counts.active, duplicates: after.counts.duplicates },
    { needs_report: 1, complete: 2, active: 1, duplicates: 2 }
  );

  // If calendar events cannot load, the merged group still pools its lines and the page is told.
  const degraded = buildJobsOverview({ jobs, feeLines, events: null, notes: null, today: TODAY });
  assert.equal(degraded.evidenceAvailable, false);
  assert.equal(degraded.stats['job-a'].status.key, 'complete');
  assert.equal(degraded.counts.needs_report, 2);
});

test('a name-only record merges into the same-name record that has the real address', () => {
  const nameOnly = { id: 'n1', canonical_name: 'pulte homes - 338 sunset flats', created_date: '2026-06-01' };
  const full = { id: 'n2', canonical_name: 'Pulte Home - 338 Sunset Flats', builder: 'Pulte Home', address: '4929 N Granite Ln Eagle Mountain, UT 84005', created_date: '2026-06-03' };
  const otherLot = { id: 'n3', canonical_name: 'Pulte Home - 339 Sunset Flats', builder: 'Pulte Home', address: '4931 N Granite Ln Eagle Mountain, UT 84005', created_date: '2026-06-04' };
  const { groups, groupByJobId } = groupJobs([nameOnly, full, otherLot]);
  assert.equal(groups.length, 2);
  const g = groupByJobId.get('n2');
  assert.equal(g, groupByJobId.get('n1'));
  assert.deepEqual(g.memberIds, ['n1', 'n2'], 'oldest record stays canonical');
  assert.equal(g.merged, true);
  assert.deepEqual(g.review, []);
  assert.notEqual(groupByJobId.get('n3'), g, 'another lot stays its own job');
});

test('same name but two different real addresses stays flagged, not merged', () => {
  const a = { id: 'd1', canonical_name: 'DAI - 26 Calypso Wild Flower', builder: 'DAI', address: '1839 N Barbara Belle Lane Saratoga Springs, UT 84043', created_date: '2026-01-01' };
  const b = { id: 'd2', canonical_name: 'DAI - 26 Calypso Wild Flower', builder: 'DAI', address: '1868 N Dancing Lady Lane, Saratoga Springs UT 84043', created_date: '2026-01-02' };
  const { groups, groupByJobId } = groupJobs([a, b]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groupByJobId.get('d1').review.map((r) => r.reason), ['Same customer and job name']);
});
