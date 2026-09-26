// Inbox agent handler for the Glass Forge Hub. One agent per mailbox (EmailMailbox rows).
// The mail stays in Gmail / Outlook: each run pulls what is new through the app's shared
// connector, reads it in memory, classifies it with one LLM call per batch, and then
//   - files it in the mailbox (Hub / Hub/<Category> labels; archives only when the mailbox says so),
//   - drafts a reply in the mailbox (never sends),
//   - relays the meaning into the Hub: a job note, one to-do, and — on a high-confidence job
//     match — the PO/OE numbers and homeowner the email states,
//   - writes one EmailRelay ledger row per thread saying what it concluded and changed.
// No message bodies are stored anywhere in the Hub. Every write is service-role; access is
// decided here. Owner-only mailboxes are visible to the owner emails only.
//
// Email content is untrusted evidence, never instructions (see emailTriage.js prompts).

import { findJobs, denverDate } from './jobFinder.js';
import { normalizeGmailMessage, normalizeGraphMessage, aggregateThread, lowerEmail } from './emailParse.js';
import * as T from './emailTriage.js';
import { createProviderClient, buildRawReply, ProviderError } from './emailProviders.js';
import { phoneKey } from './contactMatching.js';

export const OWNER_EMAILS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
export const isOwner = (user) => !!user && user.role === 'admin' && OWNER_EMAILS.has(lowerEmail(user.email));
export const isStaff = (user) => !!user && (user.role === 'admin' || user.role === 'manager');
export const DEFAULT_SIGNATURE = 'Gabe Fronk\nGlass Forge / YA Windows and Doors';
export const OWNER_MEMBER_KEY = 'gabriel';
export const INITIAL_DAYS = 3;
export const DEFAULT_MAX = 200;
export const HUB_CHANGES_CAP = 30;

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
const bySentAt = (a, b) => String(a.sent_at || '').localeCompare(String(b.sent_at || ''));
const sha256 = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, '0')).join('');

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
const withChanges = (row, more) => [...(row.hub_changes || []), ...more].slice(-HUB_CHANGES_CAP);

export function createEmailAgentHandler({ getClient, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), nowMs = () => Date.now(), budgetMs = 50_000, sleep } = {}) {
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

  const normalizerFor = (mailbox) => (mailbox.provider === 'gmail' ? normalizeGmailMessage : normalizeGraphMessage);

  // The thread's messages, read from the mailbox right now (never from the Hub).
  async function fetchThreadMessages(provider, mailbox, threadId) {
    const normalize = normalizerFor(mailbox);
    const raws = await provider.getThreadMessages(threadId);
    return raws.map((raw) => normalize(raw, { mailboxAddress: mailbox.address })).filter((m) => m.message_id && !m.is_draft).sort(bySentAt);
  }

  async function entryForUser(ctx, id) {
    let row;
    try { row = await ctx.api.EmailRelay.get(idText(id)); } catch { row = null; }
    if (!row) fail(404, 'Entry not found.');
    const mailbox = await mailboxByKey(ctx.api, row.mailbox_key);
    if (!mailbox || !canSeeMailbox(mailbox, ctx.user)) fail(404, 'Entry not found.');
    return { row, mailbox };
  }

  async function ownerMemberId(api, warn) {
    const rows = await api.TeamMember.filter({ member_key: OWNER_MEMBER_KEY }, 'id', 1);
    if (!rows[0]) { warn(`TeamMember '${OWNER_MEMBER_KEY}' missing; to-dos skipped`); return null; }
    return rows[0].id;
  }

  // ---- what the agent changes in the Hub ------------------------------------------------------

  // PO / OE numbers and the homeowner the email states, applied to the linked job. Only called
  // for a high-confidence or owner-made link. Returns the ledger patch + plain-language changes.
  async function applyJobFacts(api, row, job, warn) {
    const changes = [];
    const patch = {};
    if (!job) return { patch, changes };
    const facts = T.planJobFacts(job, row.extracted, row.applied);
    let applied = { ...(row.applied || {}), ...facts.applied };
    if (Object.keys(facts.patch).length) {
      try { await api.Jobs.update(job.id, facts.patch); Object.assign(job, facts.patch); changes.push(...facts.changes); }
      catch (e) { warn(`job facts failed: ${errText(e)}`); applied = { ...(row.applied || {}) }; }
    }
    const owner = T.homeownerCandidate(row.extracted);
    if (owner && !applied.homeowner_contact_key) {
      try {
        const existing = await api.ContactJobLink.filter({ job_id: job.id, role: 'homeowner' }, '-created_date', 1);
        if (!existing[0]) {
          const pk = phoneKey(owner.phone);
          let contact = null;
          if (pk) contact = (await api.HubContacts.filter({ phone_key: pk }, '-created_date', 5)).find((c) => c.status !== 'merged' && c.status !== 'removed');
          if (!contact && owner.email) contact = (await api.HubContacts.filter({ email_key: owner.email }, '-created_date', 5)).find((c) => c.status !== 'merged' && c.status !== 'removed');
          if (!contact) {
            contact = await api.HubContacts.create({ key: await sha256(crypto.randomUUID()), name: owner.name, phone: owner.phone, phone_key: pk, email: owner.email, email_key: owner.email, company: 'Homeowner', builder: '', note: '', review_note: '', source: 'hub', role: 'homeowner' });
          }
          await api.ContactJobLink.create({ contact_key: contact.key, job_id: job.id, source: 'inbox_agent', role: 'homeowner' });
          applied.homeowner_contact_key = contact.key;
          changes.push(`Homeowner ${contact.name || owner.name} added to the job`);
        }
      } catch (e) { warn(`homeowner failed: ${errText(e)}`); }
    }
    if (changes.length || Object.keys(applied).length !== Object.keys(row.applied || {}).length) patch.applied = applied;
    return { patch, changes };
  }

  async function relayNote(api, row, mailbox, changes, job) {
    if (!T.shouldRelay(row)) return null;
    const note = await api.JobNotes.create(T.buildNotePayload(row, mailbox, changes));
    return { note_id: note.id, relayed_at: now(), change: `Note added to ${job?.canonical_name || 'the job'}` };
  }

  async function createTodo(api, row, mailbox, assigneeMemberId) {
    if (!T.shouldCreateTodo(row)) return null;
    const key = T.todoRequestKey(mailbox.key, row.thread_id);
    const existing = await api.TodoTask.filter({ request_key: key }, 'id', 1);
    if (existing[0]) return { todo_ids: [existing[0].id] };
    const created = await api.TodoTask.create(T.buildTodoPayload(row, mailbox, { assigneeMemberId, now: now() }));
    return { todo_ids: [created.id], change: 'To-do created' };
  }

  // Ensure "Hub" + "Hub/<Category>" exist in the provider and apply them to the thread.
  async function labelThread(provider, mailbox, row, messages) {
    const names = T.labelNamesFor(row.category);
    const map = await provider.ensureLabels(names, mailbox.labels || {});
    mailbox.labels = map;
    const hubIds = new Set(T.ALL_LABEL_NAMES.map((n) => map[n]).filter(Boolean));
    const wantIds = names.map((n) => map[n]).filter(Boolean);
    if (mailbox.provider === 'gmail') {
      const current = row.provider_labels || [];
      const remove = current.filter((id) => hubIds.has(id) && !wantIds.includes(id));
      await provider.modifyThread(row.thread_id, { addLabelIds: wantIds, removeLabelIds: remove });
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

  async function archiveInProvider(provider, mailbox, row, messages) {
    if (mailbox.provider === 'gmail') await provider.archiveThread(row.thread_id);
    else for (const m of messages) if (m.direction === 'incoming') await provider.archiveMessage(m.message_id);
    return { archived: true, provider_labels: (row.provider_labels || []).filter((l) => l !== 'INBOX') };
  }

  async function generateDraft(ctx, mailbox, provider, row, messages, jobFacts) {
    const lastIncoming = [...messages].reverse().find((m) => m.direction === 'incoming') || messages[messages.length - 1];
    if (!lastIncoming) fail(409, 'Nothing to reply to.');
    const result = await ctx.core.InvokeLLM(T.buildDraftPrompt(row, messages, mailbox, jobFacts));
    const text = T.cleanDraftReply(result, mailbox);
    if (!text.trim()) fail(502, 'Empty draft from the model.');
    let draft;
    if (mailbox.provider === 'gmail') {
      const raw = buildRawReply({ to: lastIncoming.from_email ? [lastIncoming.from_email] : [], subject: T.replySubject(row.subject), inReplyTo: lastIncoming.internet_message_id || '', references: lastIncoming.references || '', text });
      draft = await provider.createDraft({ threadId: row.thread_id, raw });
    } else {
      draft = await provider.createDraftReply({ messageId: lastIncoming.message_id, text });
    }
    return { draft_id: draft.draft_id || '', draft_status: 'drafted' };
  }

  async function discardInProvider(provider, row) {
    if (!row.draft_id) return;
    try { await provider.deleteDraft(row.draft_id); } catch (e) { if (!(e instanceof ProviderError && e.status === 404)) throw e; }
  }

  // ---- sync -----------------------------------------------------------------------------------

  async function syncMailbox(ctx, mailbox, { fresh = false, max = DEFAULT_MAX } = {}) {
    const api = ctx.api;
    const counts = { fetched: 0, threads_updated: 0, classified: 0, relayed: 0, drafted: 0, archived: 0, errors: [] };
    const warn = (msg) => { if (counts.errors.length < 40) counts.errors.push(String(msg).slice(0, 300)); };
    const startedAt = now();
    const run = await api.EmailAgentRun.create({ mailbox_key: mailbox.key, started_at: startedAt, status: 'running', ...counts });
    const overBudget = () => nowMs() - ctx.started > budgetMs;
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

    // 1. Pull new mail since the cursor (read in memory; nothing below stores a body).
    let listed;
    try {
      listed = await provider.listNewMessages(mailbox.provider === 'gmail'
        ? { historyId: fresh ? '' : (mailbox.last_history_id || ''), sinceDays: INITIAL_DAYS, max }
        : { deltaLink: fresh ? '' : (mailbox.last_delta_link || ''), sinceDays: INITIAL_DAYS, max });
    } catch (e) { warn(`list failed: ${errText(e)}`); return finish('error', `list_failed: ${errText(e)}`.slice(0, 200)); }

    const normalize = normalizerFor(mailbox);
    const fetched = [];
    let fetchErrors = 0;
    await pool(listed.ids, 4, async (ref) => {
      // Out of time: leave the rest for the next run (cursor is not advanced below).
      if (overBudget()) { fetchErrors++; return; }
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
    if (fetchErrors) warn(`${fetchErrors} listed message(s) not fetched; cursor held for the next run`);
    // Only advance the cursor once everything listed was seen.
    const advanceCursor = fetchErrors === 0;

    // 2. Upsert ledger rows. A message dated at or before the row's last_message_at was seen
    //    on an earlier run (the Hub keeps no message ids, only that watermark).
    const byThread = new Map();
    for (const m of fetched) { if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []); byThread.get(m.thread_id).push(m); }
    const threadIds = [...byThread.keys()];
    const existingRows = new Map();
    for (const ids of chunk(threadIds, 40)) {
      const rows = await api.EmailRelay.filter({ mailbox_key: mailbox.key, thread_id: { $in: ids } }, '-last_message_at', 500);
      for (const t of rows) existingRows.set(t.thread_id, t);
    }

    const work = new Map(); // thread_id -> { patch, prev, messages, hasNewIncoming }
    for (const [threadId, msgs] of byThread) {
      const prev = existingRows.get(threadId) || null;
      const seenUpTo = prev?.last_message_at || '';
      const fresh_ = msgs.filter((m) => !prev || String(m.sent_at || '') > seenUpTo).sort(bySentAt);
      if (prev && !fresh_.length) continue; // nothing new for this thread
      const agg = aggregateThread(fresh_, { mailbox, previous: prev });
      const latest = fresh_[fresh_.length - 1];
      const hasNewIncoming = fresh_.some((m) => m.direction === 'incoming');
      let patch = { ...agg };
      if (!prev) {
        patch = { ...patch, status: 'new', priority: 'normal', reply_needed: false, action_items: [], job_candidates: [], todo_ids: [], hub_changes: [], applied: {}, draft_status: 'none', archived: false, triage_pending: true };
      } else {
        if (hasNewIncoming) patch.triage_pending = true;
        if (latest && latest.direction === 'outgoing' && (prev.status === 'new' || prev.status === 'needs_reply')) { patch.status = 'waiting'; patch.reply_needed = false; }
        if (prev.archived && hasNewIncoming) patch.archived = false;
      }
      work.set(threadId, { patch, prev, messages: msgs.sort(bySentAt), hasNewIncoming });
    }
    const threads = []; // { row, messages, hasNewIncoming }
    for (const [, w] of work) {
      let row;
      if (w.prev) { await api.EmailRelay.update(w.prev.id, w.patch); row = { ...w.prev, ...w.patch }; }
      else row = await api.EmailRelay.create(w.patch);
      counts.threads_updated++;
      threads.push({ row, messages: w.messages, hasNewIncoming: w.hasNewIncoming });
    }
    if (advanceCursor && listed.cursor) mailbox._cursor = listed.cursor;

    // Threads left pending by an earlier run (budget / LLM hiccup) get another chance; their
    // text is read back from the mailbox.
    try {
      const inRun = new Set(threads.map((t) => t.row.thread_id));
      const leftovers = await api.EmailRelay.filter({ mailbox_key: mailbox.key, triage_pending: true }, '-last_message_at', 50);
      for (const t of leftovers) if (!inRun.has(t.thread_id)) threads.push({ row: t, messages: null, hasNewIncoming: true });
    } catch (e) { warn(`leftover scan failed: ${errText(e)}`); }

    // 3. Triage: one LLM call per batch of up to 8 threads.
    const pending = threads.filter((t) => t.row.triage_pending !== false);
    const triaged = [];
    for (const batch of chunk(pending, T.TRIAGE_BATCH)) {
      if (overBudget()) { warn('budget exhausted before triage finished'); break; }
      for (const t of batch) if (!t.messages) { try { t.messages = await fetchThreadMessages(provider, mailbox, t.row.thread_id); } catch (e) { warn(`thread ${t.row.thread_id} reread failed: ${errText(e)}`); t.messages = []; } }
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
        try { await api.EmailRelay.update(batch[i].row.id, patch); } catch (e) { warn(`ledger update failed: ${errText(e)}`); continue; }
        batch[i].row = { ...batch[i].row, ...patch };
        counts.classified++;
        triaged.push(batch[i]);
      }
    }

    // 4. Job match, apply facts, relay note, to-do, label, archive, draft.
    let index = null;
    const today = denverDate();
    let assignee; // undefined = not looked up yet, null = missing
    for (let i = 0; i < triaged.length; i++) {
      const t = triaged[i];
      if (overBudget()) {
        warn('budget exhausted before relay finished');
        // Triage already cleared their pending flag; put it back so the next run re-reads,
        // re-triages and relays them instead of leaving classified rows with no note / to-do.
        for (const left of triaged.slice(i)) { try { await api.EmailRelay.update(left.row.id, { triage_pending: true }); } catch (e) { warn(`re-flag failed: ${errText(e)}`); } }
        break;
      }
      const row = t.row;
      const patch = {};
      const changes = [];
      let job = null;
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
        }
        if (row.job_id || patch.job_id) {
          index = index || await loadJobIndex(api, fresh);
          job = (index.jobs || []).find((j) => j.id === (patch.job_id || row.job_id)) || null;
          jobFacts = jobFacts || jobFactsFor(patch.job_id || row.job_id, index, today);
        }
      } catch (e) { warn(`job match failed: ${errText(e)}`); }
      let cur = { ...row, ...patch };
      const trusted = cur.job_link_source === 'owner' || cur.job_match_confidence === 'high';
      if (job && trusted) {
        const r = await applyJobFacts(api, cur, job, warn);
        Object.assign(patch, r.patch); changes.push(...r.changes); cur = { ...cur, ...r.patch };
      }
      try { const r = await relayNote(api, cur, mailbox, changes, job); if (r) { const { change, ...rest } = r; Object.assign(patch, rest); changes.push(change); counts.relayed++; cur = { ...cur, ...rest }; } } catch (e) { warn(`relay failed: ${errText(e)}`); }
      try {
        if (T.shouldCreateTodo(cur)) {
          if (assignee === undefined) assignee = await ownerMemberId(api, warn);
          if (assignee) { const r = await createTodo(api, cur, mailbox, assignee); if (r) { const { change, ...rest } = r; Object.assign(patch, rest); if (change) changes.push(change); cur = { ...cur, ...rest }; } }
        }
      } catch (e) { warn(`todo failed: ${errText(e)}`); }
      try { Object.assign(patch, await labelThread(provider, mailbox, cur, t.messages || [])); cur = { ...cur, ...patch }; } catch (e) { warn(`label failed: ${errText(e)}`); }
      try { if (T.shouldArchive(cur, mailbox)) { Object.assign(patch, await archiveInProvider(provider, mailbox, cur, t.messages || [])); cur = { ...cur, ...patch }; counts.archived++; } } catch (e) { warn(`archive failed: ${errText(e)}`); }
      try { if (T.shouldDraft(cur, mailbox)) { Object.assign(patch, await generateDraft(ctx, mailbox, provider, cur, t.messages || [], jobFacts)); counts.drafted++; } } catch (e) { warn(`draft failed: ${errText(e)}`); }
      if (changes.length) patch.hub_changes = withChanges(row, changes);
      if (Object.keys(patch).length) { try { await api.EmailRelay.update(row.id, patch); } catch (e) { warn(`ledger update failed: ${errText(e)}`); } }
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
    if (!keys.length) return { ok: true, entries: [], mailboxes: [], count: 0 };
    const query = { mailbox_key: keys.length === 1 ? keys[0] : { $in: keys } };
    if (body.status) { if (!T.STATUSES.includes(body.status)) fail(400, 'Invalid status.'); query.status = body.status; }
    if (body.category) { if (!T.CATEGORIES.includes(body.category)) fail(400, 'Invalid category.'); query.category = body.category; }
    if (body.job_id) query.job_id = String(body.job_id);
    const q = String(body.q || '').trim().toLowerCase();
    let rows = await ctx.api.EmailRelay.filter(query, '-last_message_at', q ? Math.min(500, limit * 4) : limit);
    if (q) {
      const hay = (t) => [t.subject, t.from_name, t.from_email, t.summary, t.account_hint, t.extracted?.builder, t.extracted?.lot, t.extracted?.address, ...(t.extracted?.po_numbers || []), ...(t.extracted?.oe_numbers || []), ...(t.hub_changes || [])].filter(Boolean).join(' ').toLowerCase();
      rows = rows.filter((t) => hay(t).includes(q)).slice(0, limit);
    }
    return { ok: true, entries: rows, mailboxes: visible.map(publicMailbox), count: rows.length };
  }

  async function actionEntry(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { row, mailbox } = await entryForUser(ctx, ctx.body.id);
    return { ok: true, entry: row, mailbox: publicMailbox(mailbox) };
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

  // ---- ledger mutations -----------------------------------------------------------------------

  async function actionSetStatus(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const status = String(ctx.body.status || '');
    if (!T.STATUSES.includes(status)) fail(400, 'Invalid status.');
    const { row } = await entryForUser(ctx, ctx.body.id);
    const patch = { status };
    if (status === 'done' || status === 'ignored' || status === 'waiting') patch.reply_needed = false;
    await ctx.api.EmailRelay.update(row.id, patch);
    return { ok: true, entry: { ...row, ...patch } };
  }

  async function actionSetCategory(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const category = String(ctx.body.category || '');
    if (!T.CATEGORIES.includes(category)) fail(400, 'Invalid category.');
    const { row, mailbox } = await entryForUser(ctx, ctx.body.id);
    const patch = { category };
    let warning = '';
    try {
      const provider = await connect(ctx, mailbox);
      const messages = mailbox.provider === 'gmail' ? [] : await fetchThreadMessages(provider, mailbox, row.thread_id);
      Object.assign(patch, await labelThread(provider, mailbox, { ...row, category }, messages));
      await ctx.api.EmailMailbox.update(mailbox.id, { labels: mailbox.labels || {} });
    } catch (e) { warning = `Category saved; mailbox label not updated (${errText(e)})`; }
    await ctx.api.EmailRelay.update(row.id, patch);
    return { ok: true, entry: { ...row, ...patch }, warning: warning || undefined };
  }

  // An owner-made link is trusted like a high-confidence match: facts are applied and the
  // note is relayed right away.
  async function actionLinkJob(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const jobId = idText(ctx.body.job_id);
    const { row, mailbox } = await entryForUser(ctx, ctx.body.id);
    let job;
    try { job = await ctx.api.Jobs.get(jobId); } catch { job = null; }
    if (!job) fail(404, 'Job not found.');
    const warnings = [];
    const patch = { job_id: jobId, job_link_source: 'owner', job_match_confidence: 'high', job_candidates: [] };
    let cur = { ...row, ...patch };
    const changes = [];
    const facts = await applyJobFacts(ctx.api, cur, job, (m) => warnings.push(m));
    Object.assign(patch, facts.patch); changes.push(...facts.changes); cur = { ...cur, ...facts.patch };
    const relay = await relayNote(ctx.api, cur, mailbox, changes, job);
    if (relay) { const { change, ...rest } = relay; Object.assign(patch, rest); changes.push(change); }
    if (changes.length) patch.hub_changes = withChanges(row, changes);
    await ctx.api.EmailRelay.update(row.id, patch);
    return { ok: true, entry: { ...row, ...patch }, job: { id: job.id, name: job.canonical_name }, warning: warnings.length ? warnings.join('; ') : undefined };
  }

  async function actionUnlinkJob(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { row } = await entryForUser(ctx, ctx.body.id);
    // What was already put on the job (note, PO/OE, homeowner) stays there — fix it on the job
    // page if it was wrong. Clearing note_id lets a fresh link relay again.
    const patch = { job_id: null, job_link_source: null, job_match_confidence: 'unmatched', note_id: null, relayed_at: null, hub_changes: withChanges(row, ['Job link removed']) };
    await ctx.api.EmailRelay.update(row.id, patch);
    return { ok: true, entry: { ...row, ...patch } };
  }

  async function actionRegenerateDraft(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { row, mailbox } = await entryForUser(ctx, ctx.body.id);
    const provider = await connect(ctx, mailbox);
    const messages = await fetchThreadMessages(provider, mailbox, row.thread_id);
    if (row.draft_status === 'drafted') { try { await discardInProvider(provider, row); } catch { /* keep going */ } }
    let jobFacts = null;
    if (row.job_id) { try { jobFacts = jobFactsFor(row.job_id, await loadJobIndex(ctx.api), denverDate()); } catch { jobFacts = null; } }
    const patch = await generateDraft(ctx, mailbox, provider, row, messages, jobFacts);
    await ctx.api.EmailRelay.update(row.id, patch);
    return { ok: true, entry: { ...row, ...patch } };
  }

  async function actionDiscardDraft(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { row, mailbox } = await entryForUser(ctx, ctx.body.id);
    if (row.draft_status !== 'drafted') fail(409, 'No open draft on this thread.');
    let warning = '';
    try { await discardInProvider(await connect(ctx, mailbox), row); } catch (e) { warning = `Mailbox draft not removed (${errText(e)})`; }
    const patch = { draft_status: 'discarded', draft_id: '' };
    await ctx.api.EmailRelay.update(row.id, patch);
    return { ok: true, entry: { ...row, ...patch }, warning: warning || undefined };
  }

  async function actionArchive(ctx) {
    if (!ctx.user) fail(401, 'Sign in required.');
    if (!isStaff(ctx.user)) fail(403, 'Admin or manager access required.');
    const { row, mailbox } = await entryForUser(ctx, ctx.body.id);
    const provider = await connect(ctx, mailbox);
    const messages = mailbox.provider === 'gmail' ? [] : await fetchThreadMessages(provider, mailbox, row.thread_id);
    const patch = await archiveInProvider(provider, mailbox, row, messages);
    await ctx.api.EmailRelay.update(row.id, patch);
    return { ok: true, entry: { ...row, ...patch } };
  }

  const ACTIONS = {
    sync: actionSync,
    list: actionList,
    entry: actionEntry,
    set_status: actionSetStatus,
    set_category: actionSetCategory,
    link_job: actionLinkJob,
    unlink_job: actionUnlinkJob,
    regenerate_draft: actionRegenerateDraft,
    discard_draft: actionDiscardDraft,
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
        started: nowMs(),
      };
      return reply(await fn(ctx));
    } catch (e) {
      const status = Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 ? e.status : 500;
      return reply({ ok: false, error: errText(e), detail: e?.detail || undefined }, status);
    }
  };
}
