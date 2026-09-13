import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCalendarCoverage, sourceFreshness, isCalendarDate, denverCalendarDate } from '../shared/calendarCoverage.mjs';
const now = '2026-09-13T08:00:00Z';
const baseline = () => ({ id: 's1', calendar_name: 'UT Window Install', timezone: 'America/Denver', range_start: '2026-09-13', range_end: '2026-09-15', captured_at: '2026-09-13T07:00:00Z', complete: true, events: [], event_count: 0 });
const assess = (snapshots, extra = {}) => assessCalendarCoverage({ calendarName: 'UT Window Install', snapshots, rangeStart: '2026-09-13', rangeEnd: '2026-09-15', now, ...extra });

test('real dates reject rolled dates and accept leap day', () => {
  assert.equal(isCalendarDate('2026-02-30'), false); assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
});
test('Denver date is local around UTC midnight and DST changes', () => {
  assert.equal(denverCalendarDate('2026-09-13T01:00:00Z'), '2026-09-12');
  assert.equal(denverCalendarDate('2026-01-13T06:30:00Z'), '2026-01-12');
});
test('freshness requires actual observation rather than entity update date', () => {
  assert.equal(sourceFreshness({ updated_date: now, now }).status, 'missing');
  assert.equal(sourceFreshness({ observedAt: '2026-09-08T22:01:00Z', now }).status, 'stale');
  assert.equal(sourceFreshness({ observedAt: '2026-09-14T00:00:00Z', now }).status, 'invalid');
});
test('complete empty snapshot proves capture coverage, never live verification', () => {
  const result = assess([baseline()]);
  assert.equal(result.fresh_complete, true); assert.equal(result.covered_day_count, 3);
  assert.equal(result.upstream_live_verified, false);
});
test('old complete snapshot has coverage but is stale', () => {
  const result = assess([{ ...baseline(), captured_at: '2026-09-08T22:01:00Z' }]);
  assert.equal(result.coverage_complete, true); assert.equal(result.fresh_complete, false);
  assert.equal(result.stale_dates.length, 3);
});
test('new partial capture cannot silently borrow old complete state', () => {
  const result = assess([baseline(), { ...baseline(), id: 's2', captured_at: '2026-09-13T07:30:00Z', complete: false }]);
  assert.equal(result.fresh_complete, false); assert.equal(result.incomplete_dates.length, 3);
});
test('coverage includes missing dates instead of claiming entire range', () => {
  assert.deepEqual(assess([{ ...baseline(), range_end: '2026-09-14' }]).missing_dates, ['2026-09-15']);
});
test('wrong calendar cannot satisfy requested source', () => {
  assert.equal(assess([{ ...baseline(), calendar_name: 'Service Calendar' }]).covered_day_count, 0);
});
test('mismatched count or out-of-range events invalidate snapshot', () => {
  assert.equal(assess([{ ...baseline(), event_count: 1 }]).fresh_complete, false);
  assert.equal(assess([{ ...baseline(), events: [{ event_date: '2026-09-20' }], event_count: 1 }]).fresh_complete, false);
});
test('batch proves completed capture from valid referenced partial chunks', () => {
  const chunk = { ...baseline(), complete: false };
  const batch = { ...baseline(), id: 'b1', snapshot_ids: ['s1'], captured_at: '2026-09-13T07:30:00Z' };
  delete batch.events;
  assert.equal(assess([chunk], { batches: [batch] }).fresh_complete, true);
});
test('missing or duplicate batch chunks never prove completeness', () => {
  const batch = { ...baseline(), id: 'b1', snapshot_ids: ['missing'] }; delete batch.events;
  assert.equal(assess([], { batches: [batch] }).fresh_complete, false);
  assert.ok(assess([], { batches: [batch] }).reasons.includes('invalid_or_missing_batch_chunks'));
  assert.equal(assess([{ ...baseline(), complete: false }], { batches: [{ ...batch, snapshot_ids: ['s1', 's1'] }] }).fresh_complete, false);
});
test('stale chunks cannot be freshened by a new batch timestamp', () => {
  const chunk = { ...baseline(), complete: false, captured_at: '2026-09-08T22:01:00Z' };
  const batch = { ...baseline(), id: 'b1', snapshot_ids: ['s1'] }; delete batch.events;
  assert.equal(assess([chunk], { batches: [batch] }).fresh_complete, false);
});
test('batch recency cannot hide a chunk just outside freshness threshold', () => {
  const chunk = { ...baseline(), complete: false, captured_at: '2026-09-11T19:30:00Z' };
  const batch = { ...baseline(), id: 'b1', snapshot_ids: ['s1'], captured_at: '2026-09-13T07:00:00Z' }; delete batch.events;
  const result = assess([chunk], { batches: [batch] });
  assert.equal(result.coverage_complete, true); assert.equal(result.fresh_complete, false);
});
test('input remains unchanged', () => {
  const snapshots = [baseline()]; const before = JSON.stringify(snapshots); assess(snapshots);
  assert.equal(JSON.stringify(snapshots), before);
});
