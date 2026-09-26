import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchQueueHandler } from '../base44/shared/researchQueueHandler.mjs';
import { runQuickSearch, moveVisitThroughHub, datesFromQuery, jobWords } from '../base44/shared/researchQuickSearch.js';
import { initialState, QUEUE_NAME } from '../base44/shared/researchQueueCore.mjs';

const jobs = [
  { id: 'j1', canonical_name: 'holmes homes - 412 oquirrh west', aliases: [], builder: 'Holmes Homes', po_numbers: ['7104345'], oe_numbers: [] },
  { id: 'j2', canonical_name: 'holmes homes - 422 oquirrh west', aliases: [], builder: 'Holmes Homes', address: '7597 S Clipper Hill Rd West Jordan', po_numbers: [], oe_numbers: [] },
  { id: 'j3', canonical_name: 'gomez residence', aliases: [], po_numbers: [], oe_numbers: [] },
];
const events = [
  { id: 'e1', job_id: 'j1', job_name: 'Holmes Homes - 412 Oquirrh West', address: '7577 S Oak Hallow Rd West Jordan, UT 84081', event_date: '2026-09-29', start_time: '08:00', google_event_id: 'g1', labor_amt: 900, scope_notes: 'Labor $900' },
  { id: 'e2', job_id: 'j3', job_name: 'Gomez Residence', address: '12 Main St Lehi', event_date: '2026-09-27', start_time: '09:00', google_event_id: 'g2', labor_amt: 450, fee_amount: 77 },
  { id: 'e3', job_name: 'Wartman - Beers', address: '199 E Elm St, Murray', event_date: '2026-09-27', start_time: '13:00', google_event_id: 'g3', labor_amt: 300 },
];
const NOW = '2026-09-26T18:00:00.000Z'; // Saturday in Denver
const MONEY = /labor|fee_amount|scope_notes|\b900\b|\b450\b|\$/i;

function fakeClient({ user = null, invoke = null, state = initialState() } = {}) {
  const writes = [];
  const client = {
    auth: { me: async () => { if (!user) throw new Error('unauthenticated'); return user; } },
    functions: { invoke: invoke || (async () => { throw new Error('not expected'); }) },
    asServiceRole: { entities: {
      ResearchWorkerDevice: { filter: async () => [] },
      ResearchQueueState: {
        filter: async () => [{ id: 'q1', name: QUEUE_NAME, state, state_version: 1 }],
        updateMany: async (...a) => { writes.push(a); return { updated: 1 }; },
      },
    } },
  };
  return { client, writes };
}
function handler(client, extra = {}) {
  return createResearchQueueHandler({
    getClient: async () => client,
    makePacket: async () => { throw new Error('makePacket not expected'); },
    quickSearch: async ({ input, now }) => runQuickSearch({ input, jobs, events, now }),
    moveVisit: ({ client: c, input }) => moveVisitThroughHub({ client: c, input }),
    now: () => NOW,
    ...extra,
  });
}
const post = (body, headers = {}) => new Request('https://hub.test/research-queue', { method: 'POST', headers, body: JSON.stringify(body) });

const OWNER = { email: 'gabefronk@gmail.com', role: 'admin' };
const CREW = { email: 'crew@example.com', role: 'user' };
const MANAGER = { email: 'lead@example.com', role: 'manager' };

test('quick_search: unsigned caller gets 401', async () => {
  const { client } = fakeClient();
  const res = await handler(client)(post({ action: 'quick_search', query: '412 oquirrh west' }));
  assert.equal(res.status, 401);
});

test('quick_search: signed-in crew user gets address + next visit inline, no money', async () => {
  const { client, writes } = fakeClient({ user: CREW });
  const res = await handler(client)(post({ action: 'quick_search', query: "what's the jobsite address for 412 Oquirrh West" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.jobs[0].job_id, 'j1');
  assert.equal(body.jobs[0].address, '7577 S Oak Hallow Rd West Jordan, UT 84081');
  assert.equal(body.jobs[0].next_visits[0].event_id, 'e1');
  assert.match(body.answer, /7577 S Oak Hallow/);
  assert.ok(!MONEY.test(JSON.stringify(body)), 'no money fields');
  assert.equal(writes.length, 0, 'fast path never writes queue state');
});

test('quick_search: schedule question returns the day\'s visits', async () => {
  const { client } = fakeClient({ user: CREW });
  const body = await (await handler(client)(post({ action: 'quick_search', query: "what's on tomorrow" }))).json();
  assert.equal(body.interpreted.date, '2026-09-27');
  assert.deepEqual(body.events.events.map((e) => e.event_id), ['e2', 'e3']);
  assert.equal(body.jobs.length, 0);
  assert.ok(!MONEY.test(JSON.stringify(body)));
});

test('quick_search: explicit date range and missing query validation', async () => {
  const { client } = fakeClient({ user: CREW });
  const ranged = await (await handler(client)(post({ action: 'quick_search', from: '2026-09-27', to: '2026-09-30' }))).json();
  assert.equal(ranged.events.count, 3);
  const res = await handler(client)(post({ action: 'quick_search', query: 'the' }));
  assert.equal(res.status, 400);
});

test('owner-only queue actions stay owner-only for non-owners', async () => {
  const { client } = fakeClient({ user: CREW });
  const res = await handler(client)(post({ action: 'status' }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'Owner access required.');
  const anon = await handler(fakeClient().client)(post({ action: 'enqueue' }));
  assert.equal(anon.status, 403);
});

test('owner status still works and owner can quick_search', async () => {
  const { client } = fakeClient({ user: OWNER });
  const status = await (await handler(client)(post({ action: 'status' }))).json();
  assert.equal(status.ok, true);
  assert.equal(status.paused, true);
  const qs = await handler(client)(post({ action: 'quick_search', query: 'gomez' }));
  assert.equal(qs.status, 200);
});

test('worker key cannot use fast actions', async () => {
  const { client } = fakeClient();
  const res = await handler(client)(post({ action: 'quick_search', query: 'gomez' }, { 'x-glass-forge-research-key': 'short' }));
  assert.equal(res.status, 401);
});

test('move_visit: user role gets 403 and moveCalendarEvent is not called', async () => {
  let called = false;
  const { client } = fakeClient({ user: CREW, invoke: async () => { called = true; return { data: {} }; } });
  const res = await handler(client)(post({ action: 'move_visit', event_id: 'e2', new_date: '2026-10-01' }));
  assert.equal(res.status, 403);
  assert.equal(called, false);
});

test('move_visit: unsigned gets 401', async () => {
  const res = await handler(fakeClient().client)(post({ action: 'move_visit', event_id: 'e2', new_date: '2026-10-01' }));
  assert.equal(res.status, 401);
});

test('move_visit: manager moves through moveCalendarEvent and gets a money-free visit back', async () => {
  const calls = [];
  const invoke = async (name, payload) => { calls.push([name, payload]); return { data: { ok: true, record: { ...events[1], event_date: '2026-10-01', start_time: '09:00' }, installer_warning: null } }; };
  const { client } = fakeClient({ user: MANAGER, invoke });
  const res = await handler(client)(post({ action: 'move_visit', event_id: 'e2', new_date: '2026-10-01', new_start_time: '09:00' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(calls, [['moveCalendarEvent', { id: 'e2', new_date: '2026-10-01', new_start_time: '09:00' }]]);
  assert.equal(body.visit.date, '2026-10-01');
  assert.ok(!MONEY.test(JSON.stringify(body)));
});

test('move_visit: calendar refusals map to HTTP status; bad input is 400', async () => {
  const { client } = fakeClient({ user: MANAGER, invoke: async () => ({ data: { error: 'no_google_event', detail: 'synthetic row' } }) });
  const res = await handler(client)(post({ action: 'move_visit', event_id: 'e9', new_date: '2026-10-01' }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'no_google_event');
  const badDate = await handler(client)(post({ action: 'move_visit', event_id: 'e9', new_date: 'thursday' }));
  assert.equal(badDate.status, 400);
});

test('enqueue response carries a quick_answer for the resolved job', async () => {
  const { client, writes } = fakeClient({ user: OWNER });
  const packet = { protocol_version: 'x', plan_key: 'k1', identity: { job_id: 'j3', canonical_name: 'gomez residence' }, capabilities: { supplied_sources_only: true } };
  const res = await handler(client, { makePacket: async () => packet, uuid: () => 't1' })(post({ action: 'enqueue', query: { job_id: 'j3' }, research: { purpose: 'installation_schedule' } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.task.status, 'queued');
  assert.equal(writes.length, 1);
  assert.equal(body.quick_answer.jobs[0].job_id, 'j3');
  assert.equal(body.quick_answer.jobs[0].next_visits[0].event_id, 'e2');
});

test('research-queue entry bundle is current with the shared modules', async () => {
  const { buildResearchQueueEntry } = await import('../scripts/build-research-queue-entry.mjs');
  const fs = await import('node:fs');
  const onDisk = fs.readFileSync(new URL('../base44/functions/research-queue/entry.ts', import.meta.url), 'utf8');
  assert.equal(onDisk, await buildResearchQueueEntry(), 'run node scripts/build-research-queue-entry.mjs');
  assert.ok(!/from\s+["']\.{1,2}\//.test(onDisk), 'bundle is self-contained');
});

test('date words resolve in Denver time', () => {
  assert.deepEqual(datesFromQuery('whats on thursday', '2026-09-26'), { date: '2026-10-01' });
  assert.deepEqual(datesFromQuery('next week', '2026-09-26'), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(datesFromQuery('this week', '2026-09-26'), { from: '2026-09-26', to: '2026-10-02' });
  assert.equal(jobWords('Move the Gomez visit to Thursday'), 'gomez');
});
