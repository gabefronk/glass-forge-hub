import test from 'node:test';
import assert from 'node:assert/strict';
import { purchasingJobName, statusDate, statusWithDate, originalOrderDate, displayDate, purchasingRows, purchasingCalendarEvents } from '../src/lib/purchasingDates.js';
import { eventKind, needsReportFilter, filterEvents, kindCounts } from '../src/lib/calendarModel.js';

const po = { id: 'p', job_id: 'j', vendor: 'AMSCO', po_number: 'YA-0005', status: 'confirmed', status_history: [{ status: 'confirmed', at: '2026-10-04T05:16:02.553080Z', source: { original_order_date: '2026-09-25' } }] };
const supplier = { id: 's', job_id: 'j', purchase_order_id: 'p', vendor: 'AMSCO', po_name: 'YA-0005', eta_date: '2026-10-06', status: 'eta_set' };
const data = { jobs: [{ id: 'j', canonical_name: 'AV24' }], purchase_orders: [po], vendor_orders: [supplier] };

test('headings follow the linked job, never the saved PO name or title', () => {
  assert.equal(purchasingJobName({ ...po, job_name: 'Stale', title: 'Guessed' }, data.jobs), 'AV24');
  assert.equal(purchasingJobName({}, data.jobs), 'No job linked');
  assert.equal(purchasingJobName(po, []), 'Linked job unavailable');
  assert.equal(purchasingJobName(po, [{ id: 'j' }]), 'Unnamed linked job');
  assert.equal(purchasingJobName(po, [{ id: 'j', canonical_name: ' ', display_name: 'Display' }]), 'Display');
});
test('Denver recorded date is distinct from documented original order date', () => {
  assert.deepEqual(statusDate(po), { date: '2026-10-03', basis: 'recorded' });
  assert.equal(statusWithDate(po), 'Confirmed · recorded Oct 3, 2026');
  assert.equal(originalOrderDate(po), '2026-09-25');
  assert.equal(displayDate(supplier.eta_date), 'Oct 6, 2026');
});
test('missing or mismatched history never falls back to creation, update or today', () => {
  for (const status_history of [undefined, [], [{ status: 'ordered', at: '2026-01-01T00:00:00Z' }], [{ status: 'confirmed', at: '2026-10-04' }], [{ status: 'confirmed', at: 'bad' }]]) {
    assert.equal(statusDate({ status: 'confirmed', status_history, created_date: '2026-10-04T10:00:00Z', updated_date: '2026-10-04T10:00:00Z' }).date, '');
  }
  assert.equal(displayDate('2026-02-30'), '');
  assert.equal(purchasingCalendarEvents({ purchase_orders: [{ id: 'old', status: 'ordered' }] }).length, 0);
});
test('current transition wins when a status repeats; input history is not mutated', () => {
  const row = { status: 'ordered', status_history: [{ status: 'ordered', at: '2026-09-01T12:00:00Z' }, { status: 'confirmed', at: '2026-09-02T12:00:00Z' }, { status: 'ordered', at: '2026-10-04T12:00:00Z' }] };
  const before = structuredClone(row);
  assert.equal(statusDate(row).date, '2026-10-04');
  assert.deepEqual(row, before);
});
test('one ETA per supplier, stable identity when ETA changes, no source writes', () => {
  const before = structuredClone(data);
  const events = purchasingCalendarEvents(data);
  assert.equal(events.filter(e => e.purchasing_label === 'ETA').length, 1);
  const eta = events.find(e => e.purchasing_label === 'ETA');
  assert.equal(eta.job_id, 'j');
  assert.equal(eta.event_date, '2026-10-06');
  assert.equal(eta.google_event_id, undefined);
  assert.equal(eventKind(eta), 'purchasing');
  assert.equal(needsReportFilter(eta, '2026-10-10'), false);
  assert.equal(filterEvents(events, 'install').length, 0);
  assert.equal(kindCounts(events).purchasing, events.length);
  const changed = purchasingCalendarEvents({ ...data, vendor_orders: [{ ...supplier, eta_date: '2026-10-09' }] }).find(e => e.purchasing_label === 'ETA');
  assert.equal(changed.id, eta.id);
  assert.equal(changed.event_date, '2026-10-09');
  assert.deepEqual(data, before);
});
test('conflicting jobs and ambiguous supplier matches cannot borrow an ETA', () => {
  const conflict = { ...data, vendor_orders: [{ ...supplier, job_id: 'other', purchase_order_id: '' }] };
  assert.equal(purchasingRows(conflict).find(r => r.po)?.supplier, null);
  assert.equal(purchasingCalendarEvents(conflict).find(e => e.purchasing_label === 'ETA').job_id, 'other');
  const ambiguous = { ...data, vendor_orders: [supplier, { ...supplier, id: 's2' }] };
  assert.equal(purchasingRows(ambiguous).find(r => r.po)?.supplier, null);
});
test('received and explicitly cancelled orders have no pending ETA entry', () => {
  const received = purchasingCalendarEvents({ ...data, vendor_orders: [{ ...supplier, received_date: '2026-10-05' }] });
  assert.equal(received.some(e => e.purchasing_label === 'ETA'), false);
  assert.equal(received.find(e => e.purchasing_label === 'Received').event_date, '2026-10-05');
  assert.equal(purchasingCalendarEvents({ ...data, purchase_orders: [{ ...po, status: 'cancelled' }] }).some(e => e.purchasing_label === 'ETA'), false);
});
