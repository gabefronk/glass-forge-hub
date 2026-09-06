// Private checkpoint-driven continuation state. New operations opt in explicitly;
// the service/runtime keep automatic continuation disabled by default.
// The sender must use the already verified message POST, with the distinct
// marker below; passing this content through ordinary sendMessage is incorrect.
import { HttpError } from './windowQuotesCore.js';

const fail = (status, message) => { throw new HttpError(status, message); };
const copy = value => JSON.parse(JSON.stringify(value));
const text = (value, name, max = 160) => {
  if (typeof value !== 'string' || !value || value.length > max || /[\r\n]/.test(value)) fail(400, 'Invalid ' + name);
  return value;
};
const records = q => q.agent_run?.continuations || [];
const sourceSegment = body => body.continuation_id || '';
const latest = q => records(q).at(-1);
const receipt = state => ({ state, must_yield: true });

export function buildContinuationDispatchContent(correlation, continuationId, content) {
  text(correlation?.quote_id, 'quote_id');text(correlation?.operation_id, 'operation_id', 300);
  if (!Number.isInteger(correlation.input_revision) || correlation.input_revision < 1) fail(400, 'Invalid revision');
  text(continuationId, 'continuation_id');text(content, 'content', 7800);
  if (content.includes('[WindowQuote ')) fail(400, 'Nested dispatch marker');
  const marker = '[WindowQuote continuation=' + encodeURIComponent(continuationId) + ' operation=' + encodeURIComponent(correlation.operation_id) + ' quote=' + encodeURIComponent(correlation.quote_id) + ' revision=' + correlation.input_revision + ']';
  const output = marker + '\n' + content;
  if (output.length > 8000) fail(400, 'Continuation exceeds message limit');
  return output;
}

export function createCheckpointContinuations({ sendContinuation, conversationId, maxContinuations = 1, now = () => new Date(), uuid = () => crypto.randomUUID() } = {}) {
  if (typeof sendContinuation !== 'function' || !/^[a-zA-Z0-9_-]{1,160}$/.test(conversationId || '')) fail(503, 'Continuation sender and exact conversation must be configured');
  if (!Number.isInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 20) fail(503, 'Continuation limit must be between 1 and 20');
  const at = () => now().toISOString();
  const scoped = (q, body) => {
    const r = q?.agent_run;
    if (q?.execution_provider !== 'superagent' || !r || r.operation_id !== body.operation_id || r.execution_token !== body.execution_token || !body.execution_token || q.input_revision !== body.input_revision || r.input_revision !== body.input_revision || q.id !== body.quote_id) fail(403, 'Continuation is not authorized for this operation');
    if (q.worker_status !== 'running' || q.sales_status === 'won' || r.phase === 'completed') fail(409, 'The operation has ended');
    if (r.conversation_id !== conversationId) fail(409, 'The recorded conversation does not match');
  };
  const get = async (db, id) => {
    const found = await db.QuoteRequests.filter({ id }, undefined, 1);
    if (found.length !== 1) fail(404, 'Quote not found');
    return found[0];
  };
  const cas = async (db, q, run) => {
    const result = await db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version || 0 }, { $set: { agent_run: run, state_version: (q.state_version || 0) + 1 } });
    if (result.updated !== 1) fail(409, 'Quote changed during continuation');
    return { ...q, agent_run: run, state_version: (q.state_version || 0) + 1 };
  };
  const ownsSlot = async (db, q) => {
    const matches = await db.QuoteWorkers.filter({ id: q.agent_run.slot_id, busy_token: q.agent_run.operation_id, active_quote_id: q.id }, undefined, 1);
    if (matches.length !== 1) fail(409, 'This operation no longer owns the browser');
  };
  const replaceRecord = (q, id, patch) => ({ ...q.agent_run, continuations: records(q).map(item => item.id === id ? { ...item, ...patch } : item) });

  function segmentPermission(q, body) {
    scoped(q, body);
    // Historical retries may read their existing receipt only; the service's
    // event-dedupe branch must run before any further mutations in this case.
    const replay = records(q).find(item => item.checkpoint_event_id === body.event_id && item.from_segment_id === sourceSegment(body));
    if (body.action === 'checkpoint' && replay && (q.agent_run.event_ids || []).includes(body.event_id)) return 'receipt_only';
    const pending = latest(q);
    if (pending && pending.state !== 'acknowledged') {
      if (body.action === 'read' && body.continuation_id === pending.id && ['sending', 'sent', 'uncertain'].includes(pending.state)) return 'acknowledge';
      fail(409, 'The previous segment must stop; only the reserved continuation may proceed');
    }
    if (sourceSegment(body) !== (q.agent_run.active_continuation_id || '')) fail(409, 'This callback belongs to an older segment');
    return 'active';
  }

  // Call inside checked(), after the existing capability validation. The new
  // prompt alone carries continuation_id; old checkpoint receipts never do.
  async function enter({ db, q, body }) {
    const permission = segmentPermission(q, body);
    if (permission !== 'acknowledge') return { quote: q, permission };
    await ownsSlot(db, q);
    const item = latest(q);
    if (q.checkpoint?.native_quote_id !== item.native_quote_id) fail(409, 'The continuation native identity changed');
    const run = replaceRecord(q, item.id, { state: 'acknowledged', acknowledged_at: at() });
    run.active_continuation_id = item.id;
    return { quote: await cas(db, q, run), permission: 'active' };
  }

  // Apply to the existing fully validated checkpoint patch BEFORE its one CAS.
  // This atomically records both the accepted event and its continuation intent.
  function augmentCheckpointPatch(q, patch, body) {
    if (body.request_continuation !== true) return patch;
    if (segmentPermission(q, body) !== 'active') fail(409, 'Cannot attach new intent to a replay');
    if (body.action !== 'checkpoint' || patch.worker_status !== 'running' || !body.checkpoint || !(patch.agent_run?.event_ids || []).includes(body.event_id) || (q.agent_run.event_ids || []).includes(body.event_id)) fail(400, 'Continuation requires a new accepted checkpoint event');
    const details = body.continuation;
    if (details?.reason !== 'batch_complete' || details.no_pending_user_action !== true || !Number.isInteger(details.browser_changes) || details.browser_changes < 1 || details.browser_changes > 9) fail(400, 'Continuation requires a completed batch of 1 to 9 changes without a pending user action');
    const checkpoint = patch.checkpoint || q.checkpoint;
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(checkpoint?.native_quote_id || '')) fail(400, 'A recorded native quote is required');
    if (q.checkpoint?.native_quote_id && checkpoint.native_quote_id !== q.checkpoint.native_quote_id) fail(409, 'Preserve the recorded native quote');
    const blocked = saved => saved?.pending_user_action || saved?.requires_approval || saved?.requires_mfa || saved?.requires_sign_in;
    if ((q.missing_details || []).length || (patch.missing_details || []).length || blocked(q.checkpoint) || blocked(checkpoint)) fail(409, 'Resolve the required user action first');
    const previous = records(q);
    if (previous.length >= maxContinuations) {
      // Preserve the checkpoint even when its requested continuation exceeds the
      // budget. No network call or lock release follows this refusal.
      return { ...patch, agent_run: { ...patch.agent_run, continuation_refusal: { checkpoint_event_id: body.event_id, state: 'limit_reached', recorded_at: at() } } };
    }
    const item = { id: text(uuid(), 'continuation_id'), checkpoint_event_id: text(body.event_id, 'event_id', 150), from_segment_id: sourceSegment(body), operation_id: q.agent_run.operation_id, input_revision: q.input_revision, conversation_id: conversationId, native_quote_id: checkpoint.native_quote_id, state: 'reserved', reserved_at: at() };
    return { ...patch, agent_run: { ...patch.agent_run, continuations: [...copy(previous), item] } };
  }

  function prompt(q, item) {
    const common = { action: 'read', quote_id: q.id, input_revision: q.input_revision, operation_id: q.agent_run.operation_id, execution_token: q.agent_run.execution_token, continuation_id: item.id };
    return 'Continue the SAME authorized window quote from its accepted SAVED checkpoint. This is a new segment of the same operation, not a new quote or new job. First call windowQuoteAgentTools with ' + JSON.stringify(common) + '. If that native cross-app tool is unavailable, POST this JSON to https://base44.app/api/apps/6a7f0d7a4a5f825c724273e9/functions/windowQuoteAgentTools with Content-Type: application/json. If the read fails or status is not running, stop without browser actions. Include continuation_id in EVERY later checkpoint/report/read. Only the current read response applies, not earlier chat. Preserve the recorded native quote and saved lines. Inspect the current browser state before navigating. If its active configurator belongs to this checkpointed quote, inspect and resume it in place; never blindly navigate away, discard an unsaved form or recreate a saved line. If ownership or unsaved state cannot be reconciled safely, report failed with the preserved checkpoint. This continuation mechanism does not guarantee recovery from a platform pause before a saved checkpoint. Never bypass approval, MFA, sign-in, or missing product details; report the corresponding blocker. After at most 9 browser changes, save/checkpoint. When requesting another continuation, stop all native actions immediately after the accepted checkpoint response and finish this turn. Do not schedule your own follow-up. Report ready only after the existing verification accepts it.';
  }

  async function settle(db, body, itemId, state) {
    const q = await get(db, body.quote_id);
    try { scoped(q, body); } catch { return; }
    const item = records(q).find(value => value.id === itemId);
    // The follow-up can acknowledge or finish before its POST returns. Never
    // overwrite that later progress with a late success/timeout callback.
    if (item?.state !== 'sending') return;
    await cas(db, q, replaceRecord(q, itemId, { state, settled_at: at() }));
  }

  async function dispatch({ db, body }) {
    let q = await get(db, body.quote_id);
    scoped(q, body);
    const item = records(q).find(value => value.checkpoint_event_id === body.event_id);
    if (!item) return receipt(q.agent_run.continuation_refusal?.checkpoint_event_id === body.event_id ? 'limit_reached' : 'not_reserved');
    if (body.action !== 'checkpoint' || sourceSegment(body) !== item.from_segment_id || !(q.agent_run.event_ids || []).includes(body.event_id)) fail(409, 'Continuation receipt does not match the accepted checkpoint');
    if (item.state !== 'reserved') return receipt(item.state); // No retry from sending/uncertain.
    await ownsSlot(db, q);
    if (q.checkpoint?.native_quote_id !== item.native_quote_id) fail(409, 'Native quote identity changed');
    q = await cas(db, q, replaceRecord(q, item.id, { state: 'sending', send_started_at: at() }));
    // The CAS is the durable one-way boundary: only its successful caller sends.
    const beforeSend = await get(db, q.id);
    scoped(beforeSend, body);await ownsSlot(db, beforeSend);
    if (records(beforeSend).find(value => value.id === item.id)?.state !== 'sending') return receipt('already_advanced');
    const correlation = { quote_id: q.id, input_revision: q.input_revision, operation_id: q.agent_run.operation_id };
    try {
      await sendContinuation({ conversationId, correlation, continuationId: item.id, content: prompt(q, item) });
    } catch {
      await settle(db, body, item.id, 'uncertain');
      return receipt('uncertain');
    }
    await settle(db, body, item.id, 'sent');
    return receipt('sent');
  }

  const policy = q => ({ max_browser_changes: 9, remaining_continuations: Math.max(0, maxContinuations - records(q).length), active_continuation_id: q.agent_run.active_continuation_id || '', rule: 'A continuation is never permission to bypass approval, MFA, sign-in or clarification. An accepted request means stop native actions and end this segment immediately. At the cap, save the checkpoint and report a recoverable failure; do not auto-resend.' });
  return { enter, segmentPermission, augmentCheckpointPatch, dispatch, policy };
}
