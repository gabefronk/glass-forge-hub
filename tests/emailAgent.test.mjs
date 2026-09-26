import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailAgentHandler, resetJobCache, SEED_MAILBOXES } from '../base44/shared/emailAgent.js';
import { gmailMessage, graphMessage, REPLY_TEXT, AT } from './fixtures/emailFixtures.mjs';

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
  const store = { EmailMailbox: [], EmailRelay: [], EmailAgentRun: [], HubContacts: [], ContactJobLink: [], JobNotes: [], TodoTask: [], TeamMember: [], Jobs: [], CalendarEvents: [], ...clone(seed) };
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

const GMAIL_PROMO = gmailMessage({ id: 'm3', threadId: 't3', from: 'Deals <promo@vendor.com>', to: 'gabriel.fronk.wd@gmail.com', subject: '50% off blinds this week', text: 'Buy now while supplies last.', forwarded: false, internalDate: AT(13) });
const GMAIL_SCHEDULE = gmailMessage({ text: REPLY_TEXT });
const GRAPH_SERVICE = graphMessage({ bodyText: 'The bottom sash on the master bedroom window cracked. Can someone come look at it this week?\n\nMaria' });

function gmailRoutes(state) {
  let labelSerial = 10;
  return [
    { method: 'GET', match: '/gmail/v1/users/me/profile', data: { emailAddress: 'gabriel.fronk.wd@gmail.com', historyId: '500' } },
    { method: 'GET', match: '/gmail/v1/users/me/messages?', data: () => ({ messages: state.scan }) },
    { method: 'GET', match: '/gmail/v1/users/me/history?', data: () => ({ history: state.history || [], historyId: state.historyId || '500' }) },
    { method: 'GET', match: /\/gmail\/v1\/users\/me\/messages\/([^?]+)\?format=full/, data: ({ url }) => state.messages[decodeURIComponent(url.match(/messages\/([^?]+)\?/)[1])] },
    { method: 'GET', match: /\/gmail\/v1\/users\/me\/threads\/([^/?]+)\?format=full/, data: ({ url }) => ({ id: 'x', messages: (state.threads || {})[decodeURIComponent(url.match(/threads\/([^/?]+)\?/)[1])] || [] }) },
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
    { method: 'GET', match: '/me/messages?', data: ({ url }) => ({ value: (state.conversations || {})[decodeURIComponent(url).match(/conversationId eq '([^']+)'/)[1]] || [] }) },
    { method: 'GET', match: /\/me\/messages\/[^/?]+\?/, data: ({ url }) => state.messages[decodeURIComponent(url.match(/messages\/([^/?]+)\?/)[1])] },
    { method: 'PATCH', match: /\/me\/messages\/[^/?]+$/, data: {} },
    { method: 'DELETE', match: /\/me\/messages\/[^/?]+$/, data: undefined },
  ];
}

// ---- LLM mock ------------------------------------------------------------------------------------------
function triageFor(t) {
  const s = String(t.subject || '');
  if (/PO 7104345 ETA/.test(s)) return { key: t.key, category: 'order_vendor', priority: 'normal', summary: 'Vendor desk: PO 7104345 shipped, lands Monday; second PO 7104999 (OE 55-1) confirmed for lot 412.', action_items: ['Tell Kyle the glass lands Monday'], reply_needed: false, next_step: '', extracted: { builder: 'Ivory Homes', lot: '412', address: 'Oquirrh West', po_numbers: ['7104345', ' 7104999 '], oe_numbers: ['OE 55-1'], dates: [], contact_name: '', contact_phone: '', contact_email: '', contact_role: 'vendor' } };
  if (/homeowner intro/i.test(s)) return { key: t.key, category: 'job_update', priority: 'normal', summary: 'Dana Brewer introduces herself as the homeowner at lot 412 and shares her cell.', action_items: [], reply_needed: false, next_step: '', extracted: { builder: 'Ivory Homes', lot: '412', address: 'Oquirrh West', po_numbers: [], oe_numbers: [], dates: [], contact_name: 'Dana Brewer', contact_phone: '(801) 555-0199', contact_email: 'dana@example.com', contact_role: 'homeowner' } };
  if (/moved to/i.test(s)) return { key: t.key, category: 'schedule', priority: 'normal', summary: 'Ivory moved the lot 412 install to Oct 8 (FYI).', action_items: [], reply_needed: false, next_step: '', extracted: { builder: 'Ivory Homes', lot: '412', address: 'Oquirrh West', po_numbers: [], oe_numbers: [], dates: ['2026-10-08 install'], contact_name: '', contact_phone: '', contact_email: '', contact_role: '' } };
  if (/412/.test(s)) return { key: t.key, category: 'schedule', priority: 'normal', summary: 'Kyle (Ivory Homes) wants the lot 412 install on Tue Oct 6 confirmed and the COI sent before crews arrive.', action_items: ['Confirm Oct 6 install with Kyle', 'Send COI to Ivory Homes'], reply_needed: true, next_step: 'Reply to Kyle', extracted: { builder: 'Ivory Homes', lot: '412', address: 'Oquirrh West', po_numbers: [], oe_numbers: [], dates: ['2026-10-06 install'], contact_name: 'Kyle', contact_phone: '801-555-0142', contact_email: 'kyle@ivoryhomes.com', contact_role: 'superintendent' } };
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

function harness({ user = null, seed = {}, gmail = {}, graph = {}, connections = { gmail: { accessToken: 'g-token' }, outlook: { accessToken: 'o-token' } }, mailboxes = MAILBOXES, llmImpl = null, budgetMs = 50_000 } = {}) {
  resetJobCache();
  const { store, api, calls } = makeStore({ EmailMailbox: mailboxes, Jobs: JOBS, CalendarEvents: EVENTS, TeamMember: MEMBERS, ...seed });
  const gstate = { scan: [{ id: 'm1', threadId: 't1' }, { id: 'm3', threadId: 't3' }], messages: { m1: GMAIL_SCHEDULE, m3: GMAIL_PROMO }, threads: { t1: [GMAIL_SCHEDULE], t3: [GMAIL_PROMO] }, labels: [{ id: 'Label_1', name: 'Hub' }], history: [], ...gmail };
  const ostate = { delta: [{ id: 'AAMk1', conversationId: 'AAQk1' }], messages: { AAMk1: GRAPH_SERVICE }, conversations: { AAQk1: [GRAPH_SERVICE] }, categories: [], ...graph };
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
  let ms = 0;
  const h = createEmailAgentHandler({ getClient: async () => client, fetchImpl, now: () => clock, nowMs: () => ms, budgetMs, sleep: async () => {} });
  const call = async (body, u = user) => {
    const r = await h(new Request('https://test.local/emailAgent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const as = (u) => { user = u; return { call: (body) => call(body, u) }; };
  return { call, as, store, calls, hits, llm, gstate, ostate, setClock: (v) => { clock = v; }, tick: (n) => { ms += n; } };
}

const thread = (h, threadId) => h.store.EmailRelay.find((t) => t.thread_id === threadId);

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
  assert.equal((await h.call({ action: 'send_draft', id: 'x' })).status, 400, 'the agent has no send action at all');
  assert.equal((await h.as(OWNER).call({ action: 'entry', id: 'nope' })).status, 404);
});

test('sync: Gmail thread becomes one ledger row (no bodies), is triaged, job-linked, relayed as a job note + one to-do, labelled and drafted in the mailbox (never sent, never archived)', async () => {
  const h = harness();
  const r = await h.call({ action: 'sync' });
  assert.equal(r.status, 200);
  const gf = r.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf.status, 'ok');
  assert.deepEqual({ fetched: gf.fetched, threads: gf.threads_updated, classified: gf.classified, relayed: gf.relayed, drafted: gf.drafted, archived: gf.archived }, { fetched: 2, threads: 2, classified: 2, relayed: 1, drafted: 1, archived: 0 });
  assert.deepEqual(gf.errors, []);
  assert.equal('EmailMessage' in h.store, false);
  assert.equal(h.calls.some((c) => /^EmailMessage|^EmailThread/.test(c)), false, 'no message store is touched');
  for (const row of h.store.EmailRelay) for (const k of ['text', 'snippet', 'participants', 'to_emails', 'draft_preview', 'attachments']) assert.equal(k in row, false, `${k} never lands in the Hub`);

  const t1 = thread(h, 't1');
  assert.equal(t1.status, 'needs_reply');
  assert.equal(t1.category, 'schedule');
  assert.equal(t1.account_hint, 'gabefronk@gmail.com');
  assert.equal(t1.from_email, 'kyle@ivoryhomes.com');
  assert.equal(t1.message_count, 1);
  assert.equal(t1.triage_pending, false);
  assert.equal(t1.job_id, 'job1');
  assert.equal(t1.job_link_source, 'agent_match');
  assert.equal(t1.job_match_confidence, 'high');
  assert.equal(t1.web_link, 'https://mail.google.com/mail/u/0/#all/t1');
  assert.deepEqual(t1.hub_changes, ['Note added to Oquirrh West 412', 'To-do created']);
  // relay: one JobNotes row that links back to the mail
  const note = h.store.JobNotes.find((n) => n.id === t1.note_id);
  assert.ok(note);
  assert.equal(note.job_id, 'job1');
  assert.equal(note.interaction_type, 'email');
  assert.equal(note.author, 'Inbox agent · Glass Forge (Gmail)');
  assert.equal(note.note_date, '2026-09-26');
  assert.match(note.body, /^Lot 412 Oquirrh West - window install date\nFrom Kyle Super <kyle@ivoryhomes.com>\n/);
  assert.match(note.body, /- Send COI to Ivory Homes/);
  assert.match(note.body, /Open the email: https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/t1/);
  assert.doesNotMatch(note.body, /confirm the install for lot 412/, 'the note carries the summary, not the email text');
  assert.equal(t1.relayed_at, '2026-09-26T17:00:00.000Z');
  // to-do: exactly one, on Gabriel's list, idempotent key
  assert.equal(t1.todo_ids.length, 1);
  const todo = h.store.TodoTask.find((x) => x.id === t1.todo_ids[0]);
  assert.equal(todo.request_key, 'email:gf-gmail:t1');
  assert.equal(todo.assignee_member_id, 'mg');
  assert.equal(todo.category, 'follow_up');
  assert.equal(todo.status, 'open');
  assert.equal(todo.created_by_user_id, 'inbox-agent');
  // a superintendent contact is never auto-created: only a homeowner is
  assert.equal(h.store.HubContacts.length, 0);
  assert.equal(h.store.ContactJobLink.length, 0);
  // provider labels: Hub existed, Hub/Schedule was created, both applied to the thread
  const labelIds = h.gstate.labels.filter((l) => ['Hub', 'Hub/Schedule'].includes(l.name)).map((l) => l.id);
  assert.equal(labelIds.length, 2);
  const modify = h.hits.filter((x) => x.method === 'POST' && /threads\/t1\/modify/.test(x.url));
  assert.equal(modify.length, 1);
  assert.deepEqual(new Set(modify[0].body.addLabelIds), new Set(labelIds));
  assert.deepEqual(modify[0].body.removeLabelIds, []);
  assert.ok(labelIds.every((id) => t1.provider_labels.includes(id)));
  // draft: created on the thread in Gmail, never sent; the Hub keeps only its id
  assert.equal(t1.draft_status, 'drafted');
  assert.equal(t1.draft_id, 'draft-1');
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
  // promo thread: classified, labelled, not archived, no to-do, no draft, nothing changed in the Hub
  const t3 = thread(h, 't3');
  assert.equal(t3.category, 'newsletter_promo');
  assert.equal(t3.status, 'new');
  assert.equal(t3.account_hint, 'gabriel.fronk.wd@gmail.com');
  assert.equal(t3.archived, false);
  assert.deepEqual(t3.todo_ids, []);
  assert.deepEqual(t3.hub_changes, []);
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
  // one LLM triage call for the batch of 2 Gmail threads; the mail was never re-read from the provider
  assert.equal(h.llm.filter((x) => x.prompt.includes('THREADS (untrusted evidence):') && x.prompt.includes('412') && x.prompt.includes('off blinds')).length, 1);
  assert.equal(h.hits.some((x) => /\/threads\/[^/]+\?format=full/.test(x.url)), false);
});

test('sync: a high-confidence match applies the PO/OE numbers and the homeowner the email states; a plain FYI date change still becomes a to-do', async () => {
  const VENDOR = gmailMessage({ id: 'm5', threadId: 't5', from: 'Vendor Desk <orders@amsco.com>', to: 'gabefronk@gmail.com', subject: 'RE: PO 7104345 ETA', text: 'PO 7104345 shipped. Second PO 7104999 confirmed.', internalDate: AT(12) });
  const OWNERMAIL = gmailMessage({ id: 'm6', threadId: 't6', from: 'Dana Brewer <dana@example.com>', to: 'gabefronk@gmail.com', subject: 'Homeowner intro - lot 412', text: 'Hi Gabe, I am the homeowner at lot 412. Cell (801) 555-0199.', internalDate: AT(12, 30) });
  const MOVED = gmailMessage({ id: 'm7', threadId: 't7', from: 'Ivory Scheduling <sched@ivoryhomes.com>', to: 'gabefronk@gmail.com', subject: 'Lot 412 moved to Oct 8', text: 'FYI install moved to Oct 8.', internalDate: AT(12, 45) });
  const h = harness({ gmail: { scan: [{ id: 'm5', threadId: 't5' }, { id: 'm6', threadId: 't6' }, { id: 'm7', threadId: 't7' }], messages: { m5: VENDOR, m6: OWNERMAIL, m7: MOVED } } });
  const r = await h.call({ action: 'sync' });
  const gf = r.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.deepEqual(gf.errors, []);
  assert.equal(gf.classified, 3);
  // PO / OE: only the numbers the job did not have, trimmed, nothing removed
  const job = h.store.Jobs.find((j) => j.id === 'job1');
  assert.deepEqual(job.po_numbers, ['7104345', '7104999']);
  assert.deepEqual(job.oe_numbers, ['OE 55-1']);
  const t5 = thread(h, 't5');
  assert.equal(t5.job_id, 'job1');
  assert.deepEqual(t5.hub_changes, ['PO 7104999 added to the job', 'OE 55-1 added to the job', 'Note added to Oquirrh West 412', 'To-do created']);
  assert.deepEqual(t5.applied, { po_numbers: ['7104999'], oe_numbers: ['OE 55-1'] });
  assert.match(h.store.JobNotes.find((n) => n.id === t5.note_id).body, /Hub updates:\n- PO 7104999 added to the job/);
  // homeowner: created once as a Hub contact and linked to the job as its homeowner
  const t6 = thread(h, 't6');
  assert.equal(t6.job_id, 'job1');
  assert.equal(h.store.HubContacts.length, 1);
  const dana = h.store.HubContacts[0];
  assert.equal(dana.name, 'Dana Brewer');
  assert.equal(dana.phone_key, '+18015550199');
  assert.equal(dana.email_key, 'dana@example.com');
  assert.equal(dana.role, 'homeowner');
  assert.equal(dana.company, 'Homeowner');
  assert.match(dana.key, /^[a-f0-9]{64}$/);
  assert.deepEqual(h.store.ContactJobLink.map((l) => [l.contact_key === dana.key, l.job_id, l.role, l.source]), [[true, 'job1', 'homeowner', 'inbox_agent']]);
  assert.equal(t6.applied.homeowner_contact_key, dana.key);
  assert.deepEqual(t6.hub_changes, ['Homeowner Dana Brewer added to the job', 'Note added to Oquirrh West 412']);
  assert.equal(t6.todo_ids.length, 0, 'no action items, no to-do');
  // FYI schedule change: a to-do asks a human to confirm and move the visit
  const t7 = thread(h, 't7');
  assert.equal(t7.category, 'schedule');
  assert.deepEqual(t7.action_items, ['Confirm the date change and move the visit if it is right: 2026-10-08 install']);
  assert.equal(t7.todo_ids.length, 1);
  assert.match(h.store.TodoTask.find((x) => x.id === t7.todo_ids[0]).details, /2026-10-08 install/);
  assert.equal(h.store.CalendarEvents[0].event_date, nextYear(), 'the agent never moves a visit by itself');
  // second run over the same mail (fresh scan) changes nothing twice
  h.gstate.history = [];
  const jobsBefore = JSON.stringify(h.store.Jobs);
  await h.call({ action: 'sync', fresh: true });
  assert.equal(JSON.stringify(h.store.Jobs), jobsBefore);
  assert.equal(h.store.HubContacts.length, 1);
  assert.equal(h.store.ContactJobLink.length, 1);
  assert.equal(h.store.JobNotes.length, 3, 't5, t6, t7');
  assert.equal(h.store.TodoTask.length, 3, 't5, t7 and the Outlook service thread');
  // a job that already has a homeowner is left alone
  const h2 = harness({ seed: { ContactJobLink: [{ id: 'l0', contact_key: 'k0', job_id: 'job1', role: 'homeowner', source: 'manual' }] }, gmail: { scan: [{ id: 'm6', threadId: 't6' }], messages: { m6: OWNERMAIL } } });
  await h2.call({ action: 'sync' });
  assert.equal(h2.store.HubContacts.length, 0);
  assert.equal(h2.store.ContactJobLink.length, 1);
  assert.deepEqual(thread(h2, 't6').hub_changes, ['Note added to Oquirrh West 412']);
  // an existing contact with the same phone is reused, not duplicated
  const h3 = harness({ seed: { HubContacts: [{ id: 'c1', key: 'k1', name: 'D. Brewer', phone: '801-555-0199', phone_key: '+18015550199', email: '', email_key: '', status: '' }] }, gmail: { scan: [{ id: 'm6', threadId: 't6' }], messages: { m6: OWNERMAIL } } });
  await h3.call({ action: 'sync' });
  assert.equal(h3.store.HubContacts.length, 1);
  assert.deepEqual(h3.store.ContactJobLink.map((l) => l.contact_key), ['k1']);
  assert.deepEqual(thread(h3, 't6').hub_changes, ['Homeowner D. Brewer added to the job', 'Note added to Oquirrh West 412']);
});

test('sync: Outlook thread uses delta + categories; a low-score job match stays unlinked with candidates and applies nothing; draft via createReply', async () => {
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
  assert.deepEqual(t.hub_changes, ['To-do created']);
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
  const before = { todos: h.store.TodoTask.length, notes: h.store.JobNotes.length, rows: h.store.EmailRelay.length, drafts: h.hits.filter((x) => x.url.endsWith('/drafts')).length };
  h.gstate.history = [];
  h.ostate.deltaNext = [];
  const r2 = await h.call({ action: 'sync' });
  assert.equal(r2.status, 200);
  assert.ok(h.hits.some((x) => x.url.includes('/history?startHistoryId=500')), 'gmail uses the stored history id');
  assert.ok(h.hits.some((x) => x.url.includes('deltatoken=tok1')), 'outlook uses the stored delta link');
  assert.equal(h.store.TodoTask.length, before.todos);
  assert.equal(h.store.JobNotes.length, before.notes);
  assert.equal(h.store.EmailRelay.length, before.rows);
  assert.equal(h.store.EmailAgentRun.length, 4);
  // A follow-up from Kyle on t1 arrives via history.
  h.gstate.messages.m2 = gmailMessage({ id: 'm2', threadId: 't1', text: 'Bumping this - any word on the 6th?', internalDate: AT(14, 30), messageIdHeader: '<def@ivoryhomes.com>' });
  h.gstate.history = [{ id: '510', messagesAdded: [{ message: { id: 'm2', threadId: 't1', labelIds: ['INBOX', 'UNREAD'] } }, { message: { id: 'd1', threadId: 't1', labelIds: ['DRAFT'] } }] }];
  h.gstate.historyId = '510';
  h.setClock('2026-09-26T18:00:00.000Z');
  const r3 = await h.call({ action: 'sync' });
  const gf = r3.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf.fetched, 1, 'drafts in history are skipped');
  assert.equal(gf.classified, 1);
  const t1 = thread(h, 't1');
  assert.equal(t1.message_count, 2);
  assert.equal(t1.last_message_at, '2026-09-26T14:30:00.000Z');
  assert.equal(t1.triaged_at, '2026-09-26T18:00:00.000Z');
  assert.equal(t1.status, 'needs_reply');
  assert.equal(h.store.TodoTask.length, before.todos, 'one to-do per thread');
  assert.equal(h.store.JobNotes.length, before.notes, 'note relayed once');
  assert.deepEqual(t1.hub_changes, ['Note added to Oquirrh West 412', 'To-do created'], 'nothing logged twice');
  assert.equal(h.hits.filter((x) => x.url.endsWith('/drafts')).length, before.drafts, 'existing draft kept');
  assert.equal(h.store.EmailMailbox.find((m) => m.key === 'gf-gmail').last_history_id, '510');
  // The same message listed again (history replay) is not new: dated at the watermark.
  h.gstate.history = [{ id: '515', messagesAdded: [{ message: { id: 'm2', threadId: 't1', labelIds: ['INBOX'] } }] }];
  const llmMid = h.llm.length;
  await h.call({ action: 'sync' });
  assert.equal(thread(h, 't1').message_count, 2, 'replayed message not counted twice');
  assert.equal(h.llm.length, llmMid);
  // Gabe replies (SENT): the thread goes to waiting without another LLM call.
  h.gstate.messages.m4 = gmailMessage({ id: 'm4', threadId: 't1', from: 'Gabe Fronk <gabriel.fronk.wd@gmail.com>', to: 'kyle@ivoryhomes.com', labelIds: ['SENT'], text: 'Yes, the 6th is locked in.', forwarded: false, internalDate: AT(14, 45) });
  h.gstate.history = [{ id: '520', messagesAdded: [{ message: { id: 'm4', threadId: 't1', labelIds: ['SENT'] } }] }];
  const llmBefore = h.llm.length;
  await h.call({ action: 'sync' });
  assert.equal(thread(h, 't1').status, 'waiting');
  assert.equal(thread(h, 't1').reply_needed, false);
  assert.equal(thread(h, 't1').message_count, 3);
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

test('sync: missing gabriel TeamMember skips to-dos with a warning; LLM failure leaves the row pending and the next run re-reads the mail from the mailbox', async () => {
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
  assert.equal(h2.store.EmailMailbox.find((m) => m.key === 'gf-gmail').last_history_id, '500', 'cursor still advances: the pending flag carries the work forward');
  // next run: nothing new from the provider; pending rows are re-read from Gmail / Graph and triaged
  const h3 = harness({ seed: { EmailRelay: h2.store.EmailRelay, EmailMailbox: h2.store.EmailMailbox }, gmail: { history: [] }, graph: { deltaNext: [] } });
  const r3 = await h3.call({ action: 'sync' });
  const gf3 = r3.body.mailboxes.find((m) => m.mailbox_key === 'gf-gmail');
  assert.equal(gf3.fetched, 0);
  assert.equal(gf3.classified, 2, 'leftover pending rows are picked up');
  assert.ok(h3.hits.some((x) => /\/threads\/t1\?format=full/.test(x.url)), 'gmail thread re-read');
  assert.ok(h3.hits.some((x) => x.url.includes('/me/messages?') && decodeURIComponent(x.url).includes("conversationId eq 'AAQk1'")), 'graph conversation re-read');
  assert.equal(thread(h3, 't1').category, 'schedule');
  assert.equal(thread(h3, 't1').triage_pending, false);
  assert.equal(thread(h3, 't1').job_id, 'job1');
  assert.equal(thread(h3, 't1').draft_status, 'drafted', 'the draft is written from the re-read text');
  assert.equal(thread(h3, 'AAQk1').category, 'service_warranty');
});

test('sync: when the budget runs out after triage, the un-relayed rows go back to pending and the next run relays them', async () => {
  // The one triage call burns 30 of a 20 budget: triage lands, the relay loop never starts.
  let h;
  h = harness({ budgetMs: 20, llmImpl: async (req) => { h.tick(30); return makeLLM([])(req); } });
  const r = await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  const gf = r.body.mailboxes[0];
  assert.equal(gf.status, 'ok');
  assert.equal(gf.classified, 2);
  assert.equal(gf.relayed, 0);
  assert.ok(gf.errors.some((e) => /budget exhausted before relay/.test(e)));
  assert.equal(thread(h, 't1').category, 'schedule', 'triage result is kept');
  assert.equal(thread(h, 't1').triage_pending, true, 're-flagged for the next run');
  assert.equal(thread(h, 't1').note_id, undefined);
  assert.equal(h.store.TodoTask.length, 0);

  const h2 = harness({ seed: { EmailRelay: h.store.EmailRelay, EmailMailbox: h.store.EmailMailbox }, gmail: { history: [] } });
  const r2 = await h2.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  const gf2 = r2.body.mailboxes[0];
  assert.equal(gf2.fetched, 0);
  assert.equal(gf2.classified, 2);
  assert.equal(gf2.relayed, 1, 'the schedule thread relays; the promo does not');
  assert.equal(thread(h2, 't1').triage_pending, false);
  assert.ok(thread(h2, 't1').note_id);
  assert.equal(h2.store.TodoTask.length, 1);
});

test('list / entry: owner-only mailbox is hidden from managers and non-owner admins; owner sees both; filters and q work; entries carry no mail text', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  const mgr = await h.as(MANAGER).call({ action: 'list' });
  assert.equal(mgr.status, 200);
  assert.deepEqual([...new Set(mgr.body.entries.map((t) => t.mailbox_key))], ['ya-outlook']);
  assert.deepEqual(mgr.body.mailboxes.map((m) => m.key), ['ya-outlook']);
  assert.equal((await h.as(MANAGER).call({ action: 'list', mailbox_key: 'gf-gmail' })).status, 403);
  assert.equal((await h.as(ADMIN).call({ action: 'list', mailbox_key: 'gf-gmail' })).status, 403, 'non-owner admin is not the owner');
  assert.equal((await h.as(MANAGER).call({ action: 'list', mailbox_key: 'nope' })).status, 404);
  const own = await h.as(OWNER).call({ action: 'list' });
  assert.equal(own.body.entries.length, 3);
  assert.equal(own.body.entries[0].thread_id, 'AAQk1', 'sorted by -last_message_at');
  assert.ok(own.body.entries.every((t) => !('text' in t) && !('snippet' in t)), 'list carries no bodies');
  const wd = await h.as(OWNER_WD).call({ action: 'list', mailbox_key: 'gf-gmail', status: 'needs_reply' });
  assert.deepEqual(wd.body.entries.map((t) => t.thread_id), ['t1']);
  const cat = await h.as(OWNER).call({ action: 'list', category: 'newsletter_promo' });
  assert.deepEqual(cat.body.entries.map((t) => t.thread_id), ['t3']);
  const q = await h.as(OWNER).call({ action: 'list', q: 'ivory' });
  assert.deepEqual(q.body.entries.map((t) => t.thread_id).sort(), ['AAQk1', 't1']);
  const byChange = await h.as(OWNER).call({ action: 'list', q: 'note added' });
  assert.deepEqual(byChange.body.entries.map((t) => t.thread_id), ['t1']);
  const byJob = await h.as(OWNER).call({ action: 'list', job_id: 'job1' });
  assert.deepEqual(byJob.body.entries.map((t) => t.thread_id), ['t1']);
  assert.equal((await h.as(OWNER).call({ action: 'list', status: 'bogus' })).status, 400);
  // entry detail is the ledger row alone
  const t1 = thread(h, 't1');
  const detail = await h.as(OWNER).call({ action: 'entry', id: t1.id });
  assert.equal(detail.status, 200);
  assert.equal('messages' in detail.body, false);
  assert.equal(detail.body.entry.thread_id, 't1');
  assert.equal(detail.body.mailbox.key, 'gf-gmail');
  assert.equal((await h.as(MANAGER).call({ action: 'entry', id: t1.id })).status, 404, 'owner-only entry is invisible to managers');
  const ya = thread(h, 'AAQk1');
  assert.equal((await h.as(MANAGER).call({ action: 'entry', id: ya.id })).status, 200);
});

test('mutations: set_status / set_category / link_job (applies facts + relays) / unlink_job / discard / regenerate (re-reads the mailbox) / archive', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  const ya = thread(h, 'AAQk1');
  // set_status by a manager on the YA thread
  const st = await h.as(MANAGER).call({ action: 'set_status', id: ya.id, status: 'done' });
  assert.equal(st.status, 200);
  assert.equal(thread(h, 'AAQk1').status, 'done');
  assert.equal(thread(h, 'AAQk1').reply_needed, false);
  assert.equal((await h.as(MANAGER).call({ action: 'set_status', id: ya.id, status: 'nah' })).status, 400);
  // set_category relabels in the provider (Outlook needs the message ids: re-read from Graph)
  const sc = await h.as(MANAGER).call({ action: 'set_category', id: ya.id, category: 'schedule' });
  assert.equal(sc.status, 200);
  assert.equal(thread(h, 'AAQk1').category, 'schedule');
  const lastPatch = h.hits.filter((x) => x.method === 'PATCH' && /messages\/AAMk1$/.test(x.url)).pop();
  assert.deepEqual(lastPatch.body.categories, ['Hub', 'Hub/Schedule']);
  // link_job on the unlinked YA thread relays a note; relinking does not duplicate; unlink clears the link only
  assert.equal((await h.as(MANAGER).call({ action: 'link_job', id: ya.id, job_id: 'missing' })).status, 404);
  const notesBefore = h.store.JobNotes.length;
  const lk = await h.as(MANAGER).call({ action: 'link_job', id: ya.id, job_id: 'job2' });
  assert.equal(lk.status, 200);
  assert.equal(thread(h, 'AAQk1').job_id, 'job2');
  assert.equal(thread(h, 'AAQk1').job_link_source, 'owner');
  assert.equal(h.store.JobNotes.length, notesBefore + 1);
  assert.equal(h.store.JobNotes.at(-1).author, 'Inbox agent · YA Install (Outlook)');
  assert.ok(thread(h, 'AAQk1').note_id);
  assert.deepEqual(thread(h, 'AAQk1').hub_changes, ['To-do created', 'Note added to Summit Creek 14']);
  await h.as(MANAGER).call({ action: 'link_job', id: ya.id, job_id: 'job2' });
  assert.equal(h.store.JobNotes.length, notesBefore + 1, 'relinking does not duplicate the note');
  const ul = await h.as(MANAGER).call({ action: 'unlink_job', id: ya.id });
  assert.equal(ul.status, 200);
  assert.equal(thread(h, 'AAQk1').job_id, null);
  assert.equal(thread(h, 'AAQk1').note_id, null);
  assert.equal(h.store.JobNotes.length, notesBefore + 1, 'the note stays on the job');
  assert.equal(thread(h, 'AAQk1').hub_changes.at(-1), 'Job link removed');
  // an owner link to a job applies the email's PO numbers to that job
  const t1 = thread(h, 't1');
  await h.as(OWNER).call({ action: 'unlink_job', id: t1.id });
  h.store.EmailRelay.find((x) => x.id === t1.id).extracted.po_numbers = ['NEW-77'];
  const lk2 = await h.as(OWNER).call({ action: 'link_job', id: t1.id, job_id: 'job2' });
  assert.equal(lk2.status, 200);
  assert.deepEqual(h.store.Jobs.find((j) => j.id === 'job2').po_numbers, ['NEW-77']);
  assert.ok(thread(h, 't1').hub_changes.includes('PO NEW-77 added to the job'));
  // discard + regenerate on the YA draft; regenerate reads the thread back from Graph
  const dc = await h.as(MANAGER).call({ action: 'discard_draft', id: ya.id });
  assert.equal(dc.status, 200);
  assert.equal(thread(h, 'AAQk1').draft_status, 'discarded');
  assert.ok(h.hits.some((x) => x.method === 'DELETE' && /messages\/draft-o1$/.test(x.url)));
  assert.equal((await h.as(MANAGER).call({ action: 'discard_draft', id: ya.id })).status, 409);
  const reads = h.hits.filter((x) => x.url.includes('/me/messages?')).length;
  const rg = await h.as(MANAGER).call({ action: 'regenerate_draft', id: ya.id });
  assert.equal(rg.status, 200);
  assert.equal(rg.body.entry.draft_status, 'drafted');
  assert.equal(rg.body.entry.draft_id, 'draft-o1');
  assert.equal('draft_preview' in rg.body.entry, false);
  assert.equal(h.hits.filter((x) => x.url.includes('/me/messages?')).length, reads + 1);
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
