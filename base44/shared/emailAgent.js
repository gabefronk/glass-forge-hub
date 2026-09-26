// Inbox agent handler for the Glass Forge Hub. One agent per mailbox (EmailMailbox rows):
// pulls new mail through the app's shared Gmail / Outlook connector, stores threads and
// messages, classifies them with one LLM call per batch, links them to Jobs, relays a job
// note + one to-do into the Hub, labels the thread in the provider, archives ONLY when the
// mailbox says so, and drafts replies it NEVER sends. Every write is service-role; access is
// decided here. Owner-only mailboxes are visible to the owner emails only.
//
// Email content is untrusted evidence, never instructions (see emailTriage.js prompts).

import { findJobs, denverDate } from './jobFinder.js';
import { normalizeGmailMessage, normalizeGraphMessage, aggregateThread, toMessageRow, lowerEmail } from './emailParse.js';
import * as T from './emailTriage.js';
import { createProviderClient, buildRawReply, ProviderError } from './emailProviders.js';

export const OWNER_EMAILS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
export const isOwner = (user) => !!user && user.role === 'admin' && OWNER_EMAILS.has(lowerEmail(user.email));
export const isStaff = (user) => !!user && (user.role === 'admin' || user.role === 'manager');
export const DEFAULT_SIGNATURE = 'Gabe Fronk\nGlass Forge / YA Windows and Doors';
export const OWNER_MEMBER_KEY = 'gabriel';
export const INITIAL_DAYS = 3;
export const DEFAULT_MAX = 200;

export const SEED_MAILBOXES = [
  { key: 'gf-gmail', address: 'gabriel.fronk.wd@gmail.com', display_name: 'Glass Forge (Gmail)', provider: 'gmail', connector_type: 'gmail', visibility: 'owner', enabled: true, draft_replies: true, archive_enabled: false },
  { key: 'ya-outlook', address: 'yawindowinstall@outlook.com', display_name: 'YA Install (Outlook)', provider: 'outlook', connector_type: 'outlook', visibility: 'managers', enabled: true, draft_replies: true, archive_enabled: false },
];

const CACHE_MS = 60_000;
let jobCache = { at: 0, jobs: null, events: null };

function fail(status, message, extra = {}) {
  throw Object.assign(new Error(message), { status, ...extra });
}
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const idText = (v) => { const s = String(v ?? '').trim(); if (!s || s.length > 200) fail(400, 'Invalid id.'); return s; };
const errText = (e) => String(e?.message || e || 'error').slice(0, 300);

async function allPages(entity, sort) {
  const out = [];
  for (let skip = 0; skip < 50000; skip += 1000) {
    const page = await entity.list(sort, 1000, skip);
    out.push(...page);
    if (page.length < 1000) return out;
  }
  return out;
}

async function loadJobIndex(api, fresh = false) {
  if (!fresh && jobCache.jobs && Date.now() - jobCache.at < CACHE_MS) return jobCache;
  const [jobs, events] = await Promise.all([allPages(api.Jobs, '-created_date'), allPages(api.CalendarEvents, '-event_date')]);
  jobCache = { at: Date.now(), jobs, events };
  return jobCache;
}
export const resetJobCache = () => { jobCache = { at: 0, jobs: null, events: null }; };

// Money-free job facts for the draft writer (address + next visit).
function jobFactsFor(jobId, index, today) {
  const job = (index.jobs || []).find((j) => j.id === jobId);
  if (!job) return null;
  const evs = (index.events || []).filter((e) => e.job_id === jobId && e.source_status !== 'cancelled').sort((a, b) => String(a.event_date || '').localeCompare(String(b.event_date || '')));
  const safe = (e) => ({ date: e.event_date, start_time: e.start_time || null, title: e.job_name || '' });
  const addr = job.address || evs.map((e) => e.address || e.source_location).find(Boolean) || null;
  return { name: job.canonical_name, builder: job.builder || null, address: addr, next_visits: evs.filter((e) => (e.event_date || '') >= today).slice(0, 3).map(safe), recent_visits: evs.filter((e) => (e.event_date || '') < today).slice(-3).reverse().map(safe) };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export function publicMailbox(m) {
  return { id: m.id, key: m.key, address: m.address, display_name: m.display_name, provider: m.provider, visibility: m.visibility || 'managers', enabled: m.enabled !== false, archive_enabled: m.archive_enabled === true, draft_replies: m.draft_replies !== false, auto_archive_categories: m.auto_archive_categories || [], last_synced_at: m.last_synced_at || null, last_error: m.last_error || '', last_run: m.last_run || null };
}

const canSeeMailbox = (mailbox, user) => (mailbox?.visibility === 'owner' ? isOwner(user) : isStaff(user));

export function createEmailAgentHandler({ getClient, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), budgetMs = 50_000, sleep } = {}) {
  if (typeof getClient !== 'function') throw new Error('emailAgent: getClient is required');

  // ---- shared helpers ------------------------------------------------------------------------

  async function loadMailboxes(api) { return (await api.EmailMailbox.list('key', 50)) || []; }

  async function mailboxByKey(api, key) {
    const rows = await api.EmailMailbox.filter({ key }, 'key', 1);
    return rows[0] || null;
  }

  async function connect(ctx, mailbox) {
    let conn;
    try { conn = await ctx.connectors.getConnection(mailbox.connector_type || mailbox.provider); } catch (e) { fail(502, 'not_connected', { detail: errText(e) }); }
    if (!conn || !conn.accessToken) fail(502, 'not_connected');
    return createProviderClient(mailbox.provider, { accessToken: conn.accessToken, fetchImpl, sleep });
  }

  async function threadForUser(ctx, id) {
    let thread;
    try { thread = await ctx.api.EmailThread.get(idText(id)); } catch { thread = null; }
    if (!thread) fail(404, 'Thread not found.');
    const mailbox = await mailboxByKey(ctx.api, thread.mailbox_key);
    if (!mailbox || !canSeeMailbox(mailbox, ctx.user)) fail(404, 'Thread not found.');
    return { thread, mailbox };
  }

  async function threadMessages(api, thread) {
    const rows = await api.EmailMessage.filter({ mailbox_key: thread.mailbox_key, thread_id: thread.thread_id }, 'sent_at', 200);
    return rows.sort((a, b) => String(a.sent_at || '').localeCompare(String(b.sent_at || '')));
  }

  async function relayNote(api, thread, mailbox) {
    if (!T.shouldRelay(thread)) return null;
    const note = await api.JobNotes.create(T.buildNotePayload(thread, mailbox));
    return { note_id: note.id, relayed_at: now() };
  }

  async function ownerMemberId(api, warn) {
    const rows = await api.TeamMember.filter({ member_key: OWNER_MEMBER_KEY }, 'id', 1);
    if (!rows[0]) { warn(`TeamMember '${OWNER_MEMBER_KEY}' missing; to-dos skipped`); return null; }
    return rows[0].id;
  }

  async function createTodo(api, thread, mailbox, assigneeMemberId) {
    if (!T.shouldCreateTodo(thread)) return null;
    const key = T.todoRequestKey(mailbox.key, thread.thread_id);
    const existing = await api.TodoTask.filter({ request_key: key }, 'id', 1);
    if (existing[0]) return { todo_ids: [existing[0].id] };
    const created = await api.TodoTask.create(T.buildTodoPayload(thread, mailbox, { assigneeMemberId, now: now() }));
    return { todo_ids: [created.id] };
  }

  // Ensure "Hub" + "Hub/<Category>" exist in the provider and apply them to the thread.
  async function labelThread(provider, mailbox, thread, messages) {
    const names = T.labelNamesFor(thread.category);
    const map = await provider.ensureLabels(names, mailbox.labels || {});
    mailbox.labels = map;
    const hubIds = new Set(T.ALL_LABEL_NAMES.map((n) => map[n]).filter(Boolean));
    const wantIds = names.map((n) => map[n]).filter(Boolean);
    if (mailbox.provider === 'gmail') {
      const current = thread.provider_labels || [];
      const remove = current.filter((id) => hubIds.has(id) && !wantIds.includes(id));
      await provider.modifyThread(thread.thread_id, { addLabelIds: wantIds, removeLabelIds: remove });
      return { provider_labels: [...new Set([...current.filter((id) => !remove.includes(id)), ...wantIds])] };
    }
    const hubNames = new Set(T.ALL_LABEL_NAMES);
    let merged = [];
    for (const m of messages) {
      const keep = (m.labels || []).filter((n) => !hubNames.has(n));
      merged = [...new Set([...keep, ...names])];
      await provider.setCategories(m.message_id, merged);
    }
    return { provider_labels: merged.length ? merged : names };
  }

  async function archiveInProvider(provider, mailbox, thread, messages) {
    if (mailbox.provider === 'gmail') await provider.archiveThread(thread.thread_id);
    else for (const m of messages) if (m.direction === 'incoming') await provider.archiveMessage(m.message_id);
    return { archived: true, provider_labels: (thread.provider_labels || []).filter((l) => l !== 'INBOX') };
  }

  async function generateDraft(ctx, mailbox, provider, thread, messages, jobFacts) {
    const lastIncoming = [...messages].reverse().find((m) => m.direction === 'incoming') || messages[messages.length - 1];
    if (!lastIncoming) fail(409, 'Nothing to reply to.');
    const result = await ctx.core.InvokeLLM(T.buildDraftPrompt(thread, messages, mailbox, jobFacts));
    const text = T.cleanDraftReply(result, mailbox);
    if (!text.trim()) fail(502, 'Empty draft from the model.');
    let draft;
    if (mailbox.provider === 'gmail') {
      const raw = buildRawReply({ to: lastIncoming.from_email ? [lastIncoming.from_email] : [], subject: T.replySubject(thread.subject), inReplyTo: lastIncoming.internet_message_id || '', references: lastIncoming.references || '', text });
      draft = await provider.createDraft({ threadId: thread.thread_id, raw });
    } else {
      draft = await provider.createDraftReply({ messageId: lastIncoming.message_id, text });
    }
    return { draft_id: draft.draft_id || '', draft_preview: text, draft_status: 'drafted' };
  }

  async function discardInProvider(provider, thread) {
    if (!thread.draft_id) return;
    try { await provider.deleteDraft(thread.draft_id); } catch (e) { if (!(e instanceof ProviderError && e.status === 404)) throw e; }
  }

  // ---- sync -----------------------------------------------------------------------------------

  async function syncMailbox(ctx, mailbox, { fresh = false, max = DEFAULT_MAX } = {}) {
    const api = ctx.api;
    const counts = { fetched: 0, threads_updated: 0, classified: 0, relayed: 0, drafted: 0, archived: 0, errors: [] };
    const warn = (msg) => { if (counts.errors.length < 40) counts.errors.push(String(msg).slice(0, 300)); };
    const startedAt = now();
    const run = await api.EmailAgentRun.create({ mailbox_key: mailbox.key, started_at: startedAt, status: 'running', ...counts });
    const overBudget = () => Date.now() - ctx.started > budgetMs;
    const finish = async (status, lastError = '') => {
      const finished = now();
      try { await api.EmailAgentRun.update(run.id, { ...counts, status, finished_at: finished }); } catch { /* best effort */ }
      const patch = { last_synced_at: finished, last_error: lastError, last_run: { at: finished, status, ...counts }, labels: mailbox.labels || {} };
      if (mailbox._cursor !== undefined) {
        if (mailbox.provider === 'gmail') patch.last_history_id = mailbox._cursor;
        else patch.last_delta_link = mailbox._cursor;
      }
      try { await api.EmailMailbox.update(mailbox.id, patch); } catch (e) { warn(`mailbox update failed: ${errText(e)}`); }
      return { mailbox_key: mailbox.key, status, error: lastError || undefined, ...counts };
    };

    let provider;
    try { provider = await connect(ctx, mailbox); } catch (e) { warn(`not connected: ${e.detail || e.message}`); return finish('error', 'not_connected'); }

    // 1. Pull new mail since the cursor.
    let listed;
    try {
      listed = await provider.listNewMessages(mailbox.provider === 'gmail'
        ? { historyId: fresh ? '' : (mailbox.last_history_id || ''), sinceDays: INITIAL_DAYS, max }
        : { deltaLink: fresh ? '' : (mailbox.last_delta_link || ''), sinceDays: INITIAL_DAYS, max });
    } catch (e) { warn(`list failed: ${errText(e)}`); return finish('error', `list_failed: ${errText(e)}`.slice(0, 200)); }

    const normalize = mailbox.provider === 'gmail' ? normalizeGmailMessage : normalizeGraphMessage;
    const fetched = [];
    let fetchErrors = 0;
    await pool(listed.ids, 4, async (ref) => {
      try {
        const raw = await provider.getMessage(ref.id);
        const m = normalize(raw, { mailboxAddress: mailbox.address });
        if (m.message_id && m.thread_id && !m.is_draft) fetched.push(m);
      } catch (e) {
        if (e instanceof ProviderError && e.status === 404) return; // deleted since listing
        fetchErrors++; warn(`get ${ref.id} failed: ${errText(e)}`);
      }
    });
    counts.fetched = fetched.length;
    // Only advance the cursor once everything listed was fetched and stored.
    const advanceCursor = fetchErrors === 0;

    // 2. Upsert messages and threads.
    const byThread = new Map();
    for (const m of fetched) { if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []); byThread.get(m.thread_id).push(m); }
    const threadIds = [...byThread.keys()];
    const existingMsgs = new Map(); // thread_id -> rows
    const existingThreads = new Map();
    for (const ids of chunk(threadIds, 40)) {
      const [msgs, ths] = await Promise.all([
        api.EmailMessage.filter({ mailbox_key: mailbox.key, thread_id: { $in: ids } }, 'sent_at', 1000),
        api.EmailThread.filter({ mailbox_key: mailbox.key, thread_id: { $in: ids } }, '-last_message_at', 500),
      ]);
      for (const r of msgs) { if (!existingMsgs.has(r.thread_id)) existingMsgs.set(r.thread_id, []); existingMsgs.get(r.thread_id).push(r); }
      for (const t of ths) existingThreads.set(t.thread_id, t);
    }

    const work = new Map(); // thread_id -> { thread, messages, hasNewIncoming }
    const toCreateMsgs = [];
    for (const [threadId, newMsgs] of byThread) {
      const prevMsgs = existingMsgs.get(threadId) || [];
      const known = new Set(prevMsgs.map((r) => r.message_id));
      const fresh_ = newMsgs.filter((m) => !known.has(m.message_id));
      const rows = fresh_.map((m) => toMessageRow(mailbox.key, m));
      toCreateMsgs.push(...rows);
      const all = [...prevMsgs, ...fresh_].sort((a, b) => String(a.sent_at || '').localeCompare(String(b.sent_at || '')));
      const prev = existingThreads.get(threadId) || null;
      const hasNewIncoming = fresh_.some((m) => m.direction === 'incoming');
      if (prev && !fresh_.length) continue; // nothing new for this thread
      const agg = aggregateThread(all, { mailbox, previous: prev });
      const latest = all[all.length - 1];
      let patch = { ...agg };
      if (!prev) {
        patch = { ...patch, status: 'new', priority: 'normal', reply_needed: false, action_items: [], job_candidates: [], todo_ids: [], draft_status: 'none', archived: false, triage_pending: true };
      } else {
        if (hasNewIncoming) patch.triage_pending = true;
        if (latest && latest.direction === 'outgoing' && (prev.status === 'new' || prev.status === 'needs_reply')) { patch.status = 'waiting'; patch.reply_needed = false; }
        if (prev.archived && hasNewIncoming) patch.archived = false;
      }
      work.set(threadId, { patch, prev, messages: all, hasNewIncoming });
    }
    for (const batch of chunk(toCreateMsgs, 100)) {
      if (batch.length === 1) await api.EmailMessage.create(batch[0]);
      else await api.EmailMessage.bulkCreate(batch);
    }
    const threads = []; // { row, messages, hasNewIncoming }
    for (const [, w] of work) {
      let row;
      if (w.prev) { await api.EmailThread.update(w.prev.id, w.patch); row = { ...w.prev, ...w.patch }; }
      else row = await api.EmailThread.create(w.patch);
      counts.threads_updated++;
      threads.push({ row, messages: w.messages, hasNewIncoming: w.hasNewIncoming });
    }
    if (advanceCursor && listed.cursor) mailbox._cursor = listed.cursor;

    // Threads left pending by an earlier run (budget / LLM hiccup) get another chance.
    try {
      const inRun = new Set(threads.map((t) => t.row.thread_id));
      const leftovers = await api.EmailThread.filter({ mailbox_key: mailbox.key, triage_pending: true }, '-last_message_at', 50);
      for (const t of leftovers) if (!inRun.has(t.thread_id)) threads.push({ row: t, messages: null, hasNewIncoming: true });
    } catch (e) { warn(`leftover scan failed: ${errText(e)}`); }

    // 3. Triage: one LLM call per batch of up to 8 threads.
    const pending = threads.filter((t) => t.row.triage_pending !== false);
    const triaged = [];
    for (const batch of chunk(pending, T.TRIAGE_BATCH)) {
      if (overBudget()) { warn('budget exhausted before triage finished'); break; }
      for (const t of batch) if (!t.messages) { try { t.messages = await threadMessages(api, t.row); } catch { t.messages = []; } }
      const packet = batch.map((t, i) => ({
        key: `t${i}`,
        subject: t.row.subject,
        from: [t.row.from_name, t.row.from_email].filter(Boolean).join(' '),
        account_hint: t.row.account_hint,
        messages: (t.messages || []).slice(-2).map((m) => ({ direction: m.direction, sent_at: m.sent_at, from: [m.from_name, m.from_email].filter(Boolean).join(' '), text: m.text })),
      }));
      let result;
      try { result = await ctx.core.InvokeLLM(T.buildTriagePrompt(packet)); } catch (e) { warn(`triage LLM failed: ${errText(e)}`); continue; }
      const byKey = T.normalizeTriageResult(result, packet.map((p) => p.key));
      for (let i = 0; i < batch.length; i++) {
        const entry = byKey.get(`t${i}`);
        if (!entry) { warn(`no triage result for ${batch[i].row.thread_id}`); continue; }
        const patch = T.applyTriage(batch[i].row, entry, { now: now(), hasNewIncoming: batch[i].hasNewIncoming });
        try { await api.EmailThread.update(batch[i].row.id, patch); } catch (e) { warn(`thread update failed: ${errText(e)}`); continue; }
        batch[i].row = { ...batch[i].row, ...patch };
        counts.classified++;
        triaged.push(batch[i]);
      }
    }

    // 4. Job match, relay, to-do, label, archive, draft.
    let index = null;
    const today = denverDate();
    let assignee; // undefined = not looked up yet, null = missing
    for (const t of triaged) {
      if (overBudget()) { warn('budget exhausted before relay finished'); break; }
      const row = t.row;
      const patch = {};
      let jobFacts = null;
      try {
        if (!row.job_id && row.job_link_source !== 'owner') {
          const query = T.buildJobQuery(row.extracted);
          if (query) {
            index = index || await loadJobIndex(api, fresh);
            const found = findJobs({ query, limit: 5, today }, index.jobs, index.events);
            const link = T.decideJobLink(found);
            patch.job_match_confidence = link.confidence;
            patch.job_candidates = link.candidates;
            if (link.job_id) { patch.job_id = link.job_id; patch.job_link_source = 'agent_match'; jobFacts = link.job; }
          } else if (!row.job_match_confidence) patch.job_match_confidence = 'unmatched';
        } else if (row.job_id) {
          index = index || await loadJobIndex(api, fresh);
          jobFacts = jobFactsFor(row.job_id, index, today);
        }
      } catch (e) { warn(`job match failed: ${errText(e)}`); }
      let cur = { ...row, ...patch };
      try { const r = await relayNote(api, cur, mailbox); if (r) { Object.assign(patch, r); counts.relayed++; cur = { ...cur, ...r }; } } catch (e) { warn(`relay failed: ${errText(e)}`); }
      try {
        if (T.shouldCreateTodo(cur)) {
          if (assignee === undefined) assignee = await ownerMemberId(api, warn);
          if (assignee) { const r = await createTodo(api, cur, mailbox, assignee); if (r) { Object.assign(patch, r); cur = { ...cur, ...r }; } }
        }
      } catch (e) { warn(`todo failed: ${errText(e)}`); }
      try { Object.assign(patch, await labelThread(provider, mailbox, cur, t.messages || [])); cur = { ...cur, ...patch }; } catch (e) { warn(`label failed: ${errText(e)}`); }
      try { if (T.shouldArchive(cur, mailbox)) { Object.assign(patch, await archiveInProvider(provider, mailbox, cur, t.messages || [])); cur = { ...cur, ...patch }; counts.archived++; } } catch (e) { warn(`archive failed: ${errText(e)}`); }
      try { if (T.shouldDraft(cur, mailbox)) { Object.assign(patch, await generateDraft(ctx, mailbox, provider, cur, t.messages || [], jobFacts)); counts.drafted++; } } catch (e) { warn(`draft failed: ${errText(e)}`); }
      if (Object.keys(patch).length) { try { await api.EmailThread.update(row.id, patch); } catch (e) { warn(`thread update failed: ${errText(e)}`); } }
    }

    // Warnings stay in the run record; last_error is only for a failed run.
    return finish('ok', '');
  }

  async function actionSync(ctx) {
    if (ctx.user && ctx.user.role !== 'admin') fail(403, 'Owner access required.');
    const body = ctx.body;
    const max = Math.max(1, Math.min(500, Number(body.max) || DEFAULT_MAX));
    let mailboxes = (await loadMailboxes(ctx.api)).filter((m) => m.enabled !== false);
    if (body.mailbox_key) mailboxes = mailboxes.filter((m) => m.key === String(body.mailbox_key));
    if (body.mailbox_key && !mailboxes.length) fail(404, 'Mailbox not found or disabled.');
    const results = [];
    for (const mailbox of mailboxes) {
      try { results.push(await syncMailbox(ctx, mailbox, { fresh: body.fresh === true, max })); }
      catch (e) {
        results.push({ mailbox_key: mailbox.key, status: 'error', error: errText(e) });
        try { await ctx.api.EmailMailbox.update(mailbox.id, { last_error: errText(e).slice(0, 200), last_synced_at: now() }); } catch { /* ignore */ }
      }
    }
    return { ok: true, at: now(), mailboxes: results };
  }

  // ---- read actions -----------------------------------------------------------------------------

  async function actionList(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const body = ctx.body;
    const all = await loadMailboxes(ctx.api);
    const visible = all.filter((m) => canSeeMailbox(m, ctx.user));
    let keys = visible.map((m) => m.key);
    if (body.mailbox_key) {
      const wanted = String(body.mailbox_key);
      if (!all.some((m) => m.key === wanted)) fail(404, 'Mailbox not found.');
      if (!keys.includes(wanted)) fail(403, 'This mailbox is owner-only.');
      keys = [wanted];
    }
    const limit = Math.max(1, Math.min(200, Number(body.limit) || 50));
    if (!keys.length) return { ok: true, threads: [], mailboxes: [], count: 0 };
    const query = { mailbox_key: keys.length === 1 ? keys[0] : { $in: keys } };
    if (body.status) { if (!T.STATUSES.includes(body.status)) fail(400, 'Invalid status.'); query.status = body.status; }
    if (body.category) { if (!T.CATEGORIES.includes(body.category)) fail(400, 'Invalid category.'); query.category = body.category; }
    if (body.job_id) query.job_id = String(body.job_id);
    const q = String(body.q || '').trim().toLowerCase();
    let rows = await ctx.api.EmailThread.filter(query, '-last_message_at', q ? Math.min(500, limit * 4) : limit);
    if (q) {
      const hay = (t) => [t.subject, t.from_name, t.from_email, t.summary, t.account_hint, t.snippet, t.extracted?.builder, t.extracted?.lot, t.extracted?.address, ...(t.extracted?.po_numbers || []), ...(t.extracted?.oe_numbers || [])].filter(Boolean).join(' ').toLowerCase();
      rows = rows.filter((t) => hay(t).includes(q)).slice(0, limit);
    }
    return { ok: true, threads: rows, mailboxes: visible.map(publicMailbox), count: rows.length };
  }

  async function actionThread(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { thread, mailbox } = await threadForUser(ctx, ctx.body.id);
    const messages = await threadMessages(ctx.api, thread);
    return { ok: true, thread, messages, mailbox: publicMailbox(mailbox) };
  }

  async function actionMailboxes(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (ctx.user.role !== 'admin') fail(403, 'Owner access required.');
    const rows = await loadMailboxes(ctx.api);
    const out = [];
    for (const m of rows) {
      let connected = false, detail = '';
      try { const c = await ctx.connectors.getConnection(m.connector_type || m.provider); connected = !!(c && c.accessToken); if (!connected) detail = 'no access token'; }
      catch (e) { detail = errText(e); }
      out.push({ ...publicMailbox(m), signature: m.signature || DEFAULT_SIGNATURE, connector_type: m.connector_type, connected, connection_detail: detail, last_history_id: m.last_history_id || '', last_delta_link: m.last_delta_link ? '(set)' : '' });
    }
    return { ok: true, mailboxes: out };
  }

  async function actionSeedMailboxes(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (ctx.user.role !== 'admin') fail(403, 'Owner access required.');
    const existing = await loadMailboxes(ctx.api);
    const out = [];
    for (const seed of SEED_MAILBOXES) {
      const prev = existing.find((m) => m.key === seed.key);
      if (prev) {
        const patch = { address: seed.address, display_name: seed.display_name, provider: seed.provider, connector_type: seed.connector_type, visibility: seed.visibility };
        if (!prev.signature) patch.signature = DEFAULT_SIGNATURE;
        await ctx.api.EmailMailbox.update(prev.id, patch);
        out.push({ key: seed.key, action: 'updated', id: prev.id });
      } else {
        const row = await ctx.api.EmailMailbox.create({ ...seed, auto_archive_categories: ['newsletter_promo', 'spam'], signature: DEFAULT_SIGNATURE, last_history_id: '', last_delta_link: '', last_error: '', labels: {} });
        out.push({ key: seed.key, action: 'created', id: row.id });
      }
    }
    return { ok: true, mailboxes: out };
  }

  // ---- thread mutations -----------------------------------------------------------------------

  async function actionSetStatus(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const status = String(ctx.body.status || '');
    if (!T.STATUSES.includes(status)) fail(400, 'Invalid status.');
    const { thread } = await threadForUser(ctx, ctx.body.id);
    const patch = { status };
    if (status === 'done' || status === 'ignored' || status === 'waiting') patch.reply_needed = false;
    await ctx.api.EmailThread.update(thread.id, patch);
    return { ok: true, thread: { ...thread, ...patch } };
  }

  async function actionSetCategory(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const category = String(ctx.body.category || '');
    if (!T.CATEGORIES.includes(category)) fail(400, 'Invalid category.');
    const { thread, mailbox } = await threadForUser(ctx, ctx.body.id);
    const patch = { category };
    let warning = '';
    try {
      const provider = await connect(ctx, mailbox);
      const messages = mailbox.provider === 'gmail' ? [] : await threadMessages(ctx.api, thread);
      Object.assign(patch, await labelThread(provider, mailbox, { ...thread, category }, messages));
      await ctx.api.EmailMailbox.update(mailbox.id, { labels: mailbox.labels || {} });
    } catch (e) { warning = `Category saved; provider label not updated (${errText(e)})`; }
    await ctx.api.EmailThread.update(thread.id, patch);
    return { ok: true, thread: { ...thread, ...patch }, warning: warning || undefined };
  }

  async function actionLinkJob(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const jobId = idText(ctx.body.job_id);
    const { thread, mailbox } = await threadForUser(ctx, ctx.body.id);
    let job;
    try { job = await ctx.api.Jobs.get(jobId); } catch { job = null; }
    if (!job) fail(404, 'Job not found.');
    const patch = { job_id: jobId, job_link_source: 'owner', job_match_confidence: 'high', job_candidates: [] };
    const cur = { ...thread, ...patch };
    const relay = await relayNote(ctx.api, cur, mailbox);
    if (relay) Object.assign(patch, relay);
    await ctx.api.EmailThread.update(thread.id, patch);
    return { ok: true, thread: { ...thread, ...patch }, job: { id: job.id, name: job.canonical_name } };
  }

  async function actionUnlinkJob(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { thread } = await threadForUser(ctx, ctx.body.id);
    // The relayed JobNotes row stays on the job (delete it there if it was wrong); clearing
    // note_id lets a fresh link relay again.
    const patch = { job_id: null, job_link_source: null, job_match_confidence: 'unmatched', note_id: null, relayed_at: null };
    await ctx.api.EmailThread.update(thread.id, patch);
    return { ok: true, thread: { ...thread, ...patch } };
  }

  async function actionRegenerateDraft(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { thread, mailbox } = await threadForUser(ctx, ctx.body.id);
    if (thread.draft_status === 'sent') fail(409, 'This draft was already sent.');
    const provider = await connect(ctx, mailbox);
    const messages = await threadMessages(ctx.api, thread);
    if (thread.draft_status === 'drafted') { try { await discardInProvider(provider, thread); } catch { /* keep going */ } }
    let jobFacts = null;
    if (thread.job_id) { try { jobFacts = jobFactsFor(thread.job_id, await loadJobIndex(ctx.api), denverDate()); } catch { jobFacts = null; } }
    const patch = await generateDraft(ctx, mailbox, provider, thread, messages, jobFacts);
    await ctx.api.EmailThread.update(thread.id, patch);
    return { ok: true, thread: { ...thread, ...patch } };
  }

  async function actionDiscardDraft(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { thread, mailbox } = await threadForUser(ctx, ctx.body.id);
    if (thread.draft_status !== 'drafted') fail(409, 'No open draft on this thread.');
    let warning = '';
    try { await discardInProvider(await connect(ctx, mailbox), thread); } catch (e) { warning = `Provider draft not removed (${errText(e)})`; }
    const patch = { draft_status: 'discarded', draft_id: '' };
    await ctx.api.EmailThread.update(thread.id, patch);
    return { ok: true, thread: { ...thread, ...patch }, warning: warning || undefined };
  }

  async function actionSendDraft(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (ctx.user.role !== 'admin') fail(403, 'Owner access required.');
    const { thread, mailbox } = await threadForUser(ctx, ctx.body.id);
    if (thread.draft_status !== 'drafted' || !thread.draft_id) fail(409, 'No open draft to send.');
    const provider = await connect(ctx, mailbox);
    await provider.sendDraft(thread.draft_id);
    const patch = { draft_status: 'sent', status: 'waiting', reply_needed: false };
    await ctx.api.EmailThread.update(thread.id, patch);
    return { ok: true, thread: { ...thread, ...patch } };
  }

  async function actionArchive(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { thread, mailbox } = await threadForUser(ctx, ctx.body.id);
    const provider = await connect(ctx, mailbox);
    const messages = mailbox.provider === 'gmail' ? [] : await threadMessages(ctx.api, thread);
    const patch = await archiveInProvider(provider, mailbox, thread, messages);
    await ctx.api.EmailThread.update(thread.id, patch);
    return { ok: true, thread: { ...thread, ...patch } };
  }

  const ACTIONS = {
    sync: actionSync,
    list: actionList,
    thread: actionThread,
    set_status: actionSetStatus,
    set_category: actionSetCategory,
    link_job: actionLinkJob,
    unlink_job: actionUnlinkJob,
    regenerate_draft: actionRegenerateDraft,
    discard_draft: actionDiscardDraft,
    send_draft: actionSendDraft,
    archive: actionArchive,
    mailboxes: actionMailboxes,
    seed_mailboxes: actionSeedMailboxes,
  };

  return async function handler(req) {
    try {
      if (req.method !== 'POST') return reply({ error: 'POST requests only.' }, 405);
      let body;
      try { body = await req.json(); } catch { return reply({ error: 'Invalid request body.' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid request body.' }, 400);
      const action = String(body.action || '');
      const fn = ACTIONS[action];
      if (!fn) return reply({ error: 'Unknown action.', actions: Object.keys(ACTIONS) }, 400);
      const client = await getClient(req);
      let user = null;
      try { user = await client.auth.me(); } catch { user = null; }
      const ctx = {
        client, user, body,
        api: client.asServiceRole.entities,
        core: client.asServiceRole.integrations?.Core,
        connectors: client.asServiceRole.connectors,
        started: Date.now(),
      };
      return reply(await fn(ctx));
    } catch (e) {
      const status = Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 ? e.status : 500;
      return reply({ ok: false, error: errText(e), detail: e?.detail || undefined }, status);
    }
  };
}
