import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailAgentHandler, resetJobCache, SEED_MAILBOXES } from '../base44/shared/emailAgent.js';
import { gmailMessage, graphMessage, REPLY_TEXT, AT } from './fixtures/emailFixtures.mjs';
import { makeDriveMock } from './fixtures/driveMock.mjs';

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
    let parsedBody = null;
    if (init.body) { try { parsedBody = JSON.parse(init.body); } catch { parsedBody = String(init.body); } }
    hits.push({ method, url, path, body: parsedBody, headers: init.headers || {} });
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
    { method: 'GET', match: '/gmail/v1/users/me/profile', data: () => ({ emailAddress: state.me || 'gabriel.fronk.wd@gmail.com', historyId: '500' }) },
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
    { method: 'GET', match: /\/gmail\/v1\/users\/me\/messages\/[^/]+\/attachments\//, data: () => ({ data: Buffer.from('PDF-BYTES').toString('base64url'), size: 8, mimeType: 'application/pdf' }) },
  ];
}

function graphRoutes(state) {
  let catSerial = 0;
  const deltaLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=tok1';
  return [
    { method: 'GET', match: /\/v1\.0\/me\?\$select=mail/, data: () => ({ mail: state.me || 'yawindowinstall@outlook.com', userPrincipalName: state.me || 'yawindowinstall@outlook.com' }) },
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
  if (/PAID/i.test(s) && /INV00\d+/.test(s)) return { key: t.key, category: 'invoice_billing', priority: 'normal', summary: 'Helcim PAID notice.', action_items: [], reply_needed: false, next_step: '', tax_record: true, vendor: 'LLC says so', extracted: {} };
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

function harness({ user = OWNER, seed = {}, gmail = {}, graph = {}, drive = {}, connections = { gmail: { accessToken: 'g-token' }, outlook: { accessToken: 'o-token' } }, mailboxes = MAILBOXES, llmImpl = null, budgetMs = 50_000, taxFilingEnabled } = {}) {
  // Default caller is an authenticated owner: anonymous (null-user) sync is no longer
  // allowed (fail-closed), so tests that seed via sync run as OWNER. Unauthenticated
  // paths are exercised explicitly via h.as(null).
  resetJobCache();
  const { store, api, calls } = makeStore({ EmailMailbox: mailboxes, Jobs: JOBS, CalendarEvents: EVENTS, TeamMember: MEMBERS, ...seed });
  const gstate = { scan: [{ id: 'm1', threadId: 't1' }, { id: 'm3', threadId: 't3' }], messages: { m1: GMAIL_SCHEDULE, m3: GMAIL_PROMO }, threads: { t1: [GMAIL_SCHEDULE], t3: [GMAIL_PROMO] }, labels: [{ id: 'Label_1', name: 'Hub' }], history: [], ...gmail };
  const ostate = { delta: [{ id: 'AAMk1', conversationId: 'AAQk1' }], messages: { AAMk1: GRAPH_SERVICE }, conversations: { AAQk1: [GRAPH_SERVICE] }, categories: [], ...graph };
  const dmock = makeDriveMock(drive.files || []);
  const { fetchImpl: routed, hits } = makeFetch([...gmailRoutes(gstate), ...graphRoutes(ostate)]);
  const fetchImpl = async (url, init) => (await dmock.fetchImpl(url, init)) || routed(url, init);
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
  const h = createEmailAgentHandler({ getClient: async () => client, fetchImpl, now: () => clock, nowMs: () => ms, budgetMs, sleep: async () => {}, taxFilingEnabled, ownerIds: new Set(['ga', 'gw']) });
  const call = async (body, u = user) => {
    const r = await h(new Request('https://test.local/emailAgent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const as = (u) => { user = u; return { call: (body) => call(body, u) }; };
  return { call, as, store, calls, hits, llm, gstate, ostate, drive: dmock, setClock: (v) => { clock = v; }, tick: (n) => { ms += n; } };
}

const thread = (h, threadId) => h.store.EmailRelay.find((t) => t.thread_id === threadId);

// ---- tests ---------------------------------------------------------------------------------------------------

test('auth: sync is owner-only and fail-closed — anonymous (null user) is rejected before any read; a forged scheduler flag does not bypass it', async () => {
  const h = harness();
  // anonymous (null user) sync is rejected BEFORE any mailbox/entity/provider read
  const before = h.calls.length;
  const anon = await h.as(null).call({ action: 'sync' });
  assert.equal(anon.status, 401);
  assert.equal(anon.body.ok, false);
  assert.equal(h.calls.length, before, 'no mailbox/entity/provider read before the null-user reject');
  // a forged scheduler flag in the body does NOT bypass the null-user reject
  const forged = await h.as(null).call({ action: 'sync', scheduler: true, scheduled: true, source: 'workflow', run_id: 'r1' });
  assert.equal(forged.status, 401);
  assert.equal(forged.body.ok, false);
  // owner manual sync still works
  const r = await h.as(OWNER).call({ action: 'sync' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  // non-owner roles are denied on sync
  assert.equal((await h.as(CREW).call({ action: 'sync' })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'sync' })).status, 403);
  assert.equal((await h.as(ADMIN).call({ action: 'sync' })).status, 403);
  // unrelated action validation + non-existent send action (pre-auth, user-independent)
  assert.equal((await h.call({ action: 'bogus' })).status, 400);
  assert.equal((await h.call({ action: 'send_draft', id: 'x' })).status, 400, 'the agent has no send action at all');
  // list/entry stay owner-only; crew and unauthenticated are denied
  assert.equal((await h.as(CREW).call({ action: 'list' })).status, 403);
  assert.equal((await h.as(null).call({ action: 'list' })).status, 401);
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

test('sync: when the connector was authorized as a different account, the mailbox row takes that address and the run says so', async () => {
  const h = harness({ gmail: { me: 'gabefronk@gmail.com' } });
  const r = await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  const gf = r.body.mailboxes[0];
  assert.equal(gf.status, 'ok');
  assert.ok(gf.errors.some((e) => /authorized as gabefronk@gmail.com, not gabriel.fronk.wd@gmail.com/.test(e)));
  assert.equal(h.store.EmailMailbox.find((m) => m.key === 'gf-gmail').address, 'gabefronk@gmail.com');
  const h2 = harness();
  const r2 = await h2.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  assert.ok(!r2.body.mailboxes[0].errors.some((e) => /authorized as/.test(e)));
  assert.equal(h2.store.EmailMailbox.find((m) => m.key === 'gf-gmail').address, 'gabriel.fronk.wd@gmail.com');
});

test('rerun: flags an entry pending; the next sync re-reads it and relays without duplicating the note or to-do', async () => {
  const h = harness({ user: OWNER });
  await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  const before = thread(h, 't1');
  assert.ok(before.note_id); assert.equal(h.store.TodoTask.length, 1);
  assert.equal((await h.as(CREW).call({ action: 'rerun', id: before.id })).status, 403);
  const r = await h.as(OWNER).call({ action: 'rerun', id: before.id });
  assert.equal(r.status, 200);
  assert.equal(thread(h, 't1').triage_pending, true);
  const h2 = harness({ seed: { EmailRelay: h.store.EmailRelay, EmailMailbox: h.store.EmailMailbox, JobNotes: h.store.JobNotes, TodoTask: h.store.TodoTask }, gmail: { history: [] } });
  const r2 = await h2.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  assert.equal(r2.body.mailboxes[0].classified, 1);
  assert.equal(thread(h2, 't1').triage_pending, false);
  assert.equal(thread(h2, 't1').note_id, before.note_id);
  assert.equal(h2.store.JobNotes.length, 1); assert.equal(h2.store.TodoTask.length, 1);
});

test('list / entry: owner-only (id-based) — managers, crew and non-owner admins get 403; owner (both ids) sees both mailboxes; filters and q work; entries carry no mail text', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  // Owner's ruling: no manager reads any mailbox (incl. the former 'managers'-visibility YA Outlook).
  assert.equal((await h.as(MANAGER).call({ action: 'list' })).status, 403);
  assert.equal((await h.as(CREW).call({ action: 'list' })).status, 403);
  assert.equal((await h.as(null).call({ action: 'list' })).status, 401);
  assert.equal((await h.as(MANAGER).call({ action: 'list', mailbox_key: 'gf-gmail' })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'list', mailbox_key: 'nope' })).status, 403, 'gate fires before the mailbox lookup');
  // owner-only mailbox stays restricted to the owner emails even among admins
  assert.equal((await h.as(ADMIN).call({ action: 'list', mailbox_key: 'gf-gmail' })).status, 403, 'non-owner admin is not the owner');
  // a non-owner admin is denied (email is owner-only, not admin-only)
  const adm = await h.as(ADMIN).call({ action: 'list' });
  assert.equal(adm.status, 403);
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
  assert.equal((await h.as(MANAGER).call({ action: 'entry', id: t1.id })).status, 403, 'managers cannot read any entry');
  assert.equal((await h.as(CREW).call({ action: 'entry', id: t1.id })).status, 403);
  assert.equal((await h.as(null).call({ action: 'entry', id: t1.id })).status, 401);
  assert.equal((await h.as(ADMIN).call({ action: 'entry', id: t1.id })).status, 403, 'non-owner admin is denied at the owner-id gate before the mailbox lookup');
  const ya = thread(h, 'AAQk1');
  assert.equal((await h.as(ADMIN).call({ action: 'entry', id: ya.id })).status, 403, 'non-owner admin cannot read the YA mailbox (owner-only)');
  assert.equal((await h.as(MANAGER).call({ action: 'entry', id: ya.id })).status, 403, 'managers cannot read the YA mailbox either');
});

test('auth regression: every disclosing action denies manager, crew, non-owner admin and unauthenticated; sync stays owner/scheduled-only', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  const ya = thread(h, 'AAQk1');
  const disclosing = [
    { action: 'list' },
    { action: 'entry', id: ya.id },
    { action: 'set_status', id: ya.id, status: 'done' },
    { action: 'rerun', id: ya.id },
    { action: 'set_category', id: ya.id, category: 'schedule' },
    { action: 'link_job', id: ya.id, job_id: 'job2' },
    { action: 'unlink_job', id: ya.id },
    { action: 'discard_draft', id: ya.id },
    { action: 'regenerate_draft', id: ya.id },
    { action: 'archive', id: ya.id },
  ];
  for (const payload of disclosing) {
    assert.equal((await h.as(MANAGER).call(payload)).status, 403, `manager denied ${payload.action}`);
    assert.equal((await h.as(CREW).call(payload)).status, 403, `crew denied ${payload.action}`);
    assert.equal((await h.as(null).call(payload)).status, 401, `unauthenticated denied ${payload.action}`);
  }
  // sync is owner-only and fail-closed; manager, crew, non-owner admin and anonymous are denied
  assert.equal((await h.as(MANAGER).call({ action: 'sync' })).status, 403);
  assert.equal((await h.as(CREW).call({ action: 'sync' })).status, 403);
  assert.equal((await h.as(ADMIN).call({ action: 'sync' })).status, 403);
  assert.equal((await h.as(null).call({ action: 'sync' })).status, 401);
  // non-owner admin is denied on every disclosing action (owner-only, not admin-only)
  const adm = await h.as(ADMIN).call({ action: 'set_status', id: ya.id, status: 'done' });
  assert.equal(adm.status, 403);
  // mailboxes / seed_mailboxes stay owner-only
  assert.equal((await h.as(MANAGER).call({ action: 'mailboxes' })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'seed_mailboxes' })).status, 403);
  // non-owner admin is also denied mailboxes/seed
  assert.equal((await h.as(ADMIN).call({ action: 'mailboxes' })).status, 403);
  assert.equal((await h.as(ADMIN).call({ action: 'seed_mailboxes' })).status, 403);
});

test('owner ids: both Gabriel auth ids are allowed on every disclosing route; anonymous sync is rejected (fail-closed)', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  const ya = thread(h, 'AAQk1');
  const t1 = thread(h, 't1');
  // both owner ids can list, entry, and run every disclosing action
  for (const owner of [OWNER, OWNER_WD]) {
    const list = await h.as(owner).call({ action: 'list' });
    assert.equal(list.status, 200, `${owner.email} can list`);
    const entry = await h.as(owner).call({ action: 'entry', id: ya.id });
    assert.equal(entry.status, 200, `${owner.email} can read an entry`);
    const mb = await h.as(owner).call({ action: 'mailboxes' });
    assert.equal(mb.status, 200, `${owner.email} can read mailboxes`);
    const st = await h.as(owner).call({ action: 'set_status', id: ya.id, status: 'done' });
    assert.equal(st.status, 200, `${owner.email} can set_status`);
  }
  // anonymous (null user) sync is rejected (fail-closed) — never left anonymous
  const sched = await h.as(null).call({ action: 'sync' });
  assert.equal(sched.status, 401);
  assert.equal(sched.body.ok, false);
  // a non-owner admin (Trevor) is denied on every disclosing route
  const disclosing = [
    { action: 'list' },
    { action: 'entry', id: ya.id },
    { action: 'set_status', id: ya.id, status: 'done' },
    { action: 'rerun', id: ya.id },
    { action: 'set_category', id: ya.id, category: 'schedule' },
    { action: 'link_job', id: ya.id, job_id: 'job2' },
    { action: 'unlink_job', id: ya.id },
    { action: 'discard_draft', id: ya.id },
    { action: 'regenerate_draft', id: ya.id },
    { action: 'archive', id: ya.id },
    { action: 'mailboxes' },
    { action: 'seed_mailboxes' },
  ];
  for (const payload of disclosing) {
    assert.equal((await h.as(ADMIN).call(payload)).status, 403, `non-owner admin denied ${payload.action}`);
  }
  // Israel (admin, not an email owner id) is denied too
  const israelAdmin = { id: '6a9f1c6b0c0b0a503245bcd6', email: 'iryedra@gmail.com', role: 'admin', full_name: 'Israel' };
  assert.equal((await h.as(israelAdmin).call({ action: 'list' })).status, 403, 'Israel admin denied email list');
  assert.equal((await h.as(israelAdmin).call({ action: 'entry', id: t1.id })).status, 403, 'Israel admin denied email entry');
});

test('mutations: set_status / set_category / link_job (applies facts + relays) / unlink_job / discard / regenerate (re-reads the mailbox) / archive — admin only', async () => {
  const h = harness();
  await h.call({ action: 'sync' });
  const ya = thread(h, 'AAQk1');
  // managers are denied every mutating action on the YA thread (owner's ruling)
  assert.equal((await h.as(MANAGER).call({ action: 'set_status', id: ya.id, status: 'done' })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'link_job', id: ya.id, job_id: 'job2' })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'archive', id: ya.id })).status, 403);
  // set_status by the owner on the YA thread
  const st = await h.as(OWNER).call({ action: 'set_status', id: ya.id, status: 'done' });
  assert.equal(st.status, 200);
  assert.equal(thread(h, 'AAQk1').status, 'done');
  assert.equal(thread(h, 'AAQk1').reply_needed, false);
  assert.equal((await h.as(OWNER).call({ action: 'set_status', id: ya.id, status: 'nah' })).status, 400);
  // set_category relabels in the provider (Outlook needs the message ids: re-read from Graph)
  const sc = await h.as(OWNER).call({ action: 'set_category', id: ya.id, category: 'schedule' });
  assert.equal(sc.status, 200);
  assert.equal(thread(h, 'AAQk1').category, 'schedule');
  const lastPatch = h.hits.filter((x) => x.method === 'PATCH' && /messages\/AAMk1$/.test(x.url)).pop();
  assert.deepEqual(lastPatch.body.categories, ['Hub', 'Hub/Schedule']);
  // link_job on the unlinked YA thread relays a note; relinking does not duplicate; unlink clears the link only
  assert.equal((await h.as(OWNER).call({ action: 'link_job', id: ya.id, job_id: 'missing' })).status, 404);
  const notesBefore = h.store.JobNotes.length;
  const lk = await h.as(OWNER).call({ action: 'link_job', id: ya.id, job_id: 'job2' });
  assert.equal(lk.status, 200);
  assert.equal(thread(h, 'AAQk1').job_id, 'job2');
  assert.equal(thread(h, 'AAQk1').job_link_source, 'owner');
  assert.equal(h.store.JobNotes.length, notesBefore + 1);
  assert.equal(h.store.JobNotes.at(-1).author, 'Inbox agent · YA Install (Outlook)');
  assert.ok(thread(h, 'AAQk1').note_id);
  assert.deepEqual(thread(h, 'AAQk1').hub_changes, ['To-do created', 'Note added to Summit Creek 14']);
  await h.as(OWNER).call({ action: 'link_job', id: ya.id, job_id: 'job2' });
  assert.equal(h.store.JobNotes.length, notesBefore + 1, 'relinking does not duplicate the note');
  const ul = await h.as(OWNER).call({ action: 'unlink_job', id: ya.id });
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
  const dc = await h.as(OWNER).call({ action: 'discard_draft', id: ya.id });
  assert.equal(dc.status, 200);
  assert.equal(thread(h, 'AAQk1').draft_status, 'discarded');
  assert.ok(h.hits.some((x) => x.method === 'DELETE' && /messages\/draft-o1$/.test(x.url)));
  assert.equal((await h.as(OWNER).call({ action: 'discard_draft', id: ya.id })).status, 409);
  const reads = h.hits.filter((x) => x.url.includes('/me/messages?')).length;
  const rg = await h.as(OWNER).call({ action: 'regenerate_draft', id: ya.id });
  assert.equal(rg.status, 200);
  assert.equal(rg.body.entry.draft_status, 'drafted');
  assert.equal(rg.body.entry.draft_id, 'draft-o1');
  assert.equal('draft_preview' in rg.body.entry, false);
  assert.equal(h.hits.filter((x) => x.url.includes('/me/messages?')).length, reads + 1);
  // archive action (owner) on the YA thread moves incoming messages
  const ar = await h.as(OWNER).call({ action: 'archive', id: ya.id });
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

// ---- Wasatch Windows ACH confirmation filing to Drive -----------------------------------------
const HELCIM_FROM = 'Wasatch windows llc <donotreply@app.helcim.com>';
const ACH_TEXT = 'Wasatch Windows LLC\nInvoice INV001186 has been paid.\nAmount Paid: $7,787.92\nPayment Method: ACH (bank account ending 6612)';
const helcim = (id, subject, text, extra = {}) => gmailMessage({ id: `m-${id}`, threadId: `t-${id}`, from: HELCIM_FROM, to: 'gabefronk@gmail.com', subject, text, internalDate: AT(15), ...extra });
const PAID = helcim('paid', 'Invoice - INV001186 (PAID)', ACH_TEXT, { attachments: [
  { name: 'INV001186.pdf', mime: 'application/pdf', size: 40_000, attachment_id: 'attH' },
  { name: 'helcim-logo.png', mime: 'image/png', size: 60_000, attachment_id: 'attLogo' },
  { name: 'banner.jpg', mime: 'image/jpeg', size: 80_000, attachment_id: 'attInline', headers: [{ name: 'Content-ID', value: '<img1>' }] },
] });
const mailOf = (...msgs) => ({ scan: msgs.map((m) => ({ id: m.id, threadId: m.threadId })), messages: Object.fromEntries(msgs.map((m) => [m.id, m])), threads: Object.fromEntries(msgs.map((m) => [m.threadId, [m]])) });
const DRIVE_ON = { gmail: { accessToken: 'g-token' }, outlook: { accessToken: 'o-token' }, googledrive: { accessToken: 'd-token' } };
const paidMail = mailOf(PAID);

test('tax: a Wasatch ACH paid confirmation is filed to Drive/Taxes/2026 as a Doc + only its PDF; never twice; no body in the Hub', async () => {
  const h = harness({ gmail: paidMail, connections: DRIVE_ON });
  const r = await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  assert.equal(r.body.mailboxes[0].status, 'ok');
  const row = thread(h, 't-paid');
  assert.deepEqual([row.tax_record, row.vendor, row.reference, row.amount_total, row.receipt_date], [true, 'Wasatch Windows LLC', 'INV001186', 7787.92, '2026-09-26']);
  assert.equal(row.tax_save_state, 'saved');
  assert.equal(row.tax_lock_id, '');
  for (const k of ['text', 'snippet', 'body', 'attachments']) assert.equal(k in row, false, `${k} never lands in the Hub row`);
  assert.deepEqual(h.drive.folders().map((f) => f.name), ['Taxes', '2026']);
  const [doc] = h.drive.byKind('doc');
  assert.equal(row.drive_file_id, doc.id);
  assert.equal(doc.name, '2026-09-26 Wasatch Windows LLC - $7787.92 - INV001186');
  assert.deepEqual(h.drive.byKind('attachment').map((f) => f.name), ['INV001186.pdf'], 'logo and inline banner stay in the mailbox');
  const creates = h.drive.state.creates.length;
  h.gstate.history = [];
  await h.call({ action: 'sync', mailbox_key: 'gf-gmail', fresh: true });
  assert.equal(h.drive.state.creates.length, creates, 'never filed twice');
});

test('tax: other merchants, upcoming / agreement / request notices, card payments and spoofed senders are never filed', async () => {
  const msgs = [
    helcim('up', 'You have an upcoming payment to Wasatch windows llc', 'Wasatch Windows LLC will withdraw $7,787.92 from your bank account by ACH on 2026-10-06.'),
    helcim('agr', 'Confirmation of ACH Payment Agreement with Wasatch windows llc', 'Wasatch Windows LLC ACH agreement confirmed.'),
    helcim('req', 'New Payment Request', 'Wasatch Windows LLC sent invoice INV001186 for $7,787.92. Pay by ACH.'),
    helcim('other', 'Invoice - INV000500 (PAID)', 'Acme Glass Supply\nAmount Paid: $50.00\nPayment Method: ACH'),
    helcim('card', 'Invoice - INV001184 (PAID)', 'Wasatch Windows LLC\nAmount Paid: $84.00\nPaid with Visa ending 4242'),
    gmailMessage({ id: 'm-spoof', threadId: 't-spoof', from: 'Wasatch windows llc <billing@wasatch-pay.com>', subject: 'Invoice - INV001186 (PAID)', text: ACH_TEXT, internalDate: AT(15) }),
  ];
  const h = harness({ gmail: mailOf(...msgs), connections: DRIVE_ON });
  await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  for (const id of ['up', 'agr', 'req', 'other', 'card', 'spoof']) assert.notEqual(thread(h, `t-${id}`).tax_record, true, id);
  assert.equal(h.drive.state.finds + h.drive.state.creates.length, 0, 'no Drive call at all');
});

// Source-observed template (work Gmail, INV001186): bank withdrawal approved, $0 due, no attachment.
const OBSERVED = helcim('obs', 'Invoice - INV001186 (PAID)', 'Wasatch windows llc\nInvoice INV001186\nPaid Oct 6, 2026\nBANK Withdrawal APPROVED\nAmount Paid: $ 7,787.92\nAmount Due $ 0.00');

test('tax: the observed bank-approved template (exact spaced layout) is filed as a body Doc only; amount 7787.92', async () => {
  const h = harness({ gmail: mailOf(OBSERVED), connections: DRIVE_ON });
  await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  const row = thread(h, 't-obs');
  assert.equal(row.tax_save_state, 'saved');
  assert.equal(row.reference, 'INV001186');
  assert.equal(row.amount_total, 7787.92, 'spaced "$ 7,787.92" parses to 7787.92');
  assert.equal(h.drive.byKind('doc').length, 1);
  assert.equal(h.drive.byKind('attachment').length, 0);
});

test('tax: explicit false override holds filing (match reported in warnings, nothing filed or written)', async () => {
  const h = harness({ gmail: mailOf(OBSERVED), connections: DRIVE_ON, taxFilingEnabled: false });
  const r = await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  assert.ok(r.body.mailboxes[0].errors.some((e) => /tax filing disabled for this run.*INV001186/.test(e)), 'not silent');
  assert.notEqual(thread(h, 't-obs').tax_record, true);
  assert.equal(h.drive.state.finds + h.drive.state.creates.length, 0);
  assert.equal((await h.as(OWNER).call({ action: 'save_tax_record', id: thread(h, 't-obs').id })).status, 409);
});

test('tax: Drive not connected -> failed, the sync still succeeds, and the next run retries and saves', async () => {
  const h = harness({ gmail: paidMail });
  const r = await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  assert.equal(r.body.mailboxes[0].status, 'ok');
  assert.equal(thread(h, 't-paid').tax_save_state, 'failed');
  assert.match(thread(h, 't-paid').tax_save_error, /not connected/);
  const h2 = harness({ seed: { EmailRelay: h.store.EmailRelay, EmailMailbox: h.store.EmailMailbox }, gmail: { history: [], threads: paidMail.threads }, connections: DRIVE_ON });
  await h2.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  assert.equal(thread(h2, 't-paid').tax_save_state, 'saved', 'saved on the retry scan');
});

test('tax: an unknown doc-create outcome is never retried automatically; only an admin confirm on that unknown row re-creates', async () => {
  const h = harness({ gmail: paidMail, connections: DRIVE_ON });
  h.drive.state.faults.push({ kind: 'doc', mode: '503' });
  await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  const row = thread(h, 't-paid');
  assert.equal(row.tax_save_state, 'unknown');
  const docCreates = () => h.drive.state.creates.filter((c) => c.kind === 'doc').length;
  h.gstate.history = [];
  await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  assert.equal(docCreates(), 1, 'retry scan only looks it up');
  assert.equal((await h.as(OWNER).call({ action: 'save_tax_record', id: row.id })).body.ok, false);
  assert.equal(docCreates(), 1, 'save without confirm stays read-only');
  assert.equal((await h.as(OWNER).call({ action: 'save_tax_record', id: row.id, confirm_recreate: true })).body.ok, true);
  assert.equal(docCreates(), 2);
  await h.as(OWNER).call({ action: 'save_tax_record', id: row.id, confirm_recreate: true });
  assert.equal(docCreates(), 2, 'confirm on a saved row is not a reset');
});

test('tax permissions: managers and non-owner admins never see or save owner-mailbox tax rows; non-matching threads are refused', async () => {
  const h = harness({ gmail: mailOf(PAID, GMAIL_PROMO), connections: DRIVE_ON });
  await h.call({ action: 'sync', mailbox_key: 'gf-gmail' });
  const paid = thread(h, 't-paid');
  const promo = thread(h, 't3');
  // Main's admin-only server gating: managers are denied (403) on every disclosing action,
  // not handed a filtered list or a 404. Only the owner (and the non-owner admin for non-owner
  // mailboxes) can read; the owner mailbox stays owner-only even for other admins.
  assert.equal((await h.as(MANAGER).call({ action: 'list' })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'entry', id: paid.id })).status, 403);
  assert.equal((await h.as(MANAGER).call({ action: 'save_tax_record', id: paid.id })).status, 403);
  assert.equal((await h.as(ADMIN).call({ action: 'entry', id: paid.id })).status, 403);
  assert.equal((await h.as(ADMIN).call({ action: 'save_tax_record', id: paid.id })).status, 403);
  assert.equal((await h.as(OWNER).call({ action: 'save_tax_record', id: promo.id })).status, 409, 'only a Wasatch ACH confirmation can be filed');
  assert.equal(h.drive.byKind('doc').length, 1);
});