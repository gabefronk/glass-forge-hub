import test from 'node:test';
import assert from 'node:assert/strict';
import { eventKind, reportMissing, needsReportFilter, reportBadge, filterEvents, kindCounts, weekDays, groupByDay, weekLabel, addDays } from '../src/lib/calendarModel.js';

const TODAY = '2026-09-25';

test('eventKind: service wording means service, otherwise install; outlook separate', () => {
  assert.equal(eventKind({ source: 'app', job_name: 'Holmes Homes - 210 Lakeview' }), 'install');
  assert.equal(eventKind({ source: 'google', job_name: 'Holmes Homes - 210 Lakeview' }), 'install');
  assert.equal(eventKind({ source: 'google', job_name: 'Pulte - 12 Oak', scope_notes: 'Warranty: reseal slider' }), 'service');
  assert.equal(eventKind({ source: 'google', job_name: 'SERVICE - Ivory 217' }), 'service');
  assert.equal(eventKind({ source: 'outlook', job_name: 'service' }), 'outlook');
});

test('future visits are never flagged for a missing report', () => {
  const future = { event_date: '2026-10-01', report_status: 'pending' };
  const past = { event_date: '2026-09-20', report_status: 'missing_photos' };
  assert.equal(reportMissing(future, TODAY), false);
  assert.equal(reportMissing(past, TODAY), true);
  assert.equal(reportMissing({ ...past, report_required: false }, TODAY), false);
  assert.equal(needsReportFilter({ event_date: '2026-09-24', report_status: 'rescheduled' }, TODAY), true);
  assert.equal(reportBadge(future, TODAY), null);
});

test('reportBadge wording', () => {
  assert.equal(reportBadge({ event_date: '2026-09-20', report_status: 'ok' }, TODAY).label, 'Reported');
  assert.equal(reportBadge({ event_date: '2026-09-20', report_status: 'missing_photos', days_late: 3 }, TODAY).label, 'Needs photos · 3d late');
  assert.equal(reportBadge({ event_date: '2026-09-25', report_status: 'pending' }, TODAY).label, 'Needs report');
  assert.equal(reportBadge({ event_date: '2026-09-20', report_status: 'pre_compliance' }, TODAY), null);
});

test('filters and counts', () => {
  const events = [
    { id: 1, source: 'app', job_name: 'Install', event_date: '2026-09-20', report_status: 'missing_all' },
    { id: 2, source: 'google', job_name: 'Service call', event_date: '2026-09-21', report_status: 'ok' },
    { id: 3, source: 'outlook', event_date: '2026-09-30', report_status: 'pending' },
  ];
  assert.deepEqual(filterEvents(events, 'install', TODAY).map((e) => e.id), [1]);
  assert.deepEqual(filterEvents(events, 'needs_report', TODAY).map((e) => e.id), [1]);
  assert.deepEqual(kindCounts(events, TODAY), { all: 3, install: 1, service: 1, outlook: 1, needs_report: 1 });
});

test('week math: Sunday start, crosses months', () => {
  assert.deepEqual(weekDays('2026-10-01'), ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(weekDays('2026-09-27')[0], '2026-09-27');
  assert.equal(addDays('2026-09-25', 7), '2026-10-02');
  assert.match(weekLabel(weekDays('2026-10-01')), /^Sep 27 – Oct 3, 2026$/);
});

test('groupByDay sorts days and times, untimed last', () => {
  const g = groupByDay([
    { id: 'b', event_date: '2026-09-26', start_time: '13:00' },
    { id: 'a', event_date: '2026-09-25' },
    { id: 'c', event_date: '2026-09-26', start_time: '08:00' },
  ]);
  assert.deepEqual(g.map((x) => x.day), ['2026-09-25', '2026-09-26']);
  assert.deepEqual(g[1].events.map((e) => e.id), ['c', 'b']);
});
