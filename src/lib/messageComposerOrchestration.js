// Sequential send orchestration. Pure: no React, no fetch. Dependencies are injected so the
// component wires it to the backend functions and tests wire it to mocks.
//
// Per file step: upload raw File -> file_uri (private) -> register upload (owner+conversation+
// client_id+file_uri+name+mime+size+sha256) -> send_attachment. Text step: send_text.
//
// The batch STOPS at the first non-sent step. An uncertain (unknown/rejected/disabled) step
// LOCKS the batch: following steps are NOT sent (text is never sent as if an attachment worked),
// and the UI must not re-send under a fresh id. failed_pre_dispatch stops but is retryable.
// Each step's exact payload + client_id are preserved in the returned steps so a retry reuses
// the same client_id (never a fresh id) and the same text/bytes.

import { planSteps } from './messageComposerState.js';

export async function runSendBatch(batch, deps, onProgress) {
  const steps = planSteps(batch);
  const results = [];
  let stoppedAt = null;
  let locked = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let result;
    try {
      if (step.kind === 'send_attachment') {
        const uploaded = await deps.uploadFile(step.payload.file);
        if (!uploaded || !uploaded.file_uri) {
          result = { status: 'failed_pre_dispatch', error: 'Upload did not return a file reference.' };
        } else {
          const sha256 = await deps.sha256File(step.payload.file);
          await deps.registerUpload({
            conversation_key: batch.conversationKey,
            client_id: step.client_id,
            file_uri: uploaded.file_uri,
            name: step.payload.name,
            mime: step.payload.mime,
            size: step.payload.size,
            sha256,
          });
          result = await deps.sendAttachment({
            conversation_key: batch.conversationKey,
            client_id: step.client_id,
          });
        }
      } else {
        result = await deps.sendText({
          conversation_key: batch.conversationKey,
          client_id: step.client_id,
          text: step.payload.text,
        });
      }
    } catch (e) {
      result = { status: 'unknown', error: (e && e.message) || 'Send outcome is unknown.' };
    }
    // Normalize a raw { ok: true } from the backend into a sent result.
    if (result && result.ok === true && !result.status) result = { status: 'sent', ...result };
    if (!result || !result.status) result = { status: 'unknown', error: 'Send outcome is unknown.' };
    results.push({ ...step, result });
    if (typeof onProgress === 'function') onProgress(i, result);
    if (result.status === 'sent') continue;
    stoppedAt = i;
    if (result.status === 'unknown' || result.status === 'rejected' || result.status === 'disabled') locked = true;
    break;
  }
  return { steps: results, stoppedAt, locked, allSent: steps.length > 0 && stoppedAt === null };
}