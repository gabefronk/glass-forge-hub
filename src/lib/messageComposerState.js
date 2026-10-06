// Pure helpers for the Messages composer. No React, no fetch — fully testable with node:test.
// The component owns the async orchestration (see messageComposerOrchestration.js); this module
// owns the deterministic parts: LOCAL file staging (25 MB cap, NO upload on drop), batch freezing,
// ordered step planning with a stable client_id per step, and retry/lock classification.

export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const TEXT_MAX = 4000;

export function newClientId() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Stage a raw File LOCALLY (no upload). Image files get an objectURL preview for chips.
// Returns { ok, item } on success or { error } on rejection. The item's id is the step client_id.
export function stageFile(file, idGen = newClientId) {
  if (!file) return { error: 'No file selected.' };
  const name = String(file.name || 'attachment').slice(0, 200);
  const size = Number(file.size) || 0;
  if (!size) return { error: `${name} is empty.` };
  if (size > MAX_FILE_SIZE) return { error: `${name} is over 25 MB.` };
  const mime = typeof file.type === 'string' && file.type ? file.type : 'application/octet-stream';
  const isImage = /^image\//.test(mime);
  return { ok: true, item: { id: idGen(), file, name, size, mime, isImage, previewUrl: makePreview(file, isImage), status: 'staged' } };
}

// Only real Blobs/Files get an objectURL; anything else (or an unavailable API) -> null.
function makePreview(file, isImage) {
  if (!isImage || typeof Blob === 'undefined' || !(file instanceof Blob)) return null;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try { return URL.createObjectURL(file); } catch { return null; }
}

export function isImageMime(mime) {
  return typeof mime === 'string' && /^image\//.test(mime);
}

export function canSend({ text, files, sending, locked }) {
  if (sending || locked) return false;
  const hasText = typeof text === 'string' && text.trim().length > 0;
  const hasReady = (files || []).some((f) => f.status === 'staged');
  return hasText || hasReady;
}

// Freeze a batch: snapshot text + staged files (with raw File) so later edits to the textarea or
// staging area cannot change what is in flight, and switching conversations cannot move it.
// The staged file's id IS its step client_id (stable across retries — never a fresh id).
export function freezeBatch({ conversationKey, text, files }) {
  const staged = (files || []).filter((f) => f.status === 'staged').map((f) => ({
    id: f.id, file: f.file, name: f.name, size: f.size, mime: f.mime, isImage: f.isImage, previewUrl: f.previewUrl,
  }));
  return { conversationKey, text: typeof text === 'string' ? text : '', files: staged };
}

// Ordered steps: each ready file (stage order) as send_attachment, then text as send_text.
// Each step carries its EXACT original payload + the staged file's id as client_id (stable).
export function planSteps(batch, idGen = newClientId) {
  const steps = [];
  for (const f of batch.files) {
    steps.push({
      kind: 'send_attachment',
      client_id: f.id,
      payload: { file: f.file, name: f.name, size: f.size, mime: f.mime },
    });
  }
  if (batch.text && batch.text.trim()) {
    steps.push({
      kind: 'send_text',
      client_id: idGen(),
      payload: { text: batch.text },
    });
  }
  return steps;
}

// Persistent, frozen send plan. Created ONCE per deliberate Send; every retry runs this same
// plan (same steps, payloads and client_ids; sent steps are skipped). The text step's
// client_id is assigned here, once, so a retry never mints a fresh id or reads current text.
export function createSendPlan({ ownerId, conversationKey, text, files }, idGen = newClientId) {
  const batch = freezeBatch({ conversationKey, text, files });
  const steps = planSteps(batch, idGen).map((s) => Object.freeze({ ...s, payload: Object.freeze({ ...s.payload }), result: null, uploaded: null }));
  return Object.freeze({ ownerId, conversationKey, steps: Object.freeze(steps) });
}

// Only a definite pre-dispatch failure may be retried. Unknown/rejected/disabled are terminal.
export function isRetryable(status) { return status === 'failed_pre_dispatch'; }
export function isUncertain(status) { return status === 'unknown' || status === 'rejected' || status === 'disabled'; }

// Revoke objectURLs for a list of staged files (cleanup on unmount / clear).
export function revokePreviews(files) {
  for (const f of files || []) {
    if (f.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(f.previewUrl); } catch { /* already revoked */ }
    }
  }
}