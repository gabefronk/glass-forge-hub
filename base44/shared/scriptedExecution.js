import { DESKTOP_NATIVE_SOURCE, validateDesktopCheckpoint } from './nativeEngineObservation.js';
import { HttpError, publicQuote, sanitizePublic, sha256, validateLines, validateSettings, validateResult } from './windowQuotesCore.js';
import { reviewedRestartAllowsHistory } from './reviewedRestart.js';

export const SCRIPTED_PROVIDER = 'deterministic';
const LOCK_NAME = 'Base44 Window Quotes browser';
const EXCLUDED_REQUEST = '6a9dadff1e196279b733762e';
const EXCLUDED_NATIVE_ID = 'fffd5b0e-9ccf-4ba7-84e8-1e4e26655a9f';
const EXCLUDED_NATIVE_NUMBER = '3516421';
const TERMINAL = new Set(['needs_details', 'needs_sign_in', 'failed', 'ready']);
const fail = (status, message) => { throw new HttpError(status, message); };
const clone = value => JSON.parse(JSON.stringify(value));
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const text = (value, name, max = 150) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'Invalid ' + name); return value; };
const bounded = (value, name, max = 400000) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > max) fail(400, 'Invalid ' + name);
  const visit = (item, depth = 0) => { if (depth > 12) fail(400, name + ' is too deeply nested'); if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(400, 'Invalid ' + name + ' key'); visit(child, depth + 1); } };
  visit(value); return clone(value);
};
function equalSecret(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
const inputSnapshot = q => ({ quote_id: q.id, input_revision: q.input_revision, title: q.title, settings: q.settings || {}, lines: q.lines || [], source: q.source || {}, messages: (q.conversation || []).filter(m => m.role === 'user') });

// Local-only pilot module. No environment reads, provider dispatch or automatic polling.
// The existing private agent_run field keeps operation/plan/capability data out of publicQuote.
export function createScriptedExecution({ config = {}, hash = sha256, normalizeRequest, validateReady, now = () => new Date(), uuid = () => crypto.randomUUID() } = {}) {
  const enabled = config.enabled === true;
  const allow = config.allow || {};
  const leaseMs = config.lease_ms ?? 10 * 60 * 1000;
  if (enabled) {
    for (const [key, value] of Object.entries({ quote_id: allow.quote_id, request_id: allow.request_id, requester_email: allow.requester_email, yard: allow.yard, worker_id: config.worker_id, browser_slot_id: config.browser_slot_id })) text(value, key, 320);
    if (!Number.isSafeInteger(allow.input_revision) || allow.input_revision < 1 || allow.dealer !== 'BFS' || allow.quote_id === EXCLUDED_REQUEST || config.worker_id === config.browser_slot_id || !/^[a-f0-9]{64}$/.test(config.worker_key_hash || '') || !/^[a-f0-9]{64}$/.test(config.expected_plan_hash || '') || typeof normalizeRequest !== 'function' || typeof validateReady !== 'function' || !Number.isInteger(leaseMs) || leaseMs < 120000 || leaseMs > 600000) fail(503, 'Invalid disabled-by-default scripted pilot configuration');
  }
  const at = () => now().toISOString();
  const expiry = () => new Date(now().getTime() + leaseMs).toISOString();
  const requireEnabled = () => { if (!enabled) fail(503, 'The scripted quoting pilot is disabled'); };
  const digest = value => hash(stable(value));
  const get = async (db, id) => { const rows = await db.QuoteRequests.filter({ id }, undefined, 1); if (rows.length !== 1) fail(404, 'Quote request not found'); return rows[0]; };
  const requested = body => { if (body.quote_id !== allow.quote_id || body.quote_id === EXCLUDED_REQUEST || body.input_revision !== allow.input_revision) fail(403, 'This request revision is outside the scripted pilot'); };
  const scope = q => {
    if (q.id !== allow.quote_id || q.id === EXCLUDED_REQUEST || q.request_id !== allow.request_id || q.input_revision !== allow.input_revision || q.requester_email !== allow.requester_email) fail(403, 'This request revision is outside the scripted pilot');
    if (q.settings?.dealer !== undefined && q.settings.dealer !== '' && q.settings.dealer !== 'BFS') fail(403, 'This pilot is paired only with BFS');
    if (q.settings?.yard && q.settings.yard !== allow.yard) fail(403, 'This pilot is paired with a different shipping yard');
    if (q.sales_status === 'won' || q.job_id || q.accepted_revision || q.result) fail(409, 'An existing result or accepted quote cannot enter this pilot');
  };
  const hasNative = value => value && typeof value === 'object' && Object.entries(value).some(([key, item]) => (/^native_quote_(id|number|url)$/.test(key) && !!item) || (item && typeof item === 'object' && hasNative(item)));
  const fresh = async q => {
    const reviewed = !!config.queue_scope_hash && q.reviewed_restart?.queue_scope_hash === config.queue_scope_hash && await reviewedRestartAllowsHistory(q, hash);
    if (q.checkpoint && Object.keys(q.checkpoint).length || hasNative(q.history) && !reviewed) fail(409, 'Historical native quotes are excluded from this pilot');
    if (q.execution_provider && q.execution_provider !== SCRIPTED_PROVIDER || q.agent_run && q.agent_run.phase !== 'prepared') fail(409, 'An existing execution cannot be transferred into this pilot');
    if (!['draft', 'needs_details', 'queued'].includes(q.worker_status)) fail(409, 'Only a new unstarted request may enter this pilot');
  };
  const cas = async (db, q, patch, extra = {}) => {
    const version = q.state_version || 0;
    const result = await db.QuoteRequests.updateMany({ id: q.id, state_version: version, input_revision: q.input_revision, ...extra }, { $set: { ...patch, state_version: version + 1 } });
    if (result.updated !== 1) fail(409, 'The request changed; stop and reload');
    return { ...q, ...patch, state_version: version + 1 };
  };
  const lock = async db => { const rows = await db.QuoteWorkers.filter({ id: config.browser_slot_id, name: LOCK_NAME }, undefined, 2); if (rows.length !== 1) fail(503, 'The shared quoting browser slot is unavailable'); return rows[0]; };
  const release = async (db, run) => { await db.QuoteWorkers.updateMany({ id: config.browser_slot_id, busy_token: run.operation_id, active_quote_id: allow.quote_id }, { $set: { busy_token: '', busy_until: '', active_quote_id: '', last_seen_at: at() } }); };
  const ownsLock = async (db, run) => { const row = await lock(db); if (row.busy_token !== run.operation_id || row.active_quote_id !== allow.quote_id) fail(409, 'Browser ownership changed; stop native actions'); };
  const workerScope = worker => { if (!worker || worker.id !== config.worker_id || !worker.enabled || worker.token_hash !== config.worker_key_hash || !(worker.allowed_dealers || []).includes('BFS')) fail(401, 'Runner authentication failed'); };
  async function authenticate({ db, key }) {
    requireEnabled(); if (typeof key !== 'string' || key.length < 24 || key.length > 256) fail(401, 'Runner authentication required');
    if (!equalSecret(await hash(key), config.worker_key_hash)) fail(401, 'Runner authentication failed');
    const rows = await db.QuoteWorkers.filter({ id: config.worker_id, enabled: true, token_hash: config.worker_key_hash }, undefined, 2);
    if (rows.length !== 1) fail(401, 'Runner authentication failed'); workerScope(rows[0]); return rows[0];
  }
  function appendMessage(q, status, message, eventId) {
    const content = sanitizePublic(text(message, 'message', 6000));
    return [...(q.conversation || []), { role: 'assistant', content, revision: q.input_revision, client_message_id: 'scripted:' + eventId, message_at: at(), author: 'Window Quotes', kind: status === 'needs_details' ? 'clarification' : status === 'ready' ? 'ready' : 'progress', worker_status: status }];
  }
  const questions = value => { if (!Array.isArray(value) || !value.length || value.length > 30) fail(400, 'Provide complete clarification questions'); return value.map(item => sanitizePublic(text(item, 'clarification question', 2000))); };
  async function afterInput({ db, q, user }) {
    if (!enabled) return q;
    q = await get(db, q.id); scope(q);
    if (user?.role !== 'admin' || (user.email || user.id) !== allow.requester_email) fail(403, 'This administrator is not the pilot requester');
    if (q.execution_provider === SCRIPTED_PROVIDER && q.worker_status === 'running') return q;
    await fresh(q);
    const inputHash = await digest(inputSnapshot(q));
    if (q.worker_status === 'queued') { if (q.agent_run?.input_hash !== inputHash || q.agent_run?.input_revision !== q.input_revision || q.agent_run?.plan_hash !== config.expected_plan_hash || await digest(q.agent_run?.plan) !== config.expected_plan_hash) fail(409, 'Queued input no longer matches its prepared plan'); return q; }
    const normalized = await normalizeRequest(clone(q));
    if (normalized?.ok !== true) {
      const missing = questions(normalized?.questions || ['Provide a complete supported structured window schedule before quoting.']);
      const eventId = 'intake:' + q.input_revision + ':' + await digest(missing);
      if (q.worker_status === 'needs_details' && (q.conversation || []).some(m => m.client_message_id === 'scripted:' + eventId)) return q;
      return cas(db, q, { execution_provider: SCRIPTED_PROVIDER, worker_status: 'needs_details', missing_details: missing, conversation: appendMessage(q, 'needs_details', missing.join('\n'), eventId) });
    }
    const plan = bounded(normalized.plan, 'normalized plan');
    const settings = validateSettings(plan.settings, true), lines = validateLines(plan.lines);
    if (plan.quote_id !== q.id || plan.input_revision !== q.input_revision || settings.dealer !== 'BFS' || settings.yard !== allow.yard || settings.gross_margin !== q.settings?.gross_margin || !lines.length || lines.length !== q.lines?.length) fail(400, 'The normalized plan changed request identity or explicit pricing');
    for (const [index, line] of lines.entries()) if (!line.style || !Number.isFinite(line.width) || !Number.isFinite(line.height) || !Number.isInteger(line.qty) || line.units !== 'in' || !line.dimension_basis || line.qty !== q.lines[index].qty || line.width !== q.lines[index].width || line.height !== q.lines[index].height || line.dimension_basis !== q.lines[index].dimension_basis) fail(400, 'The normalized plan changed or omitted an explicit window requirement');
    const planHash = await digest(plan);
    if (planHash !== config.expected_plan_hash) fail(403, 'The normalized plan differs from the exact approved pilot benchmark');
    const run = { phase: 'prepared', input_revision: q.input_revision, input_hash: inputHash, plan_hash: planHash, plan, prepared_at: at(), ...(config.queue_scope_hash ? { queue_scope_hash: config.queue_scope_hash } : {}) };
    return cas(db, q, { execution_provider: SCRIPTED_PROVIDER, worker_status: 'queued', queued_at: at(), missing_details: [], agent_run: run });
  }
  const handoff = q => ({ quote_id: q.id, input_revision: q.input_revision, operation_id: q.agent_run.operation_id, execution_token: q.agent_run.execution_token, plan_hash: q.agent_run.plan_hash, lease_expires_at: q.agent_run.lease_expires_at, plan: clone(q.agent_run.plan), checkpoint: clone(q.checkpoint || {}) });
  async function claim({ db, worker, body }) {
    requireEnabled(); workerScope(worker); requested(body); let q = await get(db, text(body.quote_id, 'quote_id')); scope(q);
    if (body.input_revision !== q.input_revision) fail(403, 'This request revision is outside the scripted pilot');
    const claimId = text(body.claim_id, 'claim_id');
    if (q.execution_provider !== SCRIPTED_PROVIDER) fail(409, 'This request is not queued for the scripted runner');
    if (q.worker_status === 'running') {
      const run = q.agent_run;
      if (run?.worker_id !== worker.id || run.claim_id !== claimId || run.plan_hash !== config.expected_plan_hash || await digest(run.plan) !== config.expected_plan_hash || !Number.isFinite(Date.parse(run.lease_expires_at)) || run.lease_expires_at <= at()) fail(409, 'An active or expired execution cannot be claimed again');
      await ownsLock(db, run); return { ok: true, quote: handoff(q), replayed: true };
    }
    await fresh(q);
    if (q.worker_status !== 'queued' || q.agent_run?.phase !== 'prepared' || q.agent_run.input_revision !== q.input_revision || q.agent_run.input_hash !== await digest(inputSnapshot(q)) || q.agent_run.plan_hash !== config.expected_plan_hash || q.agent_run.plan_hash !== await digest(q.agent_run.plan)) fail(409, 'Only an unchanged prepared queued request may be claimed');
    const slot = await lock(db); if (slot.busy_token) fail(409, 'The shared browser is already owned; expiry never permits takeover');
    const run = { ...q.agent_run, phase: 'running', operation_id: uuid(), execution_token: uuid() + uuid(), claim_id: claimId, worker_id: worker.id, started_at: at(), lease_expires_at: expiry(), event_receipts: [] };
    const taken = await db.QuoteWorkers.updateMany({ id: slot.id, busy_token: '', poll_generation: slot.poll_generation || 0 }, { $set: { busy_token: run.operation_id, busy_until: run.lease_expires_at, active_quote_id: q.id, poll_generation: (slot.poll_generation || 0) + 1, last_seen_at: at() } });
    if (taken.updated !== 1) fail(409, 'Another controller claimed the browser');
    try { q = await cas(db, q, { worker_status: 'running', agent_run: run }, { worker_status: 'queued', execution_provider: SCRIPTED_PROVIDER }); }
    catch (error) {
      // A lost CAS response can follow a committed claim. Read before releasing;
      // if that read also fails, retain the lock for explicit reconciliation.
      const latest = await get(db, q.id);
      if (latest.agent_run?.operation_id === run.operation_id && latest.worker_status === 'running') q = latest;
      else { await release(db, run); throw error; }
    }
    return { ok: true, quote: handoff(q) };
  }
  async function checked(db, worker, body, allowTerminal = false) {
    requireEnabled(); workerScope(worker); requested(body); const q = await get(db, text(body.quote_id, 'quote_id'));
    const run = q.agent_run;
    if (q.execution_provider !== SCRIPTED_PROVIDER || !run || run.worker_id !== worker.id || run.operation_id !== body.operation_id || run.input_revision !== body.input_revision || q.input_revision !== body.input_revision || run.plan_hash !== config.expected_plan_hash || run.plan_hash !== body.plan_hash || !equalSecret(run.execution_token, body.execution_token)) fail(403, 'This operation is not authorized for the current pilot revision');
    const receipt = allowTerminal && run.phase === 'completed' && (run.event_receipts || []).find(item => item.id === body.event_id);
    const completedReplay = receipt && receipt.hash === await digest(body);
    // Only an authenticated identical completed event may repair its own lock
    // after Ready or later Won conversion. Never alter the accepted quote itself.
    scope(completedReplay ? { ...q, result: null, sales_status: 'open', job_id: '', accepted_revision: 0 } : q);
    if (!allowTerminal || run.phase !== 'completed') {
      if (q.worker_status !== 'running' || run.phase !== 'running' || !Number.isFinite(Date.parse(run.lease_expires_at)) || run.lease_expires_at <= at()) fail(409, 'The runner lease ended; stop native actions');
      await ownsLock(db, run);
    }
    return q;
  }
  async function heartbeat({ db, worker, body }) {
    let q = await checked(db, worker, body);
    q = await cas(db, q, { agent_run: { ...q.agent_run, lease_expires_at: expiry(), last_seen_at: at() } });
    const changed = await db.QuoteWorkers.updateMany({ id: config.browser_slot_id, busy_token: q.agent_run.operation_id, active_quote_id: q.id }, { $set: { busy_until: q.agent_run.lease_expires_at, last_seen_at: at() } });
    if (changed.updated !== 1) fail(409, 'Browser ownership changed; stop native actions');
    return { ok: true, lease_expires_at: q.agent_run.lease_expires_at };
  }
  async function validateCheckpoint(raw, q) {
    const value = bounded(raw, 'checkpoint', 120000);
    const desktop = value.native_source === DESKTOP_NATIVE_SOURCE;
    if (value.native_source !== undefined && !desktop && value.native_source !== 'amsco_online') fail(400, 'Unknown native checkpoint source');
    if (q.checkpoint?.native_quote_id && (q.checkpoint.native_source || 'amsco_online') !== (value.native_source || 'amsco_online')) fail(409, 'Native execution source cannot change after saving');
    const id = text(value.native_quote_id, 'native quote ID', 100), number = desktop ? String(value.native_quote_number ?? '') : text(String(value.native_quote_number ?? ''), 'native quote number', 100);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail(400, 'The native quote checkpoint requires a valid GUID');
    if ((q.history || []).some(item => item.reason === 'reviewed_failed_restart' && (item.checkpoint?.native_quote_id?.toLowerCase() === id.toLowerCase() || item.checkpoint?.native_quote_number === number))) fail(409, 'A reviewed retry must save a fresh native quote; previous drafts cannot be reused');
    let url;
    if (desktop) {
      const checked = await validateDesktopCheckpoint(value, q.agent_run.plan, { policy: config.native_engine, operationId: q.agent_run.operation_id, hash });
      if (!checked.ok) fail(400, 'The desktop checkpoint does not prove saved state for this exact operation');
      if (value.native_quote_url) url = new URL(value.native_quote_url);
    } else {
      try { url = new URL(value.native_quote_url); } catch { fail(400, 'Invalid native quote checkpoint URL'); }
      if (url.protocol !== 'https:' || url.hostname !== 'amsco.wtsparadigm.com' || url.username || url.password || url.search || url.hash || url.pathname.split('/')[1] !== 'quotes' || url.pathname.split('/')[2] !== id) fail(400, 'Use a newly saved native quote with its matching identity');
    }
    if (id.toLowerCase() === EXCLUDED_NATIVE_ID || number === EXCLUDED_NATIVE_NUMBER) fail(400, 'Use a newly saved native quote with its matching identity');
    for (const key of ['native_quote_id', 'native_quote_number', 'native_quote_url']) if (q.checkpoint?.[key] && q.checkpoint[key] !== ({ native_quote_id: id, native_quote_number: number, native_quote_url: url?.href })[key]) fail(409, 'Native checkpoint identity cannot change');
    if (value.input_revision !== undefined && value.input_revision !== q.input_revision) fail(409, 'Checkpoint revision differs');
    if (!Array.isArray(value.saved_lines) || value.saved_lines.length > q.agent_run.plan.lines.length) fail(400, 'Supply the confirmed saved-line identities');
    const indices = new Set(), ids = new Set(), numbers = new Set();
    const saved = value.saved_lines.map(item => {
      if (!Number.isInteger(item.source_index) || item.source_index < 0 || item.source_index >= q.agent_run.plan.lines.length || indices.has(item.source_index)) fail(400, 'Invalid checkpoint source line');
      const lineId = text(item.native_line_id, 'native line ID'), lineNumber = text(String(item.native_line_number ?? ''), 'native line number');
      if (!/^\d+$/.test(lineNumber) || Number(lineNumber) <= 0 || ids.has(lineId) || numbers.has(lineNumber)) fail(400, 'Saved native line identities must be distinct');
      indices.add(item.source_index); ids.add(lineId); numbers.add(lineNumber); return { source_index: item.source_index, native_line_id: lineId, native_line_number: lineNumber };
    });
    for (const previous of q.checkpoint?.saved_lines || []) if (!saved.some(item => stable(item) === stable(previous))) fail(409, 'A confirmed saved line cannot be removed or replaced');
    return { native_quote_id: id, ...(number ? { native_quote_number: number } : {}), ...(url ? { native_quote_url: url.href } : {}), ...(desktop ? { native_source: DESKTOP_NATIVE_SOURCE, native_engine: clone(value.native_engine) } : {}), input_revision: q.input_revision, saved_lines: saved, updated_at: at() };
  }
  async function report({ db, worker, body }) {
    let q = await checked(db, worker, body, true); const run = q.agent_run;
    const eventId = text(body.event_id, 'event_id'), fingerprint = await digest(body);
    const previous = (run.event_receipts || []).find(item => item.id === eventId);
    if (previous) {
      if (previous.hash !== fingerprint) fail(409, 'An event ID cannot be reused for a different payload');
      if (run.phase === 'completed') await release(db, run);
      return { ok: true, status: q.worker_status, quote: publicQuote(q), replayed: true };
    }
    if (q.worker_status !== 'running' || run.phase !== 'running') fail(409, 'This operation has finished; no new reports are accepted');
    if ((run.event_receipts || []).length >= 512) fail(409, 'The pilot event limit requires review');
    const status = body.action === 'checkpoint' ? 'running' : body.status;
    if (!TERMINAL.has(status) && !(body.action === 'checkpoint' && status === 'running')) fail(400, 'Invalid scripted runner status');
    if (body.settings !== undefined || body.lines !== undefined || body.result !== undefined || body.request_continuation !== undefined) fail(400, 'The runner cannot replace inputs, inject a result or request agent continuation');
    const patch = { worker_status: status, agent_run: { ...run, phase: TERMINAL.has(status) ? 'completed' : 'running', event_receipts: [...(run.event_receipts || []), { id: eventId, hash: fingerprint }], last_report_at: at(), ...(TERMINAL.has(status) ? { terminal_status: status, completed_at: at() } : {}) } };
    if (body.checkpoint !== undefined) patch.checkpoint = await validateCheckpoint(body.checkpoint, q);
    if (status === 'needs_sign_in' && body.native_started === false && !q.checkpoint?.native_quote_id && !patch.checkpoint) patch.agent_run.native_started = false;
    if (body.action === 'checkpoint' && !patch.checkpoint) fail(400, 'A checkpoint event requires saved native state');
    if (status === 'needs_details') patch.missing_details = questions(body.missing_details);
    if (status === 'ready') {
      if (body.checkpoint !== undefined) fail(400, 'Persist the saved-line checkpoint before reporting Ready');
      const checkpoint = q.checkpoint, observed = bounded(body.observed, 'reopened observation');
      if (!checkpoint?.native_quote_id || observed.native_quote_id !== checkpoint.native_quote_id || String(observed.native_quote_number ?? '') !== String(checkpoint.native_quote_number ?? '') || (observed.native_quote_url || '') !== (checkpoint.native_quote_url || '') || (observed.native_source || 'amsco_online') !== (checkpoint.native_source || 'amsco_online') || observed.reopened !== true || !Number.isFinite(Date.parse(observed.checked_at)) || Date.parse(observed.checked_at) < Date.parse(run.started_at) || Date.parse(observed.checked_at) > now().getTime() + 60000 || checkpoint.saved_lines.length !== run.plan.lines.length) fail(400, 'Ready requires current reopened evidence for all checkpointed native lines');
      if (checkpoint.native_source === DESKTOP_NATIVE_SOURCE && (observed.native_engine?.persistence?.artifact_sha256 !== checkpoint.native_engine?.persistence?.artifact_sha256 || observed.native_engine?.persistence?.artifact_id !== checkpoint.native_engine?.persistence?.artifact_id)) fail(400, 'The reopened desktop artifact differs from the saved checkpoint');
      const verified = await validateReady({ ...clone(run.plan), native_quote_id: checkpoint.native_quote_id }, observed, { policy: config.native_engine, operationId: run.operation_id, startedAt: run.started_at, now: now(), hash });
      if (verified?.ok !== true) fail(400, 'The reopened quote did not pass product, pricing and totals verification');
      const result = validateResult(verified.result);
      if (result.native_quote_id !== checkpoint.native_quote_id || result.lines.length !== run.plan.lines.length) fail(400, 'Verified result differs from the retained native checkpoint');
      for (const saved of checkpoint.saved_lines) { const line = result.lines[saved.source_index]; if (line.native_line_id !== saved.native_line_id || String(line.native_line_number) !== saved.native_line_number) fail(400, 'Verified result line identity differs from its checkpoint'); }
      patch.result = result; patch.missing_details = [];
      patch.agent_run.verification = { ...(observed.native_source ? { native_source: observed.native_source } : {}), reopened: true, checked_at: observed.checked_at, dealer: observed.dealer, yard: observed.yard, gross_margin: observed.gross_margin };
      patch.history = [...(q.history || []), { revision: q.input_revision, recorded_at: at(), reason: 'verified_by_scripted_runner', worker_status: 'ready', settings: clone(q.settings), lines: clone(run.plan.lines), result: clone(result) }];
    }
    const message = status === 'ready' ? 'Your quote is ready to be viewed.' : status === 'needs_details' ? patch.missing_details.join('\n') : body.message;
    if (message) patch.conversation = appendMessage(q, status, message, eventId);
    q = await cas(db, q, patch, { worker_status: 'running', execution_provider: SCRIPTED_PROVIDER });
    if (TERMINAL.has(status)) await release(db, run);
    return { ok: true, status: q.worker_status, quote: publicQuote(q) };
  }
  const checkpoint = args => report({ ...args, body: { ...args.body, action: 'checkpoint' } });
  return { configured: enabled, provider: SCRIPTED_PROVIDER, afterInput, authenticate, claim, heartbeat, checkpoint, report };
}

