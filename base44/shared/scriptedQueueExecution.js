import { createNativePricePreviewService } from './nativePricePreview.js';
import { HttpError, sha256, validateLines, validateSettings, sanitizePublic } from './windowQuotesCore.js';
import { createScriptedExecution } from './scriptedExecution.js';
import { reviewedRestartAllowsHistory } from './reviewedRestart.js';
import { DESKTOP_NATIVE_SOURCE, nativeEnginePolicyReady, nativeEnginePresenceReady, validateDesktopCheckpoint } from './nativeEngineObservation.js';

const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (value, name, max = 150) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'Invalid ' + name); return value; };
const hasNative = value => value && typeof value === 'object' && Object.entries(value).some(([key, item]) => (/^native_quote_(id|number|url)$/.test(key) && !!item) || (item && typeof item === 'object' && hasNative(item)));
const LOCK_NAME = 'Base44 Window Quotes browser';
const ZERO_HASH = '0'.repeat(64);
const sameYard = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase();
const ONLINE_QUOTE_ISSUES = new Set(['unsupported_product', 'unverified_product', 'unsupported_option', 'unsupported_colors', 'unsupported_dimensions', 'unsupported_assembly']);
export function needsOnlineQuote(normalized, assessment) {
  if (normalized?.ok !== false || !Array.isArray(normalized.issues) || normalized.issues.length === 0) return false;
  if (Array.isArray(assessment?.questions) && assessment.questions.length > 0) return false;
  return normalized.issues.every(item => item && ONLINE_QUOTE_ISSUES.has(item.code));
}

// Queue intake selects a fresh immutable plan; all native operation mutations
// continue through the already-tested exact-request executor and its global lock.
export function createScriptedQueueExecution({ config = {}, normalizeRequest, normalizeIntake, validateReady, fallbackExecution = null, hash = sha256, now = () => new Date(), uuid } = {}) {
  const enabled = config.enabled === true, allow = config.queue_allow || {};
  if (config.native_engine?.enabled === true && !nativeEnginePolicyReady(config.native_engine)) fail(503, 'Invalid native desktop engine configuration');
  const at = () => now().toISOString();
  const digest = value => hash(stable(value));
  if (enabled && (config.mode !== 'queue' || allow.requester_email !== 'gabefronk@gmail.com' || allow.dealer !== 'BFS' || !sameYard(allow.yard, 'BFS-UTAH DESIGN (11)') || !Number.isFinite(Date.parse(allow.created_after)) || typeof normalizeRequest !== 'function' || typeof validateReady !== 'function')) fail(503, 'Invalid new-request queue configuration');
  const previews = createNativePricePreviewService({ config, now, hash });
  const previewAction = method => args => { requireEnabled(); workerScope(args.worker); return previews[method](args); };
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
  const fresh = async q => {
    const reviewed = q.reviewed_restart?.queue_scope_hash === await scopeHash() && await reviewedRestartAllowsHistory(q, hash);
    if (q.result || q.job_id || q.accepted_revision || q.sales_status === 'won' || hasNative(q.checkpoint) || (q.checkpoint && Object.keys(q.checkpoint).length) || (!reviewed && (hasNative(q.history) || (q.history || []).some(item => ['running', 'failed', 'ready'].includes(item.worker_status))))) fail(409, 'Historical or native quote execution requires review; create a new request');
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
  async function retryFailed({ db, q, user, body }) {
    requireEnabled();
    if (user?.role !== 'admin' || user.email !== allow.requester_email) fail(403, 'Only the configured administrator may review a failed quote');
    if (!body || Object.keys(body).some(key => !['action', 'quote_id', 'retry_id', 'expected_revision', 'expected_state_version', 'expected_native_quote_id', 'reviewed_previous_draft'].includes(key))
      || body.quote_id !== q.id || !/^[A-Za-z0-9_-]{1,150}$/.test(body.retry_id || '') || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1
      || !Number.isSafeInteger(body.expected_state_version) || body.expected_state_version < 0 || body.reviewed_previous_draft !== true
      || !(body.expected_native_quote_id === null || /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.expected_native_quote_id || ''))) fail(400, 'Review the previous draft and provide the exact failed request revision');
    const fingerprint = await digest({ ...body, reviewer: user.id || user.email });
    const replay = current => {
      const previous = (current.history || []).find(item => item.reason === 'reviewed_failed_restart' && item.retry_id === body.retry_id);
      if (!previous) return null;
      if (previous.request_fingerprint !== fingerprint) fail(409, 'This retry identifier was already used for a different review');
      return { quote: current, replayed: true };
    };
    const existing = replay(q); if (existing) return existing;
    const run = q.agent_run;
    if (q.input_revision !== body.expected_revision || (q.state_version || 0) !== body.expected_state_version || q.worker_status !== 'failed'
      || q.execution_provider !== 'deterministic' || run?.phase !== 'completed' || run.terminal_status !== 'failed' || run.input_revision !== q.input_revision
      || !/^[A-Za-z0-9_-]{1,160}$/.test(run.operation_id || '') || run.worker_id !== config.worker_id || run.queue_scope_hash !== await scopeHash() || !/^[a-f0-9]{64}$/.test(run.plan_hash || '')
      || !Number.isFinite(Date.parse(run.completed_at)) || !Number.isFinite(Date.parse(run.started_at)) || Date.parse(run.completed_at) < Date.parse(run.started_at)
      || !run.plan || run.plan.quote_id !== q.id || run.plan.input_revision !== q.input_revision || !Array.isArray(run.plan.lines) || await digest(run.plan) !== run.plan_hash
      || q.result || q.job_id || q.accepted_revision || q.sales_status === 'won' || q.accepted_snapshot
      || q.conversion_token || q.lease_token && q.lease_expires_at > at()) fail(409, 'Only this unchanged, completed failed attempt may be retried');
    const oldCheckpoint = q.checkpoint || {}, nativeId = oldCheckpoint.native_quote_id || null;
    if (nativeId !== body.expected_native_quote_id) fail(409, 'The saved native quote changed; review it again');
    const desktop = oldCheckpoint.native_source === DESKTOP_NATIVE_SOURCE;
    if (nativeId && (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(nativeId) || !desktop && !/^\d{1,30}$/.test(String(oldCheckpoint.native_quote_number || '')) || oldCheckpoint.input_revision !== q.input_revision)) fail(409, 'The previous native checkpoint needs review');
    if (desktop && !(await validateDesktopCheckpoint(oldCheckpoint, run.plan, { policy: config.native_engine, operationId: run.operation_id, hash })).ok) fail(409, 'The saved desktop checkpoint needs review');
    const savedLines = nativeId ? oldCheckpoint.saved_lines : (oldCheckpoint.saved_lines ?? []);
    if (!Array.isArray(savedLines) || savedLines.length > 300 || savedLines.length > run.plan.lines.length || savedLines.some(line => !line || !Number.isInteger(line.source_index) || line.source_index < 0 || line.source_index >= run.plan.lines.length || !/^[A-Za-z0-9_-]{1,150}$/.test(line.native_line_id || '') || !/^\d{1,30}$/.test(String(line.native_line_number || '')) || Number(line.native_line_number) <= 0)
      || ['source_index', 'native_line_id', 'native_line_number'].some(key => new Set(savedLines.map(line => String(line[key]))).size !== savedLines.length)) fail(409, 'The previous saved-line checkpoint needs review');
    if (!nativeId && (Object.keys(oldCheckpoint).length || savedLines.length)) fail(409, 'The previous checkpoint is incomplete');
    const currentSlot = await slot(db);
    if (currentSlot.busy_token || currentSlot.active_quote_id) fail(409, 'The prior browser operation must be released before retrying');
    if ((q.history || []).filter(item => item.reason === 'reviewed_failed_restart').length >= 20) fail(409, 'This request has reached its reviewed retry limit');
    const nextRevision = q.input_revision + 1, attemptId = uuid ? uuid() : crypto.randomUUID();
    const checkpoint = nativeId ? { native_quote_id: nativeId, ...(oldCheckpoint.native_quote_number ? { native_quote_number: String(oldCheckpoint.native_quote_number) } : {}),
      ...(desktop ? { native_source: DESKTOP_NATIVE_SOURCE, native_engine: clone(oldCheckpoint.native_engine), ...(oldCheckpoint.native_quote_url ? { native_quote_url: oldCheckpoint.native_quote_url } : {}) } : {}), input_revision: q.input_revision,
      saved_lines: savedLines.map(line => ({ source_index: line.source_index, native_line_id: line.native_line_id, native_line_number: String(line.native_line_number) })) } : {};
    const priorOperation = Object.fromEntries(['operation_id', 'input_revision', 'plan_hash', 'worker_id', 'phase', 'terminal_status', 'started_at', 'completed_at'].filter(key => run[key] !== undefined).map(key => [key, clone(run[key])]));
    const archive = { revision: q.input_revision, next_revision: nextRevision, recorded_at: at(), reason: 'reviewed_failed_restart', worker_status: 'failed', retry_id: body.retry_id,
      attempt_id: attemptId, request_fingerprint: fingerprint, reviewed_by: user.id || user.email, reviewed_state_version: q.state_version || 0,
      settings: clone(q.settings || {}), lines: clone(q.lines || []), intake_assessment: clone(q.intake_assessment || null), checkpoint, prior_operation: priorOperation };
    const history = [...(q.history || []), archive];
    const review = { version: 1, quote_id: q.id, retry_id: body.retry_id, attempt_id: attemptId, input_revision: nextRevision, from_revision: q.input_revision,
      previous_native_quote_id: nativeId || undefined, queue_scope_hash: await scopeHash(), history_count: history.length, history_hash: await digest(history) };
    const patch = { input_revision: nextRevision, state_version: (q.state_version || 0) + 1, worker_status: 'draft', checkpoint: {}, agent_run: null, reviewed_restart: review,
      missing_details: [], worker_id: '', lease_token: '', lease_revision: 0, lease_expires_at: '', last_worker_event_id: '', last_worker_lease_token: '', queued_at: '', history,
      conversation: [...(q.conversation || []), { role: 'assistant', content: 'A fresh quote attempt was requested. The previous draft is retained in request history.', revision: nextRevision, client_message_id: 'reviewed-retry:' + body.retry_id, message_at: at(), author: 'Window Quotes', kind: 'retry', worker_status: 'draft' }] };
    const changed = await db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version || 0, input_revision: q.input_revision, worker_status: 'failed', 'agent_run.operation_id': run.operation_id, 'agent_run.phase': 'completed', 'agent_run.terminal_status': 'failed' }, { $set: patch });
    if (changed.updated !== 1) { const concurrent = replay(await get(db, q.id)); if (concurrent) return concurrent; fail(409, 'The request changed during retry review'); }
    return { quote: { ...q, ...patch }, replayed: false };
  }
  async function retrySignIn({ db, q, action }) {
    if (action !== 'queue' || q.agent_run?.phase !== 'completed' || q.agent_run.terminal_status !== 'needs_sign_in') return q;
    const reviewed = q.reviewed_restart?.queue_scope_hash === await scopeHash() && await reviewedRestartAllowsHistory(q, hash);
    if (q.worker_status !== 'needs_sign_in' || q.agent_run.native_started !== false || q.agent_run.queue_scope_hash !== await scopeHash() || (!reviewed && hasNative(q)) || (q.checkpoint && Object.keys(q.checkpoint).length) || q.result || q.job_id || q.accepted_revision || q.sales_status === 'won') fail(409, 'This prior execution requires review before any retry');
    const currentSlot = await slot(db);
    if (currentSlot.busy_token || currentSlot.active_quote_id) fail(409, 'The previous browser operation must be released before retrying');
    const patch = { ...(reviewed ? { reviewed_restart: { ...q.reviewed_restart, input_revision: q.input_revision + 1 } } : {}), input_revision: q.input_revision + 1, worker_status: 'draft', agent_run: null, missing_details: [], state_version: (q.state_version || 0) + 1, history: [...(q.history || []), { revision: q.input_revision, reason: 'sign_in_retry_before_native_creation', worker_status: 'needs_sign_in', recorded_at: at() }] };
    const changed = await db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version || 0, input_revision: q.input_revision, worker_status: 'needs_sign_in' }, { $set: patch });
    if (changed.updated !== 1) fail(409, 'The request changed; reload before retrying');
    return { ...q, ...patch };
  }
  async function afterInput(args) {
    if (!enabled) return args.q;
    let q = await get(args.db, args.q.id); scope(q);
    if (args.user?.role !== 'admin' || args.user.email !== allow.requester_email) fail(403, 'This administrator is not the configured requester');
    if (args.action === 'retry_failed') {
      const restarted = await retryFailed({ ...args, q }); q = restarted.quote;
      if (restarted.replayed) return q;
    }
    if (q.worker_status === 'running') { await prepared(q); return q; }
    q = await retrySignIn({ ...args, q }); await fresh(q);
    if (q.worker_status === 'queued') return (await prepared(q)).afterInput({ ...args, q });
    let intake;
    if (normalizeIntake) {
      intake = await normalizeIntake(clone(q), { client: args.client, action: args.action });
      if (intake?.quote) {
        if (intake.quote.id !== q.id || intake.quote.input_revision !== q.input_revision) fail(400, 'Intake normalization changed request identity');
        let settings, lines;
        try { settings = validateSettings(intake.quote.settings || {}); lines = validateLines(intake.quote.lines || []); }
        catch (error) { if (intake.ok !== false || !(error instanceof HttpError)) throw error; }
        // Incomplete parsing may include invalid partial rows. Preserve the user's
        // saved input and return clarification instead of failing before questions.
        const assessment = intake.intake_assessment;
        if (assessment && (assessment.input_revision !== q.input_revision || !['ready', 'needs_details', 'product_review', 'unavailable'].includes(assessment.status))) fail(400, 'Intake assessment does not match this request');
        const normalizedChanged = settings && lines && (stable(settings) !== stable(q.settings) || stable(lines) !== stable(q.lines));
        const assessmentChanged = assessment && stable(assessment) !== stable(q.intake_assessment);
        if (normalizedChanged || assessmentChanged) {
          const patch = { ...(normalizedChanged ? { settings, lines } : {}), ...(assessment ? { intake_assessment: sanitizePublic(assessment) } : {}), state_version: (q.state_version || 0) + 1 };
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
      const unsupportedPlan = !scopeQuestions.length && fallbackExecution?.configured ? await normalizeRequest(clone(q)) : null;
      if (needsOnlineQuote(unsupportedPlan, intake?.intake_assessment)) return fallbackExecution.afterInput({ ...args, q });
      const questions = [...new Set([...scopeQuestions, ...(intake?.questions || [])].map(item => sanitizePublic(text(item, 'clarification question', 2000))))];
      if (!questions.length) fail(400, 'Intake requires complete clarification questions');
      const missing = questions.length <= 30 ? questions : [...questions.slice(0, 29), 'Additional issues remain in the original schedule. Review the complete schedule preview before quoting.'];
      const eventId = 'queue-intake:' + q.input_revision + ':' + await digest(missing);
      if (q.worker_status === 'needs_details' && (q.conversation || []).some(item => item.client_message_id === eventId)) return q;
      const content = intake?.assistant_message ? sanitizePublic(text(intake.assistant_message, 'intake explanation', 18000)) + (scopeQuestions.length ? '\n\n' + scopeQuestions.join('\n') : '') : missing.join('\n');
      const patch = { execution_provider: 'deterministic', worker_status: 'needs_details', missing_details: missing, state_version: (q.state_version || 0) + 1, conversation: [...(q.conversation || []), { role: 'assistant', content, revision: q.input_revision, client_message_id: eventId, message_at: at(), author: 'Window Quotes', kind: 'clarification', worker_status: 'needs_details' }] };
      const changed = await args.db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version || 0, input_revision: q.input_revision, worker_status: q.worker_status }, { $set: patch });
      if (changed.updated !== 1) fail(409, 'The request changed; reload before quoting');
      return { ...q, ...patch };
    }
    if (intake?.assistant_message) {
      const content = sanitizePublic(text(intake.assistant_message, 'intake explanation', 18000));
      const eventId = 'ai-intake:' + q.input_revision + ':' + await digest(content);
      if (!(q.conversation || []).some(item => item.client_message_id === eventId)) {
        const patch = { state_version: (q.state_version || 0) + 1, conversation: [...(q.conversation || []), { role: 'assistant', content, revision: q.input_revision, client_message_id: eventId, message_at: at(), author: 'Window Quotes', kind: 'intake_summary' }] };
        const changed = await args.db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version || 0, input_revision: q.input_revision, worker_status: q.worker_status }, { $set: patch });
        if (changed.updated !== 1) fail(409, 'The request changed during intake; reload before quoting');
        q = { ...q, ...patch };
      }
    }
    const normalized = await normalizeRequest(clone(q));
    if (fallbackExecution?.configured && needsOnlineQuote(normalized, q.intake_assessment)) return fallbackExecution.afterInput({ ...args, q });
    const execution = await child(q, normalized?.ok === true ? await digest(normalized.plan) : ZERO_HASH);
    return execution.afterInput({ ...args, q });
  }
  async function claim(args) {
    requireEnabled(); workerScope(args.worker); const q = await get(args.db, args.body.quote_id); scope(q);
    const execution = await prepared(q);
    if (q.worker_status === 'queued') {
      await fresh(q); const normalized = await normalizeRequest(clone(q));
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
    let nativeEngine;
    if (body.native_engine !== undefined) {
      nativeEngine = body.native_engine;
      if (!nativeEngine || typeof nativeEngine !== 'object' || Array.isArray(nativeEngine) ||
        Object.keys(nativeEngine).some(key => !['state', 'version', 'contract_hash', 'catalog_id', 'context_fingerprint'].includes(key)) ||
        !['ready', 'needs_sign_in', 'unavailable'].includes(nativeEngine.state) ||
        nativeEngine.state === 'ready' && !nativeEnginePresenceReady(nativeEngine, config.native_engine)) fail(400, 'Provide a truthful native engine state matching the enabled contract');
    }
    return { runner_id, runner_status, browser: clone(browser), browser_reported_at: at(), ...(nativeEngine ? { native_engine: clone(nativeEngine) } : {}), ...(attention ? { attention } : {}), last_seen_at: at() };
  }
  async function poll({ db, worker, body }) {
    requireEnabled(); workerScope(worker); const reported = presence(body);
    const changed = await db.QuoteWorkers.updateMany({ id: config.worker_id, enabled: true, token_hash: config.worker_key_hash }, { $set: { runner_presence: reported, last_seen_at: at() } });
    if (changed.updated !== 1) fail(401, 'Runner authentication changed');
    const response = (status, reason, quote = null) => ({ ok: true, status, ...(reason ? { reason } : {}), quote, retry_after_ms: 15000 });
    if (reported.runner_status !== 'idle') return response('blocked', reported.runner_status);
    const currentSlot = await slot(db);
    if (currentSlot.busy_token) return response('blocked', 'browser_operation_requires_completion_or_review');
    if (reported.browser.state !== 'authenticated' && !nativeEnginePresenceReady(reported.native_engine, config.native_engine)) return response('needs_sign_in', reported.browser.state);
    const candidates = await db.QuoteRequests.filter({ worker_status: 'queued', execution_provider: 'deterministic', requester_email: allow.requester_email, 'agent_run.queue_scope_hash': await scopeHash(), created_date: { $gte: allow.created_after } }, 'queued_at', 20);
    for (const q of candidates) {
      try {
        await fresh(q); await prepared(q); const normalized = await normalizeRequest(clone(q));
        if (normalized?.ok !== true || await digest(normalized.plan) !== q.agent_run.plan_hash) return response('blocked', 'prepared_input_requires_review');
        return response('queued', undefined, { quote_id: q.id, input_revision: q.input_revision, plan_hash: q.agent_run.plan_hash, plan: clone(q.agent_run.plan) });
      } catch (error) { if (!(error instanceof HttpError)) throw error; return response('blocked', 'prepared_request_requires_review'); }
    }
    const preview = await previews.poll({ db, worker, nativeReady: nativeEnginePresenceReady(reported.native_engine, config.native_engine) });
    if (preview) return response('queued', undefined, preview);
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
      status.native_engine_state = browserAge >= 0 && browserAge < 100000 ? reported.native_engine?.state || 'unavailable' : 'unknown';
      status.native_engine_ready = browserAge >= 0 && browserAge < 100000 && nativeEnginePresenceReady(reported.native_engine, config.native_engine);
      if (browserAge >= 0 && browserAge < 100000) { status.browser_state = reported.browser.state; status.browser_authenticated = reported.browser.state === 'authenticated'; }
      if (reported.runner_status === 'stopping') status.online = false;
    }
    return status;
  }
  return { configured: enabled, provider: 'deterministic', preview_claim: previewAction('claim'), preview_report: previewAction('report'), authenticate: auth.authenticate, afterInput, claim, poll, getStatus, heartbeat: forward('heartbeat'), checkpoint: forward('checkpoint'), report: forward('report') };
}


