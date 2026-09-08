import { HttpError, sha256, validateLines, validateSettings } from './windowQuotesCore.js';
import { buildQuotePlan, getProductProfileForLine, PROFILE_CONTRACT_HASH } from './amscoQuotePlan.js';
import { normalizeConversationalSchedule } from './structuredQuoteIntake.js';
import { STANDARD_STUDIO_PROFILE } from './easyRequest.js';
import { productFamily, resolveRequestedSeries } from './mixedProductProfiles.js';
import { CONVERSATIONAL_INTAKE_SCHEMA } from './conversationalIntake.js';

export const BUILDER_VERSION = 1;
export const BUILDER_LIMITS = Object.freeze({ body: 300000, lines: 200, messages: 40, message: 18000, conversation: 70000 });
const clone = value => structuredClone(value);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null && value !== '';
const stable = value => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fail = message => { throw new HttpError(400, message); };
const keys = (value, allowed, path) => {
  if (!object(value)) fail(path + ' must be an object');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(path + ' contains unsupported fields');
};
const string = (value, path, max = 500) => {
  if (typeof value !== 'string' || value.length > max) fail('Invalid ' + path);
  return value.trim();
};
const optionTypes = Object.fromEntries(Object.entries(CONVERSATIONAL_INTAKE_SCHEMA.properties.lines.items.properties.options.properties).map(([key, value]) => [key, value.type]));
const lineKeys = ['id', 'mark', 'room', 'style', 'qty', 'width', 'height', 'units', 'dimension_basis', 'options'];
const easyKeys = ['confirmed', 'profile_id', 'profile_revision', 'units', 'dimension_basis'];
function options(value = {}, path = 'options') {
  keys(value, Object.keys(optionTypes), path);
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    // An omitted/blank form field is unanswered, never an explicit false.
    if (item === null || item === '') continue;
    if (typeof item !== optionTypes[key] || typeof item === 'number' && !Number.isFinite(item)) fail('Invalid ' + path + '.' + key);
    clean[key] = typeof item === 'string' ? string(item, path + '.' + key) : item;
  }
  return clean;
}
function source(value = {}, { submission = false } = {}) {
  keys(value, submission ? ['easy_request', 'visual_builder'] : ['easy_request'], 'draft.source');
  const clean = {};
  if (value.easy_request !== undefined) {
    const easy = value.easy_request;
    keys(easy, easyKeys, 'draft.source.easy_request');
    if (easy.confirmed !== undefined && typeof easy.confirmed !== 'boolean') fail('Invalid standard preference confirmation');
    if (easy.profile_id !== undefined && easy.profile_id !== STANDARD_STUDIO_PROFILE.id) fail('Unknown standard preferences');
    if (easy.profile_revision !== undefined && easy.profile_revision !== STANDARD_STUDIO_PROFILE.revision) fail('Review the current standard preferences');
    if (present(easy.units) && easy.units !== 'in') fail('Window dimensions must be in inches');
    if (present(easy.dimension_basis) && !['call', 'frame', 'rough_opening'].includes(easy.dimension_basis)) fail('Invalid dimension basis');
    clean.easy_request = Object.fromEntries(Object.entries(easy).filter(([, item]) => present(item)));
  }
  return clean;
}

// Strict input boundary for a NEW unsaved schedule. Existing quote IDs, history,
// assessments, model source references and execution/pricing fields are rejected.
export function validateBuilderDraft(raw, { submission = false } = {}) {
  keys(raw, ['title', 'settings', 'lines', 'source'], 'draft');
  const rawSettings = raw.settings ?? {};
  keys(rawSettings, ['dealer', 'yard', 'gross_margin', 'low_e', ...Object.keys(optionTypes)], 'draft.settings');
  const finance = {};
  for (const key of ['dealer', 'yard', 'gross_margin']) if (Object.hasOwn(rawSettings, key)) finance[key] = rawSettings[key];
  const settings = { ...validateSettings(finance), ...options(Object.fromEntries(Object.entries(rawSettings).filter(([key]) => Object.hasOwn(optionTypes, key))), 'draft.settings') };
  if (Object.hasOwn(rawSettings, 'low_e')) {
    if (typeof rawSettings.low_e !== 'boolean') fail('Invalid LowE selection');
    settings.low_e = rawSettings.low_e;
  }
  if (!Array.isArray(raw.lines) || raw.lines.length > BUILDER_LIMITS.lines) fail('Use at most ' + BUILDER_LIMITS.lines + ' window lines');
  const seen = new Set();
  const lines = raw.lines.map((line, index) => {
    keys(line, lineKeys, 'draft.lines[' + index + ']');
    const clean = {};
    for (const key of lineKeys.filter(key => key !== 'options')) if (present(line[key])) clean[key] = line[key];
    clean.id = clean.id === undefined ? 'builder-line-' + (index + 1) : string(clean.id, 'window ID', 160);
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(clean.id) || seen.has(clean.id)) fail('Use unique window IDs');
    seen.add(clean.id);
    clean.options = options(line.options, 'draft.lines[' + index + '].options');
    return clean;
  });
  const draft = { settings, lines: validateLines(lines), source: source(raw.source, { submission }) };
  if (raw.title !== undefined) draft.title = string(raw.title, 'draft.title', 200);
  return draft;
}

function conversation(value = []) {
  if (!Array.isArray(value) || value.length > BUILDER_LIMITS.messages) fail('Use at most ' + BUILDER_LIMITS.messages + ' conversation messages');
  let size = 0, revision = 0;
  const messages = value.map(item => {
    keys(item, ['role', 'content'], 'conversation message');
    if (!['user', 'assistant'].includes(item.role)) fail('Invalid conversation role');
    const content = string(item.content, 'conversation message', BUILDER_LIMITS.message);
    if (!content) fail('Conversation messages cannot be empty');
    size += content.length;
    if (item.role === 'user') revision++;
    else if (!revision) fail('Start the conversation with your window request');
    return { role: item.role, content, revision };
  });
  if (size > BUILDER_LIMITS.conversation) fail('The builder conversation is too long');
  if (messages.length && messages.at(-1).role !== 'user') fail('Send a user message to continue the AI guide');
  return { messages, revision: Math.max(1, revision) };
}
function carriedRequirements(value = []) {
  if (!Array.isArray(value) || value.length > 40) fail('Use at most 40 unresolved requirements');
  return unique(value.map(item => {
    const detail = string(item, 'unresolved requirement', 1000);
    if (!detail) fail('An unresolved requirement cannot be empty');
    return detail;
  }));
}
const isStandard = draft => draft.source?.easy_request?.confirmed === true && draft.source.easy_request.profile_id === STANDARD_STUDIO_PROFILE.id && draft.source.easy_request.profile_revision === STANDARD_STUDIO_PROFILE.revision;
const unique = value => [...new Set((value || []).filter(item => typeof item === 'string' && item.trim()))];
function fillManualPreferences(draft) {
  const quote = clone(draft), assumptions = [];
  // The native SH contract names installation through series. Translate only
  // an exact fin alias; conflicts and unknown fins remain present for review.
  for (const line of quote.lines) if (productFamily(line.style) === 'single_hung') {
    const selection = line.options.fin !== undefined || line.options.series !== undefined ? line.options : quote.settings;
    const series = resolveRequestedSeries(line, quote.settings);
    if (present(selection.fin) && series) {
      line.options.series = series;
      delete line.options.fin;
    }
  }
  if (!isStandard(quote)) return { quote, assumptions };
  if (!present(quote.settings.glass) && !Object.hasOwn(quote.settings, 'low_e')) {
    quote.settings.glass = 'CozE (LowE)';
    assumptions.push('Used CozE LowE as your standard glass coating.');
  }
  for (const [index, line] of quote.lines.entries()) {
    if (!['xo_slider', 'picture_direct_set'].includes(productFamily(line.style))) continue;
    const label = line.mark || 'Window ' + (index + 1);
    if (![line.options.fin, line.options.series, quote.settings.fin, quote.settings.series].some(present)) {
      line.options.fin = 'nail fin';
      assumptions.push(label + ': used standard nail fin.');
    }
    if (![line.options.tempered, quote.settings.tempered].some(present)) {
      line.options.tempered = false;
      assumptions.push(label + ': used standard non-tempered glass.');
    }
    if (![line.options.patterned_glass, quote.settings.patterned_glass].some(present)) {
      line.options.patterned_glass = 'None';
      assumptions.push(label + ': used regular glass with no privacy texture.');
    }
  }
  return { quote, assumptions };
}

// The hash detects stale review; it grants no authority. Authentication, fresh
// record checks, the product planner and native verification remain independent.
export async function builderScheduleHash(draft) {
  return sha256(stable({ version: BUILDER_VERSION, profile_contract_hash: PROFILE_CONTRACT_HASH, settings: draft.settings, lines: draft.lines, source: draft.source }));
}
export function normalizeManualBuilderDraft(raw) {
  const draft = validateBuilderDraft(raw);
  const { quote: prepared, assumptions } = fillManualPreferences(draft);
  const q = { ...prepared, id: 'builder-preview', input_revision: 1, history: [], conversation: [] };
  const result = normalizeConversationalSchedule(q, { getProductProfileForLine });
  // The selectable SH recipe must never choose the window's main product type.
  result.quote.lines.forEach((line, index) => { if (!present(draft.lines[index].style)) delete line.style; });
  const checked = buildQuotePlan(result.quote);
  const issues = [...(result.issues || []), ...(checked.issues || [])];
  const questions = unique(issues.map(item => item.message));
  const review = unique(issues.filter(item => /unsupported|unverified_product|review|ambiguous_color|native_product_constraint/.test(item.code || '')).map(item => item.message));
  return { ...result, ok: result.ok === true && checked.ok === true && !questions.length, issues,
    quote: result.quote, questions, intake_assessment: { status: questions.length ? review.length ? 'product_review' : 'needs_details' : 'ready',
      questions, product_review: review, unresolved_requirements: [], assumptions } };
}
// Short, explicit builder corrections should not depend on a second model call.
// This handles a main installation choice only when the customer's latest words
// name the exact value and clearly apply it to the whole proposed package.
export function resolveRoutineBuilderFollowup(draft, context, unresolved = []) {
  if (unresolved.length || context.messages.length < 3) return null;
  const latest = context.messages.at(-1), prior = context.messages.at(-2);
  if (latest?.role !== 'user' || prior?.role !== 'assistant' || !/\b(?:fin|installation style|installation series)\b/i.test(prior.content)) return null;
  const explicitNailFin = /\b(?:nail(?:ing)?|standard|regular)\s+fin\b/i.test(latest.content);
  const wholePackage = draft.lines.length === 1 || /\b(?:both|all|every|each)\b/i.test(latest.content);
  if (!explicitNailFin || !wholePackage) return null;
  const changed = clone(draft);
  for (const line of changed.lines) {
    line.options ||= {};
    line.options.fin = 'nail fin';
    // An explicit package-wide correction replaces a prior conflicting series.
    delete line.options.series;
  }
  const result = normalizeManualBuilderDraft(changed);
  result.assistant_message = result.ok === true
    ? 'I applied standard nail fin to the proposed windows. Review the schedule below before requesting pricing.'
    : 'I applied standard nail fin to the proposed windows. The remaining highlighted choices still need review.';
  return result;
}

function outputDraft(quote) {
  // Only the reviewed specifications cross this boundary. AI provenance and
  // execution/status data never become fields a caller can send back as facts.
  return validateBuilderDraft({ ...(quote.title !== undefined ? { title: quote.title } : {}), settings: quote.settings || {},
    lines: (quote.lines || []).map(line => Object.fromEntries(Object.entries(line).filter(([key]) => lineKeys.includes(key)))), source: source(quote.source || {}) });
}
export async function builderReviewResponse(result) {
  const draft = outputDraft(result.quote);
  const assessment = result.intake_assessment || {};
  const questions = unique([...(assessment.questions || []), ...(result.questions || [])]);
  const productReview = unique(assessment.product_review);
  const unresolved = unique(assessment.unresolved_requirements);
  // Check the returned schedule again; a model's status is never sufficient.
  const checked = buildQuotePlan({ ...draft, id: 'builder-preview', input_revision: 1 });
  if (!checked.ok && !questions.length && !productReview.length) questions.push(...unique((checked.issues || []).map(item => item.message)));
  const ready = result.ok === true && checked.ok === true && !questions.length && !productReview.length && !unresolved.length;
  const response = { draft, review: { ready, questions, product_review: productReview, unresolved_requirements: unresolved,
    assumptions: unique(assessment.assumptions), schedule_hash: ready ? await builderScheduleHash(draft) : null } };
  if (typeof result.assistant_message === 'string') response.assistant_message = result.assistant_message.slice(0, 17500).replace('Your details are ready for automatic quoting.', 'Review these windows, then choose Calculate verified price when you are ready.');
  return response;
}

export function createWindowQuoteBuilderHandler({ getClient, normalizeAI }) {
  return async req => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
      const raw = await req.text();
      if (raw.length > BUILDER_LIMITS.body) throw new HttpError(413, 'Request is too large');
      let body;
      try { body = JSON.parse(raw); } catch { fail('Invalid JSON'); }
      keys(body, ['action', 'draft', 'conversation', 'unresolved_requirements'], 'request');
      if (!['assist', 'review'].includes(body.action)) fail('Unknown builder action');
      const client = await getClient(req);
      let user;
      try { user = await client.auth.me(); } catch { throw new HttpError(401, 'Sign in required'); }
      if (!user) throw new HttpError(401, 'Sign in required');
      if (user.role !== 'admin') throw new HttpError(403, 'Window Quotes is currently available to administrators');
      const draft = validateBuilderDraft(body.draft);
      const context = conversation(body.conversation);
      // This optional stateless ledger can only ADD blockers. It is never an
      // assessment/status object, prior approval, capability or skip flag.
      const unresolved = carriedRequirements(body.unresolved_requirements);
      let result;
      if (body.action === 'review') {
        if (context.messages.length || unresolved.length) fail('Apply a fully resolved AI suggestion before reviewing a structured schedule');
        result = normalizeManualBuilderDraft(draft);
      } else {
        if (!context.messages.some(item => item.role === 'user')) fail('Describe the windows you need or ask the AI guide a question');
        if (typeof normalizeAI !== 'function') throw new Error('AI intake is not configured');
        result = resolveRoutineBuilderFollowup(draft, context, unresolved) || await normalizeAI({ ...draft, id: 'builder-preview', input_revision: context.revision, history: [], conversation: context.messages,
          ...(unresolved.length ? { intake_assessment: { unresolved_requirements: unresolved } } : {}) }, { client, action: 'builder_assist' });
      }
      return new Response(JSON.stringify(await builderReviewResponse(result)), { status: 200, headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof HttpError ? error.message : 'The window builder could not review this draft. Try again; no pricing request was created.' }), { status: error instanceof HttpError ? error.status : 500, headers });
    }
  };
}

function freshBuilder(q) {
  return q.input_revision === 1 && q.worker_status === 'draft' && !(q.history || []).length && !(q.conversation || []).length &&
    !present(q.message) && !present(q.request_text) && !q.intake_assessment && !q.agent_run && !q.reviewed_restart &&
    !q.result && !q.job_id && !q.accepted_revision && q.sales_status !== 'won' && !Object.keys(q.checkpoint || {}).length;
}
function recoverableStructuredSchedule(q) {
  const noUserText = !present(q.message) && !present(q.request_text) && !(q.conversation || []).some(item => item?.role === 'user');
  const noUnresolved = !(q.intake_assessment?.unresolved_requirements || []).length;
  const freshDraft = q.input_revision === 1 && q.worker_status === 'draft' && !(q.history || []).length && !(q.conversation || []).length && !q.intake_assessment;
  const unavailableRetry = q.worker_status === 'needs_details' && q.intake_assessment?.status === 'unavailable';
  return !q.source?.visual_builder && q.source?.easy_request?.confirmed === true && Array.isArray(q.lines) && q.lines.length > 0 &&
    noUserText && noUnresolved && (freshDraft || unavailableRetry) && !q.agent_run && !q.reviewed_restart && !q.result && !q.job_id &&
    !q.accepted_revision && q.sales_status !== 'won' && !Object.keys(q.checkpoint || {}).length;
}
function normalizeSavedStructuredSchedule(q) {
  const raw = { settings: q.settings || {}, lines: (q.lines || []).map(line => Object.fromEntries(Object.entries(line).filter(([key]) => lineKeys.includes(key)))),
    source: { easy_request: clone(q.source.easy_request) } };
  const result = normalizeManualBuilderDraft(raw);
  return { ...result, quote: { ...clone(q), settings: result.quote.settings, lines: result.quote.lines },
    intake_assessment: { ...result.intake_assessment, version: BUILDER_VERSION, input_revision: q.input_revision },
    assistant_message: result.ok === true ? 'Your saved windows are ready for AMSCO pricing.' : 'Your saved schedule needs the listed product choices reviewed before pricing.' };
}
export function createBuilderAwareIntake(normalizeAI) {
  return async (q, context) => {
    // A complete structured schedule does not depend on an AI call. This also
    // recovers an earlier provider timeout while preserving every saved choice.
    if (recoverableStructuredSchedule(q)) return normalizeSavedStructuredSchedule(q);
    // An existing chat/edit/retry can never opt out of its retained requirements.
    if (!q.source?.visual_builder || !freshBuilder(q)) return normalizeAI(q, context);
    try {
      const marker = q.source.visual_builder;
      keys(marker, ['version', 'confirmed', 'schedule_hash'], 'visual builder review');
      if (marker.version !== BUILDER_VERSION || marker.confirmed !== true || !/^[a-f0-9]{64}$/.test(marker.schedule_hash || '')) fail('Review and confirm the windows before requesting an AMSCO price');
      const draft = validateBuilderDraft({ settings: q.settings, lines: q.lines, source: q.source }, { submission: true });
      if (await builderScheduleHash(draft) !== marker.schedule_hash) fail('The windows changed after review. Review them again before requesting an AMSCO price');
      const result = normalizeManualBuilderDraft(draft);
      const reviewed = await builderReviewResponse(result);
      if (!reviewed.review.ready || reviewed.review.schedule_hash !== marker.schedule_hash) fail('These windows need a new review before requesting an AMSCO price');
      return { ...result, quote: { ...clone(q), settings: reviewed.draft.settings, lines: reviewed.draft.lines },
        intake_assessment: { ...result.intake_assessment, version: BUILDER_VERSION, input_revision: q.input_revision },
        assistant_message: 'Your reviewed windows are ready for AMSCO pricing.' };
    } catch (error) {
      const question = error instanceof HttpError ? error.message : 'Review the windows again before requesting an AMSCO price';
      return { ok: false, status: 'needs_details', routing: 'clarification', quote: clone(q), issues: [{ code: 'builder_review_required', path: 'source.visual_builder', message: question }],
        questions: [question], intake_assessment: { version: BUILDER_VERSION, input_revision: q.input_revision, status: 'needs_details', questions: [question], product_review: [], unresolved_requirements: [], assumptions: [] } };
    }
  };
}
