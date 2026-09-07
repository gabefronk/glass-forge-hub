import { HttpError, sha256, validateLines, validateSettings, sanitizePublic } from './windowQuotesCore.js';
import { createScriptedExecution } from './scriptedExecution.js';

const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (value, name, max = 150) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'Invalid ' + name); return value; };
const hasNative = value => value && typeof value === 'object' && Object.entries(value).some(([key, item]) => (/^native_quote_(id|number|url)$/.test(key) && !!item) || (item && typeof item === 'object' && hasNative(item)));
const LOCK_NAME = 'Base44 Window Quotes browser';
const ZERO_HASH = '0'.repeat(64);
const sameYard = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase();

// Queue intake selects a fresh immutable plan; all native operation mutations
// continue through the already-tested exact-request executor and its global lock.
export function createScriptedQueueExecution({ config = {}, normalizeRequest, normalizeIntake, validateReady, hash = sha256, now = () => new Date(), uuid } = {}) {
  const enabled = config.enabled === true, allow = config.queue_allow || {};
  const at = () => now().toISOString();
  const digest = value => hash(stable(value));
  if (enabled && (config.mode !== 'queue' || allow.requester_email !== 'gabefronk@gmail.com' || allow.dealer !== 'BFS' || !sameYard(allow.yard, 'BFS-UTAH DESIGN (11)') || !Number.isFinite(Date.parse(allow.created_after)) || typeof normalizeRequest !== 'function' || typeof validateReady !== 'function')) fail(503, 'Invalid new-request queue configuration');
  const scopeHash = () => digest({ version: 1, allow, worker_id: config.worker_id, browser_slot_id: config.browser_slot_id });
  const baseConfig = (q, expected) => ({ ...config, allow: { quote_id: q.id, request_id: q.request_id, input_revision: q.input_revision, requester_email: allow.requester_email, dealer: allow.dealer, yard: sameYard(q.settings?.yard, allow.yard) ? q.settings.yard : allow.yard }, expected_plan_hash: expected });
  // This neutral child is used only for its existing worker-key authentication.
  const auth = createScriptedExecution({ config: baseConfig({ id: 'queue-auth-only', request_id: 'queue-auth-only', input_revision: 1 }, ZERO_HASH), normalizeRequest, validateReady, hash, now, ...(uuid ? { uuid } : {}) });
  const requireEnabled = () => { if (!enabled) fail(503, 'Automatic window quoting is disabled'); };
  const workerScope = worker => { if (!worker || worker.id !== config.worker_id || worker.enabled !== true || worker.token_hash !== config.worker_key_hash || !(worker.allowed_dealers || []).includes('BFS')) fail(401, 'Runner authentication failed'); };
  const get = async (db, id) => { const rows = await db.QuoteRequests.filter({ id: text(id, 'quote_id') }, undefined, 1); if (rows.length !== 1) fail(404, 'Quote request not found'); return rows[0]; };
  const scope = q => {
    if (!q || q.id === '6a9dadff1e196279b733762e' || q.requester_email !== allow.requester_email || !Number.isFinite(Date.parse(q.created_date)) || Date.parse(q.created_date) < Date.parse(allow.created_after)) fail(403, 'Only new requests from the configured owner may enter automatic quoting');
    text(q.request_id, 'request_id');
    if (!Number.isSafeInteger(q.input_revision) || q.input_revision < 1) fail(403, 'Invalid request revision');
  };
  const fresh = q => {
    if (q.result || q.job_id || q.accepted_revision || q.sales_status === 'won' || hasNative(q.checkpoint) || (q.checkpoint && Object.keys(q.checkpoint).length) || hasNative(q.history) || (q.history || []).some(item => ['running', 'failed', 'ready'].includes(item.worker_status))) fail(409, 'Historical or native quote execution requires review; create a new request');
    if (q.execution_provider && q.execution_provider !== 'deterministic' || q.agent_run && q.agent_run.phase !== 'prepared' || !['draft', 'needs_details', 'queued'].includes(q.worker_status)) fail(409, 'Only a new unstarted request may be queued');
  };
  const slot = async db => { const rows = await db.QuoteWorkers.filter({ id: config.browser_slot_id, name: LOCK_NAME }, undefined, 2); if (rows.length !== 1) fail(503, 'The shared quoting browser slot is unavailable'); return rows[0]; };
  async function child(q, expected) {
    return createScriptedExecution({ config: { ...baseConfig(q, expected), queue_scope_hash: await scopeHash() }, normalizeRequest, validateReady, hash, now, ...(uuid ? { uuid } : {}) });
  }
  async function prepared(q) {
    scope(q); const run = q.agent_run;
    if (q.execution_provider !== 'deterministic' || !run || run.queue_scope_hash !== await scopeHash() || run.input_revision !== q.input_revision || !/^[a-f0-9]{64}$/.test(run.plan_hash || '') || await digest(run.plan) !== run.plan_hash) fail(409, 'This request has no matching immutable queue plan');
    return child(q, run.plan_hash);
  }
  async function retrySignIn({ db, q, action }) {
    if (action !== 'queue' || q.agent_run?.phase !== 'completed' || q.agent_run.terminal_status !== 'needs_sign_in') return q;
    if (q.worker_status !== 'needs_sign_in' || q.agent_run.native_started !== false || q.agent_run.queue_scope_hash !== await scopeHash() || hasNative(q) || (q.checkpoint && Object.keys(q.checkpoint).length) || q.result || q.job_id || q.accepted_revision) fail(409, 'This prior execution requires review before any retry');
    const currentSlot = await slot(db);
    if (currentSlot.busy_token) fail(409, 'The previous browser operation must be released before retrying');
    const patch = { input_revision: q.input_revision + 1, worker_status: 'draft', agent_run: null, missing_details: [], state_version: (q.state_version || 0) + 1, history: [...(q.history || []), { revision: q.input_revision, reason: 'sign_in_retry_before_native_creation', worker_status: 'needs_sign_in', recorded_at: at() }] };
    const changed = await db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version || 0, input_revision: q.input_revision, worker_status: 'needs_sign_in' }, { $set: patch });
    if (changed.updated !== 1) fail(409, 'The request changed; reload before retrying');
    return { ...q, ...patch };
  }
  async function afterInput(args) {
    if (!enabled) return args.q;
    let q = await get(args.db, args.q.id); scope(q);
    if (args.user?.role !== 'admin' || args.user.email !== allow.requester_email) fail(403, 'This administrator is not the configured requester');
    if (q.worker_status === 'running') { await prepared(q); return q; }
    q = await retrySignIn({ ...args, q }); fresh(q);
    if (q.worker_status === 'queued') return (await prepared(q)).afterInput({ ...args, q });
    let intake;
    if (normalizeIntake) {
      intake = await normalizeIntake(clone(q));
      if (intake?.quote) {
        if (intake.quote.id !== q.id || intake.quote.input_revision !== q.input_revision) fail(400, 'Intake normalization changed request identity');
        let settings, lines;
        try { settings = validateSettings(intake.quote.settings || {}); lines = validateLines(intake.quote.lines || []); }
        catch (error) { if (intake.ok !== false || !(error instanceof HttpError)) throw error; }
        // Incomplete parsing may include invalid partial rows. Preserve the user's
        // saved input and return clarification instead of failing before questions.
        if (settings && lines && (stable(settings) !== stable(q.settings) || stable(lines) !== stable(q.lines))) {
          const patch = { settings, lines, state_version: (q.state_version || 0) + 1 };
          const changed = await args.db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version || 0, input_revision: q.input_revision, worker_status: q.worker_status }, { $set: patch });
          if (changed.updated !== 1) fail(409, 'The request changed during intake; reload before quoting');
          q = { ...q, ...patch };
        }
      }
    }
    const scopeQuestions = [];
    if (q.settings?.dealer && q.settings.dealer !== allow.dealer) scopeQuestions.push('Automatic quoting currently supports the BFS account only. Please review this request.');
    if (q.settings?.yard && !sameYard(q.settings.yard, allow.yard)) scopeQuestions.push('Automatic quoting currently supports BFS-UTAH DESIGN (11) only. Please confirm that shipping yard or request manual review.');
    if (intake?.ok === false || scopeQuestions.length) {
      const questions = [...new Set([...scopeQuestions, ...(intake?.questions || [])].map(item => sanitizePublic(text(item, 'clarification question', 2000))))];
      if (!questions.length) fail(400, 'Intake requires complete clarification questions');
      const missing = questions.length <= 30 ? questions : [...questions.slice(0, 29), 'Additional issues remain in the original schedule. Review the complete schedule preview before quoting.'];
      const eventId = 'queue-intake:' + q.input_revision + ':' + await digest(missing);
      if (q.worker_status === 'needs_details' && (q.conversation || []).some(item => item.client_message_id === eventId)) return q;
      const patch = { execution_provider: 'deterministic', worker_status: 'needs_details', missing_details: missing, state_version: (q.state_version || 0) + 1, conversation: [...(q.conversation || []), { role: 'assistant', content: missing.join('\n'), revision: q.input_revision, client_message_id: eventId, message_at: at(), author: 'Window Quotes', kind: 'clarification', worker_status: 'needs_details' }] };
      const changed = await args.db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version || 0, input_revision: q.input_revision, worker_status: q.worker_status }, { $set: patch });
      if (changed.updated !== 1) fail(409, 'The request changed; reload before quoting');
      return { ...q, ...patch };
    }
    const normalized = await normalizeRequest(clone(q));
    const execution = await child(q, normalized?.ok === true ? await digest(normalized.plan) : ZERO_HASH);
    return execution.afterInput({ ...args, q });
  }
  async function claim(args) {
    requireEnabled(); workerScope(args.worker); const q = await get(args.db, args.body.quote_id); scope(q);
    const execution = await prepared(q);
    if (q.worker_status === 'queued') {
      fresh(q); const normalized = await normalizeRequest(clone(q));
      if (normalized?.ok !== true || await digest(normalized.plan) !== q.agent_run.plan_hash) fail(409, 'Prepared inputs changed or are unsupported; review this request');
    }
    return execution.claim(args);
  }
  const forward = method => async args => {
    requireEnabled(); workerScope(args.worker); const q = await get(args.db, args.body.quote_id);
    const output = await (await prepared(q))[method](args);
    if (method === 'heartbeat' && args.worker.runner_presence) await args.db.QuoteWorkers.updateMany({ id: config.worker_id, enabled: true, token_hash: config.worker_key_hash }, { $set: { runner_presence: { ...args.worker.runner_presence, runner_status: 'running', last_seen_at: at() }, last_seen_at: at() } });
    return output;
  };
  function presence(body) {
    const runner_id = text(body.runner_id, 'runner_id', 100);
    if (!/^[A-Za-z0-9_-]+$/.test(runner_id)) fail(400, 'Invalid runner_id');
    const runner_status = body.runner_status ?? 'idle';
    if (!['idle', 'running', 'attention', 'stopping'].includes(runner_status)) fail(400, 'Invalid runner status');
    const browser = body.browser;
    if (!browser || typeof browser !== 'object' || Array.isArray(browser) || Object.keys(browser).some(key => !['state', 'dealer'].includes(key)) || !['authenticated', 'needs_sign_in', 'unknown'].includes(browser.state) || (browser.state === 'authenticated' ? browser.dealer !== 'BFS' : browser.dealer !== undefined)) fail(400, 'Provide an explicit supported browser state');
    let attention;
    if (body.attention !== undefined) {
      const item = body.attention;
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['quote_id', 'input_revision', 'code'].includes(key)) || !Number.isSafeInteger(item.input_revision) || item.input_revision < 1) fail(400, 'Invalid runner attention');
      attention = { quote_id: text(item.quote_id, 'attention quote_id'), input_revision: item.input_revision, code: text(item.code, 'attention code', 100) };
      if (!/^[A-Za-z0-9_-]+$/.test(attention.quote_id)) fail(400, 'Invalid attention quote_id');
      if (!/^[a-z0-9_]+$/.test(attention.code)) fail(400, 'Invalid attention code');
    }
    return { runner_id, runner_status, browser: clone(browser), browser_reported_at: at(), ...(attention ? { attention } : {}), last_seen_at: at() };
  }
  async function poll({ db, worker, body }) {
    requireEnabled(); workerScope(worker); const reported = presence(body);
    const changed = await db.QuoteWorkers.updateMany({ id: config.worker_id, enabled: true, token_hash: config.worker_key_hash }, { $set: { runner_presence: reported, last_seen_at: at() } });
    if (changed.updated !== 1) fail(401, 'Runner authentication changed');
    const response = (status, reason, quote = null) => ({ ok: true, status, ...(reason ? { reason } : {}), quote, retry_after_ms: 15000 });
    if (reported.runner_status !== 'idle') return response('blocked', reported.runner_status);
    const currentSlot = await slot(db);
    if (currentSlot.busy_token) return response('blocked', 'browser_operation_requires_completion_or_review');
    if (reported.browser.state !== 'authenticated') return response('needs_sign_in', reported.browser.state);
    const candidates = await db.QuoteRequests.filter({ worker_status: 'queued', execution_provider: 'deterministic', requester_email: allow.requester_email, 'agent_run.queue_scope_hash': await scopeHash(), created_date: { $gte: allow.created_after } }, 'queued_at', 20);
    for (const q of candidates) {
      try {
        fresh(q); await prepared(q); const normalized = await normalizeRequest(clone(q));
        if (normalized?.ok !== true || await digest(normalized.plan) !== q.agent_run.plan_hash) return response('blocked', 'prepared_input_requires_review');
        return response('queued', undefined, { quote_id: q.id, input_revision: q.input_revision, plan_hash: q.agent_run.plan_hash, plan: clone(q.agent_run.plan) });
      } catch (error) { if (!(error instanceof HttpError)) throw error; return response('blocked', 'prepared_request_requires_review'); }
    }
    return response('idle');
  }
  async function getStatus({ db }) {
    const status = { configured: false, online: false, provider: 'deterministic', name: 'Automatic window quoting', last_seen_at: null, browser_authenticated: null, browser_state: 'unknown', browser_state_source: 'runner_report', runner_status: 'offline' };
    if (!enabled) return status;
    const workers = await db.QuoteWorkers.filter({ id: config.worker_id, enabled: true, token_hash: config.worker_key_hash }, undefined, 2);
    if (workers.length !== 1 || !(workers[0].allowed_dealers || []).includes('BFS')) return status;
    status.configured = true; const reported = workers[0].runner_presence, age = now().getTime() - Date.parse(reported?.last_seen_at);
    if (!Number.isFinite(age) || age < 0) return status;
    status.last_seen_at = reported.last_seen_at; status.online = age < 100000;
    if (status.online) {
      status.runner_status = reported.runner_status;
      const browserAge = now().getTime() - Date.parse(reported.browser_reported_at);
      if (browserAge >= 0 && browserAge < 100000) { status.browser_state = reported.browser.state; status.browser_authenticated = reported.browser.state === 'authenticated'; }
      if (reported.runner_status === 'stopping') status.online = false;
    }
    return status;
  }
  return { configured: enabled, provider: 'deterministic', authenticate: auth.authenticate, afterInput, claim, poll, getStatus, heartbeat: forward('heartbeat'), checkpoint: forward('checkpoint'), report: forward('report') };
}
