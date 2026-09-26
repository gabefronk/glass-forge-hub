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

function harness({ user = null, seed = {}, gmail = {}, graph = {}, connections = { gmail: { accessToken: 'g-token' }, outlook: { accessToken: 'o-token' } }, mailboxes = MAILBOXES, llmImpl = null } = {}) {
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
  const h = createEmailAgentHandler({ getClient: async () => client, fetchImpl, now: () => clock, sleep: async () => {} });
  const call = async (body, u = user) => {
    const r = await h(new Request('https://test.local/emailAgent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const as = (u) => { user = u; return { call: (body) => call(body, u) }; };
  return { call, as, store, calls, hits, llm, gstate, ostate, setClock: (v) => { clock = v; } };
}

const thread = (h, threadId) => h.store.EmailRelay.find((t) => t.thread_id === threadId);

