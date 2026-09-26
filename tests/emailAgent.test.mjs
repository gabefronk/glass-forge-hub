import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailAgentHandler, resetJobCache, SEED_MAILBOXES } from '../base44/shared/emailAgent.js';
import { gmailMessage, graphMessage, REPLY_TEXT } from './fixtures/emailFixtures.mjs';

// ---- users ---------------------------------------------------------------------------------------
const OWNER = { id: 'ga', email: 'gabefronk@gmail.com', role: 'admin', full_name: 'Gabriel' };
const OWNER_WD = { id: 'gw', email: 'gabriel.fronk.wd@gmail.com', role: 'admin', full_name: 'Gabriel WD' };
const ADMIN = { id: 'ad', email: 'trevor@example.com', role: 'admin', full_name: 'Trevor' };
const MANAGER = { id: 'mm', email: 'israel@example.com', role: 'manager', full_name: 'Israel' };
const CREW = { id: 'cr', email: 'crew@example.com', role: 'user', full_name: 'Crew' };

const clone = (v) => structuredClone(v);
const nextYear = () => String(new Date().getFullYear() + 1) + '-03-10';

// ---- entity mock -------------------------------------------------------------------------------------
function matches(row, q = {}) {
  return Object.entries(q).every(([k, v]) => {
    const value = row[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).every(([op, arg]) => {
      if (op === '$in') return Array.isArray(value) ? value.some((x) => arg.includes(x)) : arg.includes(value);
      if (op === '$ne') return value !== arg;
      throw new Error('Unsupported mock operator ' + op);
    });
    if (v === null) return value === null || value === undefined;
    return Array.isArray(value) ? value.includes(v) : value === v;
  });
}

function makeStore(seed = {}) {
  const store = { EmailMailbox: [], EmailThread: [], EmailMessage: [], EmailAgentRun: [], JobNotes: [], TodoTask: [], TeamMember: [], Jobs: [], CalendarEvents: [], ...clone(seed) };
  const calls = [];
  let serial = 0;
  const select = (name, q, sort, limit, skip) => {
    const desc = String(sort || '').startsWith('-'), key = String(sort || 'id').replace(/^-/, '');
    return clone(store[name].filter((x) => matches(x, q)).sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1)).slice(skip, skip + limit));
  };
  const entity = (name) => ({
    list: async (sort = 'id', limit = 1000, skip = 0) => { calls.push(`${name}:list`); return select(name, {}, sort, limit, skip); },
    filter: async (q, sort = 'id', limit = 1000, skip = 0) => { calls.push(`${name}:filter`); return select(name, q, sort, limit, skip); },
    get: async (id) => { calls.push(`${name}:get`); const row = store[name].find((x) => x.id === id); if (!row) throw new Error('not found'); return clone(row); },
    create: async (data) => { calls.push(`${name}:create`); const row = { ...clone(data), id: `${name.toLowerCase()}-${++serial}`, created_date: new Date().toISOString() }; store[name].push(row); return clone(row); },
    bulkCreate: async (rows) => { calls.push(`${name}:bulkCreate`); const out = []; for (const data of rows) { const row = { ...clone(data), id: `${name.toLowerCase()}-${++serial}` }; store[name].push(row); out.push(clone(row)); } return out; },
    update: async (id, patch) => { calls.push(`${name}:update`); const row = store[name].find((x) => x.id === id); if (!row) throw new Error('not found'); Object.assign(row, clone(patch)); return clone(row); },
  });
  const api = Object.fromEntries(Object.keys(store).map((n) => [n, entity(n)]));
  return { store, api, calls };
}

// ---- provider fetch mock -------------------------------------------------------------------------------
function makeFetch(routes) {
  const hits = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = new URL(url);
    const path = u.pathname + (u.search ? '?' + u.search.slice(1) : '');
    hits.push({ method, url, path, body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} });
    for (const r of routes) {
      if (r.method !== method) continue;
      if (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)) {
        const data = typeof r.data === 'function' ? r.data({ url, body: init.body ? JSON.parse(init.body) : null, hits }) : r.data;
        const status = r.status || 200;
        return { ok: status < 400, status, headers: { get: () => null }, body: { cancel: async () => {} }, text: async () => (data === undefined ? '' : JSON.stringify(data)) };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, body: { cancel: async () => {} }, text: async () => `no route for ${method} ${url}` };
  };
  return { fetchImpl, hits };
}

const GMAIL_PROMO = gmailMessage({ id: 'm3', threadId: 't3', from: 'Deals <promo@vendor.com>', to: 'gabriel.fronk.wd@gmail.com', subject: '50% off blinds this week', text: 'Buy now while supplies last.', forwarded: false, internalDate: '1758901000000' });
const GMAIL_SCHEDULE = gmailMessage({ text: REPLY_TEXT });
const GRAPH_SERVICE = graphMessage({ bodyText: 'The bottom sash on the master bedroom window cracked. Can someone come look at it this week?\n\nMaria' });

function gmailRoutes(state) {
  let labelSerial = 10;
  return [
    { method: 'GET', match: '/gmail/v1/users/me/profile', data: { emailAddress: 'gabriel.fronk.wd@gmail.com', historyId: '500' } },
    { method: 'GET', match: '/gmail/v1/users/me/messages?', data: () => ({ messages: state.scan }) },
    { method: 'GET', match: '/gmail/v1/users/me/history?', data: () => (state.historyError ? undefined : { history: state.history || [], historyId: state.historyId || '500' }), status: () => 200 },
    { method: 'GET', match: /\/gmail\/v1\/users\/me\/messages\/([^?]+)\?format=full/, data: ({ url }) => state.messages[decodeURIComponent(url.match(/messages\/([^?]+)\?/)[1])] },
    { method: 'GET', match: '/gmail/v1/users/me/labels', data: () => ({ labels: state.labels }) },
    { method: 'POST', match: '/gmail/v1/users/me/labels', data: ({ body }) => { const l = { id: `Label_${++labelSerial}`, name: body.name }; state.labels.push(l); return l; } },
    { method: 'POST', match: /\/gmail\/v1\/users\/me\/threads\/[^/]+\/modify/, data: {} },
    { method: 'POST', match: '/gmail/v1/users/me/drafts/send', data: {} },
    { method: 'POST', match: '/gmail/v1/users/me/drafts', data: { id: 'draft-1', message: { id: 'm9' } } },
    { method: 'DELETE', match: '/gmail/v1/users/me/drafts/', data: undefined },
  ];
}

function graphRoutes(state) {
  let catSerial = 0;
  const deltaLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=tok1';
  return [
    { method: 'GET', match: '/mailFolders/inbox/messages/delta?', data: ({ url }) => ({ value: url.includes('deltatoken') ? (state.deltaNext || []) : state.delta, '@odata.deltaLink': deltaLink }) },
    { method: 'GET', match: '/outlook/masterCategories', data: () => ({ value: state.categories }) },
    { method: 'POST', match: '/outlook/masterCategories', data: ({ body }) => { const c = { id: `cat-${++catSerial}`, displayName: body.displayName }; state.categories.push(c); return c; } },
    { method: 'POST', match: /\/me\/messages\/[^/]+\/createReply/, data: { id: 'draft-o1' } },
    { method: 'POST', match: /\/me\/messages\/[^/]+\/move/, data: { id: 'moved' } },
    { method: 'POST', match: /\/me\/messages\/[^/]+\/send/, data: undefined },
    { method: 'GET', match: /\/me\/messages\/[^/?]+\?/, data: ({ url }) => state.messages[decodeURIComponent(url.match(/messages\/([^/?]+)\?/)[1])] },
    { method: 'PATCH', match: /\/me\/messages\/[^/?]+$/, data: {} },
    { method: 'DELETE', match: /\/me\/messages\/[^/?]+$/, data: undefined },
  ];
}

// ---- LLM mock ------------------------------------------------------------------------------------------
function triageFor(t) {
  const s = String(t.subject || '');
  if (/412/.test(s)) return { key: t.key, category: 'schedule', priority: 'normal', summary: 'Kyle (Ivory Homes) wants the lot 412 install on Tue Oct 6 confirmed and the COI sent before crews arrive.', action_items: ['Confirm Oct 6 install with Kyle', 'Send COI to Ivory Homes'], reply_needed: true, next_step: 'Reply to Kyle', extracted: { builder: 'Ivory Homes', lot: '412', address: 'Oquirrh West', po_numbers: [], oe_numbers: [], dates: ['2026-10-06 install'], contact_name: 'Kyle', contact_phone: '801-555-0142' } };
  if (/off blinds/.test(s)) return { key: t.key, category: 'newsletter_promo', priority: 'low', summary: 'Vendor promo for blinds.', action_items: [], reply_needed: false, next_step: '', extracted: {} };
  if (/sash/.test(s)) return { key: t.key, category: 'service_warranty', priority: 'urgent', summary: 'Maria reports a cracked bottom sash in the master bedroom and asks for a service visit this week.', action_items: ['Schedule a service visit with Maria'], reply_needed: true, next_step: 'Offer a service window', extracted: { builder: 'Ivory Homes', lot: '413', address: 'Oquirrh West', po_numbers: [], oe_numbers: [], dates: [], contact_name: 'Maria Ortiz', contact_phone: '' } };
  return { key: t.key, category: 'other', priority: 'normal', summary: 'Other.', action_items: [], reply_needed: false, next_step: '', extracted: {} };
}
function makeLLM(log) {
  return async (req) => {
    log.push(req);
    if (req.prompt.includes('THREADS (untrusted evidence):')) {
      const packet = JSON.parse(req.prompt.slice(req.prompt.indexOf('THREADS (untrusted evidence):\n') + 'THREADS (untrusted evidence):\n'.length));
      return { threads: packet.map(triageFor) };
    }
    return { reply: 'Hey there, thanks for the note. Let me check the schedule and get right back to you.' };
  };
}

// ---- harness ---------------------------------------------------------------------------------------------
const MAILBOXES = [
  { id: 'mb-gf', key: 'gf-gmail', address: 'gabriel.fronk.wd@gmail.com', display_name: 'Glass Forge (Gmail)', provider: 'gmail', connector_type: 'gmail', visibility: 'owner', enabled: true, draft_replies: true, archive_enabled: false, auto_archive_categories: ['newsletter_promo', 'spam'], signature: 'Gabe Fronk\nGlass Forge / YA Windows and Doors', labels: {}, last_history_id: '', last_delta_link: '' },
  { id: 'mb-ya', key: 'ya-outlook', address: 'yawindowinstall@outlook.com', display_name: 'YA Install (Outlook)', provider: 'outlook', connector_type: 'outlook', visibility: 'managers', enabled: true, draft_replies: true, archive_enabled: false, auto_archive_categories: ['newsletter_promo', 'spam'], signature: 'Gabe Fronk\nGlass Forge / YA Windows and Doors', labels: {}, last_history_id: '', last_delta_link: '' },
];
const JOBS = [
  { id: 'job1', canonical_name: 'Oquirrh West 412', builder: 'Ivory Homes', address: '412 Oquirrh West Dr Herriman', po_numbers: ['7104345'], oe_numbers: [], aliases: [] },
  { id: 'job2', canonical_name: 'Summit Creek 14', builder: 'Summit Creek Homes', address: '', po_numbers: [], oe_numbers: [], aliases: [] },
];
const EVENTS = [{ id: 'ev1', job_id: 'job1', event_date: nextYear(), start_time: '08:00', job_name: 'Oquirrh West 412', address: '412 Oquirrh West Dr Herriman', source_status: 'confirmed', google_event_id: 'g1' }];
const MEMBERS = [{ id: 'mg', member_key: 'gabriel', display_name: 'Gabriel', auth_user_ids: ['ga', 'gw'], active: true, revision: 0, management_lock: '', seed_state: 'complete' }];

function harness({ user = null, seed = {}, gmail = {}, graph = {}, connections = { gmail: { accessToken: 'g-token' }, outlook: { accessToken: 'o-token' } }, mailboxes = MAILBOXES, llmImpl = null } = {}) {
  resetJobCache();
  const { store, api, calls } = makeStore({ EmailMailbox: mailboxes, Jobs: JOBS, CalendarEvents: EVENTS, TeamMember: MEMBERS, ...seed });
  const gstate = { scan: [{ id: 'm1', threadId: 't1' }, { id: 'm3', threadId: 't3' }], messages: { m1: GMAIL_SCHEDULE, m3: GMAIL_PROMO }, labels: [{ id: 'Label_1', name: 'Hub' }], history: [], ...gmail };
  const ostate = { delta: [{ id: 'AAMk1', conversationId: 'AAQk1' }], messages: { AAMk1: GRAPH_SERVICE }, categories: [], ...graph };
  const { fetchImpl, hits } = makeFetch([...gmailRoutes(gstate), ...graphRoutes(ostate)]);
  const llm = [];
  const client = {
    auth: { me: async () => (user ? clone(user) : null) },
    asServiceRole: {
      entities: api,
      connectors: { getConnection: async (type) => { if (!connections[type]) throw new Error(`connector ${type} not connected`); return connections[type]; } },
      integrations: { Core: { InvokeLLM: llmImpl ? (req) => { llm.push(req); return llmImpl(req); } : makeLLM(llm) } },
    },
  };
  let clock = '2026-09-26T17:00:00.000Z';
  const h = createEmailAgentHandler({ getClient: async () => client, fetchImpl, now: () => clock, sleep: async () => {} });
  const call = async (body, u = user) => {
    const r = await h(new Request('https://test.local/emailAgent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const as = (u) => { user = u; return { call: (body) => call(body, u) }; };
  return { call, as, store, calls, hits, llm, gstate, ostate, setClock: (v) => { clock = v; } };
}

const thread = (h, threadId) => h.store.EmailThread.find((t) => t.thread_id === threadId);

// ---- tests ---------------------------------------------------------------------------------------------------

test('auth: scheduled sync (no user) is allowed; role user gets 403 on sync and list; managers cannot sync', async () => {
  const h = harness();
  const r = await h.call({ action: 'sync' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal((await h.as(CREW).call({ action: 'sync' })).status, 403);
  assert.equal((await h.as(CREW).call({ action: 'list' })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'sync' })).status, 403);
  assert.equal((await h.as(null).call({ action: 'list' })).status, 401);
  assert.equal((await h.call({ action: 'bogus' })).status, 400);
  assert.equal((await h.call({ action: 'thread', id: 'nope' }, OWNER)).status, 404);
});

test('sync: Gmail thread is stored, triaged, job-linked, relayed as a job note + one to-do, labelled and drafted (never sent, never archived)', async () => {
  const h = harness();
  const r = await h.call({ action: 'sync' });
  assert.equal(r.status, 200);
  const gf = r.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf.status, 'ok');
  assert.deepEqual({ fetched: gf.fetched, threads: gf.threads_updated, classified: gf.classified, relayed: gf.relayed, drafted: gf.drafted, archived: gf.archived }, { fetched: 2, threads: 2, classified: 2, relayed: 1, drafted: 1, archived: 0 });
  assert.deepEqual(gf.errors, []);
  assert.equal(h.store.EmailMessage.filter((m) => m.mailbox_key === 'gf-gmail').length, 2);

  const t1 = thread(h, 't1');
  assert.equal(t1.status, 'needs_reply');
  assert.equal(t1.category, 'schedule');
  assert.equal(t1.account_hint, 'gabefronk@gmail.com');
  assert.equal(t1.from_email, 'kyle@ivoryhomes.com');
  assert.equal(t1.triage_pending, false);
  assert.equal(t1.job_id, 'job1');
  assert.equal(t1.job_link_source, 'agent_match');
  assert.equal(t1.job_match_confidence, 'high');
  assert.equal(t1.web_link, 'https://mail.google.com/mail/u/0/#all/t1');
  // relay: one JobNotes row
  const note = h.store.JobNotes.find((n) => n.id === t1.note_id);
  assert.ok(note);
  assert.equal(note.job_id, 'job1');
  assert.equal(note.interaction_type, 'email');
  assert.equal(note.author, 'Inbox agent · Glass Forge (Gmail)');
  assert.equal(note.note_date, '2026-09-26');
  assert.match(note.body, /^Lot 412 Oquirrh West - window install date\nFrom Kyle Super <kyle@ivoryhomes.com>\n/);
  assert.match(note.body, /- Send COI to Ivory Homes/);
  assert.equal(t1.relayed_at, '2026-09-26T17:00:00.000Z');
  // to-do: exactly one, on Gabriel's list, idempotent key
  assert.equal(t1.todo_ids.length, 1);
  const todo = h.store.TodoTask.find((x) => x.id === t1.todo_ids[0]);
  assert.equal(todo.request_key, 'email:gf-gmail:t1');
  assert.equal(todo.assignee_member_id, 'mg');
  assert.equal(todo.category, 'follow_up');
  assert.equal(todo.status, 'open');
  assert.equal(todo.created_by_user_id, 'inbox-agent');
  // provider labels: Hub existed, Hub/Schedule was created, both applied to the thread
  const labelIds = h.gstate.labels.filter((l) => ['Hub', 'Hub/Schedule'].includes(l.name)).map((l) => l.id);
  assert.equal(labelIds.length, 2);
  const modify = h.hits.filter((x) => x.method === 'POST' && /threads\/t1\/modify/.test(x.url));
  assert.equal(modify.length, 1);
  assert.deepEqual(new Set(modify[0].body.addLabelIds), new Set(labelIds));
  assert.deepEqual(modify[0].body.removeLabelIds, []);
  assert.ok(labelIds.every((id) => t1.provider_labels.includes(id)));
  // draft: created on the thread, not sent
  assert.equal(t1.draft_status, 'drafted');
  assert.equal(t1.draft_id, 'draft-1');
  assert.match(t1.draft_preview, /Glass Forge \/ YA Windows and Doors$/);
  const draftCall = h.hits.find((x) => x.method === 'POST' && x.url.endsWith('/drafts'));
  assert.equal(draftCall.body.message.threadId, 't1');
  const rawDecoded = Buffer.from(draftCall.body.message.raw, 'base64url').toString('utf8');
  assert.match(rawDecoded, /^To: kyle@ivoryhomes\.com\r\n/m);
  assert.match(rawDecoded, /^In-Reply-To: <abc123@ivoryhomes\.com>\r\n/m);
  assert.equal(h.hits.some((x) => x.url.includes('/drafts/send')), false, 'the agent never sends');
  // draft prompt received job facts (address + next visit) and the guardrail
  const draftPrompt = h.llm.find((x) => x.prompt.includes('JOB FACTS')).prompt;
  assert.match(draftPrompt, /412 Oquirrh West Dr Herriman/);
  assert.match(draftPrompt, new RegExp(nextYear()));
  assert.match(draftPrompt, /untrusted evidence/);
  // promo thread: classified, labelled, not archived, no to-do, no draft
  const t3 = thread(h, 't3');
  assert.equal(t3.category, 'newsletter_promo');
  assert.equal(t3.status, 'new');
  assert.equal(t3.account_hint, 'gabriel.fronk.wd@gmail.com');
  assert.equal(t3.archived, false);
  assert.deepEqual(t3.todo_ids, []);
  assert.equal(t3.draft_status, 'none');
  assert.equal(h.hits.filter((x) => /threads\/t3\/modify/.test(x.url)).every((x) => !x.body.removeLabelIds.includes('INBOX')), true);
  // mailbox + run bookkeeping
  const mb = h.store.EmailMailbox.find((m) => m.key === 'gf-gmail');
  assert.equal(mb.last_history_id, '500');
  assert.equal(mb.last_error, '');
  assert.equal(mb.last_synced_at, '2026-09-26T17:00:00.000Z');
  assert.ok(mb.labels['Hub/Schedule']);
  assert.equal(mb.last_run.classified, 2);
  const runs = h.store.EmailAgentRun.filter((x) => x.mailbox_key === 'gf-gmail');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'ok');
  assert.equal(runs[0].fetched, 2);
  assert.ok(runs[0].finished_at);
  // one LLM triage call for the batch of 2 Gmail threads
  assert.equal(h.llm.filter((x) => x.prompt.includes('THREADS (untrusted evidence):') && x.prompt.includes('412') && x.prompt.includes('off blinds')).length, 1);
});

test('sync: Outlook thread uses delta + categories; a low-score job match stays unlinked with candidates; draft via createReply', async () => {
  const h = harness();
  const r = await h.call({ action: 'sync' });
  const ya = r.body.mailboxes.find((m) => m.mailbox_key === 'ya-outlook');
  assert.equal(ya.status, 'ok');
  assert.equal(ya.fetched, 1);
  const t = thread(h, 'AAQk1');
  assert.equal(t.category, 'service_warranty');
  assert.equal(t.priority, 'urgent');
  assert.equal(t.status, 'needs_reply');
  assert.equal(t.job_id, undefined);
  assert.equal(t.job_match_confidence, 'low');
  assert.deepEqual(t.job_candidates.map((c) => c.job_id), ['job1']);
  assert.ok(t.job_candidates[0].score < 0.85);
  assert.equal(t.note_id, undefined, 'no relay without a confident link');
  assert.equal(t.todo_ids.length, 1, 'to-do still created from action items');
  assert.equal(h.store.TodoTask.find((x) => x.id === t.todo_ids[0]).request_key, 'email:ya-outlook:AAQk1');
  assert.equal(t.web_link, 'https://outlook.live.com/mail/0/inbox/id/AAMk1');
  assert.deepEqual(t.provider_labels, ['Hub', 'Hub/Service']);
  const patch = h.hits.find((x) => x.method === 'PATCH' && /messages\/AAMk1$/.test(x.url));
  assert.deepEqual(patch.body, { categories: ['Hub', 'Hub/Service'] });
  assert.deepEqual(h.ostate.categories.map((c) => c.displayName).sort(), ['Hub', 'Hub/Service']);
  assert.equal(t.draft_status, 'drafted');
  assert.equal(t.draft_id, 'draft-o1');
  assert.ok(h.hits.some((x) => x.method === 'POST' && /AAMk1\/createReply/.test(x.url)));
  const bodyPatch = h.hits.find((x) => x.method === 'PATCH' && /messages\/draft-o1$/.test(x.url));
  assert.equal(bodyPatch.body.body.contentType, 'text');
  assert.equal(h.hits.some((x) => /\/send$/.test(x.url)), false);
  assert.equal(h.hits.some((x) => /\/move$/.test(x.url)), false, 'archive is off by default');
  const getMsg = h.hits.find((x) => x.method === 'GET' && /messages\/AAMk1\?/.test(x.url));
  assert.match(getMsg.headers.Prefer, /outlook.body-content-type="text"/);
  const mb = h.store.EmailMailbox.find((m) => m.key === 'ya-outlook');
  assert.match(mb.last_delta_link, /deltatoken=tok1/);
});

test('sync: second run is incremental (history / delta cursors) and creates nothing twice; a new incoming message re-triages without duplicating the note or to-do', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  const before = { todos: h.store.TodoTask.length, notes: h.store.JobNotes.length, threads: h.store.EmailThread.length, drafts: h.hits.filter((x) => x.url.endsWith('/drafts')).length };
  h.gstate.history = [];
  h.ostate.deltaNext = [];
  const r2 = await h.call({ action: 'sync' });
  assert.equal(r2.status, 200);
  assert.ok(h.hits.some((x) => x.url.includes('/history?startHistoryId=500')), 'gmail uses the stored history id');
  assert.ok(h.hits.some((x) => x.url.includes('deltatoken=tok1')), 'outlook uses the stored delta link');
  assert.equal(h.store.TodoTask.length, before.todos);
  assert.equal(h.store.JobNotes.length, before.notes);
  assert.equal(h.store.EmailThread.length, before.threads);
  assert.equal(h.store.EmailAgentRun.length, 4);
  // A follow-up from Kyle on t1 arrives via history.
  h.gstate.messages.m2 = gmailMessage({ id: 'm2', threadId: 't1', text: 'Bumping this - any word on the 6th?', internalDate: '1758950000000', messageIdHeader: '<def@ivoryhomes.com>' });
  h.gstate.history = [{ id: '510', messagesAdded: [{ message: { id: 'm2', threadId: 't1', labelIds: ['INBOX', 'UNREAD'] } }, { message: { id: 'd1', threadId: 't1', labelIds: ['DRAFT'] } }] }];
  h.gstate.historyId = '510';
  h.setClock('2026-09-26T18:00:00.000Z');
  const r3 = await h.call({ action: 'sync' });
  const gf = r3.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf.fetched, 1, 'drafts in history are skipped');
  assert.equal(gf.classified, 1);
  const t1 = thread(h, 't1');
  assert.equal(t1.message_count, 2);
  assert.equal(t1.triaged_at, '2026-09-26T18:00:00.000Z');
  assert.equal(t1.status, 'needs_reply');
  assert.equal(h.store.TodoTask.length, before.todos, 'one to-do per thread');
  assert.equal(h.store.JobNotes.length, before.notes, 'note relayed once');
  assert.equal(h.hits.filter((x) => x.url.endsWith('/drafts')).length, before.drafts, 'existing draft kept');
  assert.equal(h.store.EmailMailbox.find((m) => m.key === 'gf-gmail').last_history_id, '510');
  // Gabe replies (SENT): the thread goes to waiting without another LLM call.
  h.gstate.messages.m4 = gmailMessage({ id: 'm4', threadId: 't1', from: 'Gabe Fronk <gabriel.fronk.wd@gmail.com>', to: 'kyle@ivoryhomes.com', labelIds: ['SENT'], text: 'Yes, the 6th is locked in.', forwarded: false, internalDate: '1758960000000' });
  h.gstate.history = [{ id: '520', messagesAdded: [{ message: { id: 'm4', threadId: 't1', labelIds: ['SENT'] } }] }];
  const llmBefore = h.llm.length;
  await h.call({ action: 'sync' });
  assert.equal(thread(h, 't1').status, 'waiting');
  assert.equal(thread(h, 't1').reply_needed, false);
  assert.equal(h.llm.length, llmBefore);
});

test('sync: a mailbox whose connector is missing records not_connected and the other mailbox still runs; archive only when enabled', async () => {
  const h = harness({ connections: { gmail: { accessToken: 'g' } }, mailboxes: MAILBOXES.map((m) => (m.key === 'gf-gmail' ? { ...m, archive_enabled: true } : m)) });
  const r = await h.call({ action: 'sync' });
  const ya = r.body.mailboxes.find((m) => m.mailbox_key === 'ya-outlook');
  assert.equal(ya.status, 'error');
  assert.equal(ya.error, 'not_connected');
  assert.equal(h.store.EmailMailbox.find((m) => m.key === 'ya-outlook').last_error, 'not_connected');
  assert.equal(h.store.EmailAgentRun.find((x) => x.mailbox_key === 'ya-outlook').status, 'error');
  const gf = r.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf.status, 'ok');
  assert.equal(gf.archived, 1);
  assert.equal(thread(h, 't3').archived, true, 'promo archived when archive_enabled');
  assert.equal(thread(h, 't1').archived, false, 'schedule thread never archived');
  const archiveCall = h.hits.find((x) => /threads\/t3\/modify/.test(x.url) && x.body.removeLabelIds.includes('INBOX'));
  assert.ok(archiveCall);
});

test('sync: missing gabriel TeamMember skips to-dos with a warning; LLM failure leaves the thread pending for the next run', async () => {
  const h = harness({ seed: { TeamMember: [] } });
  const r = await h.call({ action: 'sync' });
  const gf = r.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf.status, 'ok');
  assert.ok(gf.errors.some((e) => /TeamMember 'gabriel' missing/.test(e)));
  assert.equal(h.store.TodoTask.length, 0);
  assert.deepEqual(thread(h, 't1').todo_ids, []);
  assert.ok(thread(h, 't1').note_id, 'relay still happens');

  const h2 = harness({ llmImpl: async () => { throw new Error('llm down'); } });
  const r2 = await h2.call({ action: 'sync' });
  const gf2 = r2.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf2.status, 'ok', 'a triage failure is a warning, not a failed run');
  assert.equal(gf2.classified, 0);
  assert.ok(gf2.errors.some((e) => /llm down/.test(e)));
  assert.equal(thread(h2, 't1').triage_pending, true);
  assert.equal(thread(h2, 't1').category, undefined);
  assert.equal(h2.store.EmailMessage.length, 3, 'messages are stored before triage');
  assert.equal(h2.store.EmailMailbox.find((m) => m.key === 'gf-gmail').last_history_id, '500', 'cursor still advances: the pending flag carries the work forward');
  // next run: nothing new from the provider, but the pending threads get triaged
  const h3 = harness({ seed: { EmailThread: h2.store.EmailThread, EmailMessage: h2.store.EmailMessage, EmailMailbox: h2.store.EmailMailbox }, gmail: { history: [] }, graph: { deltaNext: [] } });
  const r3 = await h3.call({ action: 'sync' });
  const gf3 = r3.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf3.fetched, 0);
  assert.equal(gf3.classified, 2, 'leftover pending threads are picked up');
  assert.equal(thread(h3, 't1').category, 'schedule');
  assert.equal(thread(h3, 't1').triage_pending, false);
});

test('list / thread: owner-only mailbox is hidden from managers and non-owner admins; owner sees both; filters and q work', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  const mgr = await h.as(MANAGER).call({ action: 'list' });
  assert.equal(mgr.status, 200);
  assert.deepEqual([...new Set(mgr.body.threads.map((t) => t.mailbox_key))], ['ya-outlook']);
  assert.deepEqual(mgr.body.mailboxes.map((m) => m.key), ['ya-outlook']);
  assert.equal((await h.as(MANAGER).call({ action: 'list', mailbox_key: 'gf-gmail' })).status, 403);
  assert.equal((await h.as(ADMIN).call({ action: 'list', mailbox_key: 'gf-gmail' })).status, 403, 'non-owner admin is not the owner');
  assert.equal((await h.as(MANAGER).call({ action: 'list', mailbox_key: 'nope' })).status, 404);
  const own = await h.as(OWNER).call({ action: 'list' });
  assert.equal(own.body.threads.length, 3);
  assert.equal(own.body.threads[0].thread_id, 'AAQk1', 'sorted by -last_message_at');
  assert.ok(own.body.threads.every((t) => !('text' in t)), 'list carries no bodies');
  const wd = await h.as(OWNER_WD).call({ action: 'list', mailbox_key: 'gf-gmail', status: 'needs_reply' });
  assert.deepEqual(wd.body.threads.map((t) => t.thread_id), ['t1']);
  const cat = await h.as(OWNER).call({ action: 'list', category: 'newsletter_promo' });
  assert.deepEqual(cat.body.threads.map((t) => t.thread_id), ['t3']);
  const q = await h.as(OWNER).call({ action: 'list', q: 'ivory' });
  assert.deepEqual(q.body.threads.map((t) => t.thread_id).sort(), ['AAQk1', 't1']);
  assert.equal((await h.as(OWNER).call({ action: 'list', status: 'bogus' })).status, 400);
  // thread detail
  const t1 = thread(h, 't1');
  const detail = await h.as(OWNER).call({ action: 'thread', id: t1.id });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.messages.length, 1);
  assert.match(detail.body.messages[0].text, /confirm the install/);
  assert.equal(detail.body.mailbox.key, 'gf-gmail');
  assert.equal((await h.as(MANAGER).call({ action: 'thread', id: t1.id })).status, 404, 'owner-only thread is invisible to managers');
  const ya = thread(h, 'AAQk1');
  assert.equal((await h.as(MANAGER).call({ action: 'thread', id: ya.id })).status, 200);
});

test('mutations: set_status / set_category / link_job (relays) / unlink_job / discard / regenerate; send_draft is admin-only and owner-only per mailbox', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  const t1 = thread(h, 't1');
  const ya = thread(h, 'AAQk1');
  // send_draft: manager 403, non-owner admin cannot see the owner-only thread, owner sends
  assert.equal((await h.as(MANAGER).call({ action: 'send_draft', id: ya.id })).status, 403);
  assert.equal((await h.as(ADMIN).call({ action: 'send_draft', id: t1.id })).status, 404);
  const sent = await h.as(OWNER).call({ action: 'send_draft', id: t1.id });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.thread.draft_status, 'sent');
  assert.equal(sent.body.thread.status, 'waiting');
  assert.deepEqual(h.hits.find((x) => x.url.endsWith('/drafts/send')).body, { id: 'draft-1' });
  assert.equal((await h.as(OWNER).call({ action: 'send_draft', id: t1.id })).status, 409, 'cannot send twice');
  // set_status by a manager on the YA thread
  const st = await h.as(MANAGER).call({ action: 'set_status', id: ya.id, status: 'done' });
  assert.equal(st.status, 200);
  assert.equal(thread(h, 'AAQk1').status, 'done');
  assert.equal(thread(h, 'AAQk1').reply_needed, false);
  assert.equal((await h.as(MANAGER).call({ action: 'set_status', id: ya.id, status: 'nah' })).status, 400);
  // set_category relabels in the provider
  const sc = await h.as(MANAGER).call({ action: 'set_category', id: ya.id, category: 'schedule' });
  assert.equal(sc.status, 200);
  assert.equal(thread(h, 'AAQk1').category, 'schedule');
  const lastPatch = h.hits.filter((x) => x.method === 'PATCH' && /messages\/AAMk1$/.test(x.url)).pop();
  assert.deepEqual(lastPatch.body.categories, ['Hub', 'Hub/Schedule']);
  // link_job on the unlinked YA thread relays a note; unlink clears it
  assert.equal((await h.as(MANAGER).call({ action: 'link_job', id: ya.id, job_id: 'missing' })).status, 404);
  const notesBefore = h.store.JobNotes.length;
  const lk = await h.as(MANAGER).call({ action: 'link_job', id: ya.id, job_id: 'job2' });
  assert.equal(lk.status, 200);
  assert.equal(thread(h, 'AAQk1').job_id, 'job2');
  assert.equal(thread(h, 'AAQk1').job_link_source, 'owner');
  assert.equal(h.store.JobNotes.length, notesBefore + 1);
  assert.equal(h.store.JobNotes.at(-1).author, 'Inbox agent · YA Install (Outlook)');
  assert.ok(thread(h, 'AAQk1').note_id);
  await h.as(MANAGER).call({ action: 'link_job', id: ya.id, job_id: 'job2' });
  assert.equal(h.store.JobNotes.length, notesBefore + 1, 'relinking does not duplicate the note');
  const ul = await h.as(MANAGER).call({ action: 'unlink_job', id: ya.id });
  assert.equal(ul.status, 200);
  assert.equal(thread(h, 'AAQk1').job_id, null);
  assert.equal(thread(h, 'AAQk1').note_id, null);
  // discard + regenerate on the YA draft
  const dc = await h.as(MANAGER).call({ action: 'discard_draft', id: ya.id });
  assert.equal(dc.status, 200);
  assert.equal(thread(h, 'AAQk1').draft_status, 'discarded');
  assert.ok(h.hits.some((x) => x.method === 'DELETE' && /messages\/draft-o1$/.test(x.url)));
  assert.equal((await h.as(MANAGER).call({ action: 'discard_draft', id: ya.id })).status, 409);
  const rg = await h.as(MANAGER).call({ action: 'regenerate_draft', id: ya.id });
  assert.equal(rg.status, 200);
  assert.equal(rg.body.thread.draft_status, 'drafted');
  assert.equal(rg.body.thread.draft_id, 'draft-o1');
  // archive action (manager) on the YA thread moves incoming messages
  const ar = await h.as(MANAGER).call({ action: 'archive', id: ya.id });
  assert.equal(ar.status, 200);
  assert.equal(thread(h, 'AAQk1').archived, true);
  assert.ok(h.hits.some((x) => /AAMk1\/move$/.test(x.url) && x.body.destinationId === 'archive'));
});

test('mailboxes / seed_mailboxes are admin-only; seeding is an upsert that keeps owner toggles', async () => {
  const h = harness({ mailboxes: [] });
  assert.equal((await h.as(MANAGER).call({ action: 'seed_mailboxes' })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'mailboxes' })).status, 403);
  const s1 = await h.as(OWNER).call({ action: 'seed_mailboxes' });
  assert.equal(s1.status, 200);
  assert.deepEqual(s1.body.mailboxes.map((m) => m.action), ['created', 'created']);
  const rows = h.store.EmailMailbox;
  assert.equal(rows.length, 2);
  const gf = rows.find((m) => m.key === 'gf-gmail');
  assert.equal(gf.visibility, 'owner');
  assert.equal(gf.archive_enabled, false);
  assert.equal(gf.draft_replies, true);
  assert.deepEqual(gf.auto_archive_categories, ['newsletter_promo', 'spam']);
  assert.equal(gf.signature, 'Gabe Fronk\nGlass Forge / YA Windows and Doors');
  assert.equal(rows.find((m) => m.key === 'ya-outlook').visibility, 'managers');
  assert.deepEqual(SEED_MAILBOXES.map((m) => m.address), ['gabriel.fronk.wd@gmail.com', 'yawindowinstall@outlook.com']);
  // owner flips a toggle; re-seeding keeps it
  gf.archive_enabled = true;
  const s2 = await h.as(OWNER).call({ action: 'seed_mailboxes' });
  assert.deepEqual(s2.body.mailboxes.map((m) => m.action), ['updated', 'updated']);
  assert.equal(h.store.EmailMailbox.length, 2);
  assert.equal(h.store.EmailMailbox.find((m) => m.key === 'gf-gmail').archive_enabled, true);
  // connection health
  const h2 = harness({ connections: { gmail: { accessToken: 'g' } } });
  const mb = await h2.as(OWNER).call({ action: 'mailboxes' });
  assert.equal(mb.status, 200);
  assert.deepEqual(mb.body.mailboxes.map((m) => [m.key, m.connected]), [['gf-gmail', true], ['ya-outlook', false]]);
  assert.match(mb.body.mailboxes[1].connection_detail, /not connected/);
});
