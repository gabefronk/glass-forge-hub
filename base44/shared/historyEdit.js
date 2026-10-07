// Pure logic for the owner-only inline text edit on job history cards
// (crew field-report message + job-note body). No SDK, no fetch — get/update
// are injected. The entry (base44/functions/editJobHistoryText/entry.ts) wires
// the real service-role SDK; tests inject mocks.
//
// Security model:
//  - Owner gate: only HISTORY_EDIT_OWNER_IDS (Gabriel's immutable auth ids).
//    Admin role alone is NOT enough (multiple admins). Twin of
//    src/lib/ownerAccess.js HISTORY_EDIT_OWNER_IDS (kept in sync manually).
//  - Strict whitelist: only type/record_id/job_id/expected_text/new_text are
//    read from the request; only the text field + EXISTING provenance markers
//    are written. No arbitrary entity payload is forwarded to the SDK update.
//  - Concurrency: the current text must byte-equal expected_text, else 409
//    (no write, no auto-retry). original_text is a provenance marker (set once
//    on the first edit, never overwritten), NOT the concurrency token.
//  - Markers stamp the EXISTING fields sourceNoteFollowthrough already checks
//    (edited_at/edited_by/original_text on reports; edited/edited_by on notes)
//    so a later ProBuild/source-note refresh cannot overwrite the correction.
//    No new marker is invented.

export const HISTORY_EDIT_OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea', // Gabriel (gabefronk@gmail.com)
  '6a8229a9801b2aef9278ff47', // Gabriel (gabriel.fronk.wd@gmail.com)
]);

export const HISTORY_EDIT_MAX_TEXT = 5000;

const TYPES = ['report', 'note'];

export function isHistoryEditOwner(user) {
  return !!user && HISTORY_EDIT_OWNER_IDS.has(user.id);
}

// applyHistoryTextEdit returns { status, body, write? }.
// write is the patch handed to update() (for test assertions); omitted when no
// write happened. get(type, id) and update(type, id, patch) are injected.
export async function applyHistoryTextEdit({
  user, type, record_id, job_id, expected_text, new_text,
  get, update, now = new Date().toISOString(),
}) {
  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (!isHistoryEditOwner(user)) return { status: 403, body: { error: 'forbidden' } };
  if (!type || !TYPES.includes(type)) return { status: 400, body: { error: 'missing_type' } };
  if (!record_id || !job_id) return { status: 400, body: { error: 'missing_params' } };
  if (typeof expected_text !== 'string') return { status: 400, body: { error: 'missing_expected_text' } };
  if (typeof new_text !== 'string' || new_text.length > HISTORY_EDIT_MAX_TEXT) return { status: 400, body: { error: 'invalid_text' } };
  const trimmed = new_text.trim();
  if (!trimmed) return { status: 400, body: { error: 'empty_text' } };

  const isReport = type === 'report';
  const rec = await get(type, record_id).catch(() => null);
  if (!rec) return { status: 404, body: { error: 'not_found' } };
  if (rec.job_id !== job_id) return { status: 409, body: { error: 'job_mismatch' } };
  const current = isReport ? String(rec.message ?? '') : String(rec.body ?? '');
  if (current !== expected_text) return { status: 409, body: { error: 'conflict', current } };

  // Strict patch: text + EXISTING provenance markers only. original_text is set
  // once (provenance), never overwritten. Photos, attachments, dates, authors,
  // quantities/pricing, job links and provider raw text are never touched here.
  const patch = isReport
    ? { message: trimmed, edited_at: now, edited_by: user.email, ...(rec.original_text ? {} : { original_text: current }) }
    : { body: trimmed, edited: true, edited_by: user.email };
  await update(type, record_id, patch);

  const readback = await get(type, record_id).catch(() => null);
  return {
    status: 200,
    body: {
      ok: true, type, record_id,
      readback: isReport
        ? { message: readback?.message ?? null, original_text: readback?.original_text ?? null, edited_at: readback?.edited_at ?? null, edited_by: readback?.edited_by ?? null }
        : { body: readback?.body ?? null, edited: readback?.edited ?? null, edited_by: readback?.edited_by ?? null },
    },
    write: patch,
  };
}