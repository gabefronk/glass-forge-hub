// Sequential send orchestration over a PERSISTENT frozen plan. Pure: no React, no fetch.
// Dependencies are injected so the component wires the backend and tests wire mocks.
//
// Per attachment step: upload raw File -> file_uri (private) -> register -> send_attachment.
// Text step: send_text. Steps already `sent` are skipped, so a retry never re-uploads or
// re-sends them. A step's successful upload (file_uri + sha256) is retained on the step, so a
// retry after a register/send pre-dispatch failure re-uses it instead of uploading again.
//
// Classification:
//   upload / hash / register throw or bad result -> failed_pre_dispatch (nothing was dispatched;
//     retryable with the same plan) unless the server said `disabled` -> disabled (locks).
//   send_text / send_attachment throw -> unknown (may have dispatched; locks).
//   unknown / rejected / disabled -> LOCKED; the batch stops and trailing steps are not sent.
//   failed_pre_dispatch -> stops, not locked; the SAME plan may be retried.

import { createSendPlan } from './messageComposerState.js';

const LOCKING = new Set(['unknown', 'rejected', 'disabled']);

function preDispatchFailure(e, fallback) {
  if (e && e.status === 'disabled') return { status: 'disabled', error: e.error || 'Messages sending is not enabled.' };
  return { status: 'failed_pre_dispatch', error: (e && (e.error || e.message)) || fallback };
}

function normalize(result) {
  if (result && result.ok === true && !result.status) return { status: 'sent', ...result };
  if (!result || !result.status) return { status: 'unknown', error: 'Send outcome is unknown.' };
  return result;
}

async function runAttachment(plan, step, deps) {
  let uploaded = step.uploaded;
  if (!uploaded) {
    let file_uri, sha256;
    try {
      const up = await deps.uploadFile(step.payload.file);
      file_uri = up && up.file_uri;
      if (!file_uri) return { result: { status: 'failed_pre_dispatch', error: 'Upload did not return a file reference.' }, uploaded: null };
      sha256 = await deps.sha256File(step.payload.file);
    } catch (e) {
      return { result: preDispatchFailure(e, 'Upload failed.'), uploaded: null };
    }
    uploaded = Object.freeze({ file_uri, sha256, registered: false });
  }
  if (!uploaded.registered) {
    try {
      await deps.registerUpload({
        conversation_key: plan.conversationKey, client_id: step.client_id, file_uri: uploaded.file_uri,
        name: step.payload.name, mime: step.payload.mime, size: step.payload.size, sha256: uploaded.sha256,
      });
    } catch (e) {
      return { result: preDispatchFailure(e, 'Upload could not be registered.'), uploaded };
    }
    uploaded = Object.freeze({ ...uploaded, registered: true });
  }
  let result;
  try { result = await deps.sendAttachment({ conversation_key: plan.conversationKey, client_id: step.client_id }); }
  catch (e) { result = { status: 'unknown', error: (e && e.message) || 'Send outcome is unknown.' }; }
  return { result: normalize(result), uploaded };
}

async function runText(plan, step, deps) {
  let result;
  try { result = await deps.sendText({ conversation_key: plan.conversationKey, client_id: step.client_id, text: step.payload.text }); }
  catch (e) { result = { status: 'unknown', error: (e && e.message) || 'Send outcome is unknown.' }; }
  return { result: normalize(result), uploaded: null };
}

// Returns a NEW frozen plan (input is never mutated) plus the outcome.
export async function runSendPlan(plan, deps, onProgress) {
  const steps = [...plan.steps];
  let stoppedAt = null, locked = false, error = '';
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.result && step.result.status === 'sent') continue;
    const { result, uploaded } = step.kind === 'send_attachment' ? await runAttachment(plan, step, deps) : await runText(plan, step, deps);
    steps[i] = Object.freeze({ ...step, result: Object.freeze({ ...result }), uploaded: uploaded || step.uploaded || null });
    if (typeof onProgress === 'function') onProgress(i, result);
    if (result.status === 'sent') continue;
    stoppedAt = i;
    locked = LOCKING.has(result.status);
    error = result.error || '';
    break;
  }
  const next = Object.freeze({ ...plan, steps: Object.freeze(steps) });
  const allSent = steps.length > 0 && steps.every((s) => s.result && s.result.status === 'sent');
  return { plan: next, steps: next.steps, stoppedAt, locked, allSent, error };
}

// Convenience: freeze + plan + run once (used by tests and simple callers).
export async function runSendBatch(batch, deps, onProgress) {
  const files = (batch.files || []).map((f) => ({ ...f, status: 'staged' }));
  const plan = createSendPlan({ conversationKey: batch.conversationKey, text: batch.text, files });
  return runSendPlan(plan, deps, onProgress);
}