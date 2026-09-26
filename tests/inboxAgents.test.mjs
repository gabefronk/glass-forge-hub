import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { relativeTime, chipCounts, filterEntries, sortEntries, draftState, syncSummary, categoryLabel, categoryTone, canViewInboxAgents, matchesChip, needsJobPick, STATUS_CHIPS } = await import('../src/lib/inboxAgents.js');

const NOW = Date.parse('2026-09-26T18:00:00Z');
const E = (over) => ({ id: 'x', status: 'new', priority: 'normal', last_message_at: '2026-09-26T17:00:00Z', hub_changes: [], ...over });

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

test('chips: open / needs reply / changed the Hub / which job? / all, each with a count', () => {
  const rows = [
    E({ id: 'a', status: 'needs_reply', hub_changes: ['Note added to X'] }),
    E({ id: 'b', status: 'waiting', job_match_confidence: 'low', job_candidates: [{ job_id: 'j1' }] }),
    E({ id: 'c', status: 'done', job_id: 'j2', hub_changes: ['To-do created'] }),
    E({ id: 'd', status: 'ignored' }),
  ];
  const counts = chipCounts(rows);
  assert.deepEqual(counts, { all: 4, open: 2, needs_reply: 1, changed: 2, unmatched: 1 });
  for (const chip of STATUS_CHIPS) assert.equal(typeof counts[chip.key], 'number', chip.key);
  assert.equal(matchesChip(rows[1], 'unmatched'), true);
  assert.equal(needsJobPick(E({ job_id: 'j1', job_candidates: [{ job_id: 'x' }] })), false, 'linked rows never ask');
  assert.equal(needsJobPick(E({ job_match_confidence: 'unmatched', job_candidates: [] })), false, 'nothing to pick from');
  assert.equal(matchesChip(rows[3], 'all'), true);
  assert.equal(matchesChip(rows[2], 'open'), false);
});

test('filterEntries narrows by chip, category, mailbox and free text (including PO numbers and hub changes)', () => {
  const rows = [
    E({ id: 'a', mailbox_key: 'gf-gmail', category: 'order_vendor', subject: 'Lot 12 windows', from_name: 'Brett', extracted: { po_numbers: ['YA-0005'] } }),
    E({ id: 'b', mailbox_key: 'ya-outlook', category: 'invoice_billing', subject: 'Invoice 4471', from_name: 'Pella', status: 'done', hub_changes: ['Note added to Hutchins'] }),
    E({ id: 'c', mailbox_key: 'gf-gmail', category: 'spam', subject: 'You won', status: 'ignored' }),
  ];
  assert.deepEqual(filterEntries(rows).map((t) => t.id), ['a']);
  assert.deepEqual(filterEntries(rows, { chip: 'all' }).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(filterEntries(rows, { chip: 'all', category: 'invoice_billing' }).map((t) => t.id), ['b']);
  assert.deepEqual(filterEntries(rows, { chip: 'all', mailboxKey: 'gf-gmail' }).map((t) => t.id), ['a', 'c']);
  assert.equal(filterEntries(rows, { chip: 'all', mailboxKey: 'all' }).length, 3);
  assert.deepEqual(filterEntries(rows, { chip: 'all', q: 'pella' }).map((t) => t.id), ['b']);
  assert.deepEqual(filterEntries(rows, { chip: 'all', q: 'ya-0005' }).map((t) => t.id), ['a']);
  assert.deepEqual(filterEntries(rows, { chip: 'all', q: 'hutchins' }).map((t) => t.id), ['b']);
});

test('sortEntries puts urgent first, then newest', () => {
  const rows = [
    E({ id: 'old', last_message_at: '2026-09-20T00:00:00Z' }),
    E({ id: 'urgent-old', priority: 'urgent', last_message_at: '2026-09-10T00:00:00Z' }),
    E({ id: 'new', last_message_at: '2026-09-25T00:00:00Z' }),
    E({ id: 'low', priority: 'low', last_message_at: '2026-09-26T00:00:00Z' }),
  ];
  assert.deepEqual(sortEntries(rows).map((t) => t.id), ['urgent-old', 'new', 'old', 'low']);
});

test('draftState names the mailbox the draft lives in and hides when there is none', () => {
  assert.equal(draftState(E({ draft_status: 'none' }), 'gmail'), null);
  assert.equal(draftState(E({}), 'gmail'), null);
  assert.equal(draftState(E({ draft_status: 'drafted' }), 'gmail').label, 'Draft waiting in Gmail');
  assert.equal(draftState(E({ draft_status: 'drafted' }), 'outlook').label, 'Draft waiting in Outlook');
  assert.equal(draftState(E({ draft_status: 'discarded' }), 'gmail').key, 'discarded');
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

test('the ledger page is admin-only', () => {
  assert.equal(canViewInboxAgents({ role: 'admin' }), true);
  assert.equal(canViewInboxAgents({ role: 'manager' }), false);
  assert.equal(canViewInboxAgents(null), false);
});
