import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { relativeTime, statusCounts, filterThreads, sortThreads, threadsForJob, draftState, syncSummary, categoryLabel, categoryTone, canViewEmail, matchesStatus, STATUS_CHIPS } = await import('../src/lib/emailInbox.js');

const NOW = Date.parse('2026-09-26T18:00:00Z');
const T = (over) => ({ id: 'x', status: 'new', priority: 'normal', last_message_at: '2026-09-26T17:00:00Z', ...over });

test('relativeTime steps from minutes to hours to days to a short date', () => {
  assert.equal(relativeTime('2026-09-26T17:59:40Z', NOW), 'just now');
  assert.equal(relativeTime('2026-09-26T17:55:00Z', NOW), '5m');
  assert.equal(relativeTime('2026-09-26T15:00:00Z', NOW), '3h');
  assert.equal(relativeTime('2026-09-24T18:00:00Z', NOW), '2d');
  assert.match(relativeTime('2026-09-01T18:00:00Z', NOW), /^Sep \d+$/);
  assert.match(relativeTime('2025-09-01T18:00:00Z', NOW), /2025/);
  assert.equal(relativeTime('', NOW), '');
  assert.equal(relativeTime('not a date', NOW), '');
});

test('statusCounts groups open statuses and every chip has a count', () => {
  const counts = statusCounts([T({ status: 'new' }), T({ status: 'needs_reply' }), T({ status: 'needs_reply' }), T({ status: 'waiting' }), T({ status: 'done' }), T({ status: 'ignored' })]);
  assert.deepEqual(counts, { all: 6, open: 4, new: 1, needs_reply: 2, waiting: 1, done: 1, ignored: 1 });
  for (const chip of STATUS_CHIPS) assert.equal(typeof counts[chip.key], 'number', chip.key);
});

test('matchesStatus: open means not done or ignored; all means everything', () => {
  assert.equal(matchesStatus(T({ status: 'waiting' }), 'open'), true);
  assert.equal(matchesStatus(T({ status: 'done' }), 'open'), false);
  assert.equal(matchesStatus(T({ status: 'ignored' }), 'all'), true);
  assert.equal(matchesStatus(T({ status: 'new' }), 'needs_reply'), false);
});

test('filterThreads narrows by status, category, mailbox, job and free text', () => {
  const rows = [
    T({ id: 'a', mailbox_key: 'gmail', category: 'quote_request', subject: 'Lot 12 windows', from_name: 'Brett', job_id: 'j1' }),
    T({ id: 'b', mailbox_key: 'outlook', category: 'invoice_billing', subject: 'Invoice 4471', from_name: 'Pella', status: 'done', job_id: 'j2' }),
    T({ id: 'c', mailbox_key: 'gmail', category: 'spam', subject: 'You won', status: 'ignored', participants: [{ name: 'Nobody', email: 'x@y.z' }] }),
  ];
  assert.deepEqual(filterThreads(rows).map((t) => t.id), ['a']);
  assert.deepEqual(filterThreads(rows, { status: 'all' }).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(filterThreads(rows, { status: 'all', category: 'invoice_billing' }).map((t) => t.id), ['b']);
  assert.deepEqual(filterThreads(rows, { status: 'all', mailboxKey: 'gmail' }).map((t) => t.id), ['a', 'c']);
  assert.deepEqual(filterThreads(rows, { status: 'all', mailboxKey: 'all' }).length, 3);
  assert.deepEqual(filterThreads(rows, { status: 'all', q: 'pella' }).map((t) => t.id), ['b']);
  assert.deepEqual(filterThreads(rows, { status: 'all', q: 'x@y.z' }).map((t) => t.id), ['c']);
  assert.deepEqual(filterThreads(rows, { status: 'all', jobIds: ['j2'] }).map((t) => t.id), ['b']);
});

test('sortThreads puts urgent first, then newest', () => {
  const rows = [
    T({ id: 'old', last_message_at: '2026-09-20T00:00:00Z' }),
    T({ id: 'urgent-old', priority: 'urgent', last_message_at: '2026-09-10T00:00:00Z' }),
    T({ id: 'new', last_message_at: '2026-09-25T00:00:00Z' }),
    T({ id: 'low', priority: 'low', last_message_at: '2026-09-26T00:00:00Z' }),
  ];
  assert.deepEqual(sortThreads(rows).map((t) => t.id), ['urgent-old', 'new', 'old', 'low']);
});

test('threadsForJob keeps done threads and matches any duplicate record id', () => {
  const rows = [T({ id: 'a', job_id: 'j1', status: 'done' }), T({ id: 'b', job_id: 'dup' }), T({ id: 'c', job_id: 'other' }), T({ id: 'd' })];
  assert.deepEqual(threadsForJob(rows, ['j1', 'dup']).map((t) => t.id).sort(), ['a', 'b']);
  assert.deepEqual(threadsForJob(rows, []), []);
});

test('draftState labels the draft chip and hides it when there is no draft', () => {
  assert.equal(draftState(T({ draft_status: 'none' })), null);
  assert.equal(draftState(T({})), null);
  assert.equal(draftState(T({ draft_status: 'drafted' })).label, 'Draft ready');
  assert.equal(draftState(T({ draft_status: 'sent' })).label, 'Reply sent');
  assert.equal(draftState(T({ draft_status: 'discarded' })).key, 'discarded');
});

test('syncSummary reads a last_run and counts errors either way', () => {
  assert.equal(syncSummary({ fetched: 12, threads_updated: 0, classified: 3, relayed: 0, drafted: 2, archived: 0, errors: ['boom'] }), '12 fetched · 3 classified · 2 drafted · 1 error');
  assert.equal(syncSummary({ fetched: 0, errors: 2 }), '2 errors');
  assert.equal(syncSummary(null), '');
  assert.equal(syncSummary({}), '');
});

test('category labels fall back sensibly and tones map to the fee palettes', () => {
  assert.equal(categoryLabel('order_vendor'), 'Vendor order');
  assert.equal(categoryLabel(''), 'Uncategorized');
  assert.equal(categoryLabel('something_new'), 'something new');
  assert.equal(categoryTone('quote_request'), 'teal');
  assert.equal(categoryTone('service_warranty'), 'amber');
  assert.equal(categoryTone('spam'), 'faint');
  assert.equal(categoryTone('builder_admin'), 'neutral');
});

test('canViewEmail admits admins and managers only', () => {
  assert.equal(canViewEmail({ role: 'admin' }), true);
  assert.equal(canViewEmail({ role: 'manager' }), true);
  assert.equal(canViewEmail({ role: 'user' }), false);
  assert.equal(canViewEmail(null), false);
});
