// Pure logic for the owner-only inline text edit on job history cards
// (crew field-report message + job-note body). No SDK, no fetch — get/update
// are injected. The entry (base44/functions/editJobHistoryText/entry.ts) wires
// the real service-role SDK; tests inject mocks.
//
// Security model:
//  - Owner gate: only HISTORY_EDIT_OWNER_IDS (Gabriel's immutable auth ids).
//    Admin role alone is NOT enough (multiple admins). Twin of
//    src/lib/ownerAccess.js HISTORY_EDIT_OWNER_IDS (kept in sync manually).
//  - Strict whitelist: the entry destructures EXACTLY type/record_id/job_id/
//    expected_text/new_text from the request — nothing else is forwarded. Here
//    only those five are read; only the text field + EXISTING provenance markers
//    are written. No arbitrary entity payload reaches the SDK update. A client
//    cannot override now/edited_at/edited_by/original_text: now is server-time,
//    edited_at/edited_by are server-stamped from the auth user, and
//    original_text is set-once from the pre-edit text.
//  - Concurrency: a fresh reread immediately before the update compares the
//    original text + job_id; a mismatch means the record changed before we
//    started the PUT -> 409, no write. original_text is a provenance marker
//    (set once, never overwritten), NOT the concurrency token. The SDK update
//    is a plain PUT with no predicate/revision — there is NO atomic
//    compare-and-set. The GET-PUT gap is UNDETECTED: a concurrent write landing
//    between the reread and our PUT is silently clobbered by our PUT, and the
//    readback below would read back OUR text and pass — so the readback does
//    NOT catch a write we overwrote. The readback only catches the PUT-readback
//    gap (a write landing between our PUT and the readback -> mismatched text
//    -> save_unknown). The platform exposes no CAS to close the GET-PUT gap;
//    we do not pretend the readback is a CAS substitute.
//  - Stored readback: after the update we re-get and verify exact id + job_id
//    + text + marker patch. If the get fails, or the text/markers/id/job don't
//    match what we just wrote, we return save_unknown (the update may have
//    committed but we cannot confirm it). The UI locks Save and asks for a
//    Reload; it never auto-retries (a retry could double-write or clobber a
//    concurrent edit). An update() that throws is also save_unknown — a throw
//    does NOT mean the write didn't happen.
//  - Markers stamp the EXISTING fields sourceNoteFollowthrough already checks
//    (edited_at/edited_by/original_text on reports; edited/edited_by on notes)
//    so a later ProBuild/source-note refresh cannot overwrite the correction.
//    No new marker is invented.
//  - Text-only: this path never deletes or restores a record.

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
  const textField = isReport ? 'message' : 'body';

  // Fresh reread immediately before the update. Compare original text + job_id;
  // a mismatch means the record changed before we started the PUT -> reject,
  // no write. No atomic CAS: the SDK PUT carries no predicate/revision. The
  // GET-PUT gap is undetected — a concurrent write landing between this reread
  // and our PUT is silently clobbered, and the readback would read back OUR
  // text and pass (so the readback does NOT catch a write we overwrote). The
  // readback only catches the PUT-readback gap (a write after our PUT).
  const rec = await get(type, record_id).catch(() => null);
  if (!rec) return { status: 404, body: { error: 'not_found' } };
  if (rec.job_id !== job_id) return { status: 409, body: { error: 'job_mismatch' } };
  const current = String(rec[textField] ?? '');
  if (current !== expected_text) return { status: 409, body: { error: 'conflict', current } };

  // Strict patch: text + EXISTING provenance markers only. original_text is set
  // once (provenance), never overwritten. Photos, attachments, dates, authors,
  // quantities/pricing, job links and provider raw text are never touched here.
  const setOriginal = isReport && !rec.original_text;
  const patch = isReport
    ? { message: trimmed, edited_at: now, edited_by: user.email, ...(setOriginal ? { original_text: current } : {}) }
    : { body: trimmed, edited: true, edited_by: user.email };

  // update may throw (network, RLS, transient). A throw does NOT mean the write
  // didn't happen — the platform PUT may have committed before the response was
  // lost. Treat any update failure as save_unknown (may have written); never
  // claim a clean failure. The UI locks Save and asks for a Reload.
  let updateThrew = false;
  try {
    await update(type, record_id, patch);
  } catch (_) {
    updateThrew = true;
  }

  // Every save_unknown path is reached AFTER the update was attempted (sent or
  // threw), so the write may have committed — may_have_written is always true.
  // The UI locks Save and asks for a Reload; it never auto-retries.
  const unknown = () => ({
    status: 200,
    body: { ok: false, save_unknown: true, may_have_written: true, type, record_id },
    write: patch,
  });
  if (updateThrew) return unknown();

  // Stored readback: re-get and verify exact id + job_id + text + marker patch.
  const readback = await get(type, record_id).catch(() => null);
  if (!readback) return unknown(); // readback get failed -> can't confirm (write may have committed)
  if (readback.id !== record_id) return unknown();
  if (readback.job_id !== job_id) return unknown();
  if (String(readback[textField] ?? '') !== trimmed) return unknown(); // text didn't stick (silent drop / concurrent overwrite)
  if (isReport) {
    if (readback.edited_at !== now) return unknown();
    if (readback.edited_by !== user.email) return unknown();
    const expectedOriginal = setOriginal ? current : rec.original_text;
    if (String(readback.original_text ?? '') !== String(expectedOriginal ?? '')) return unknown();
  } else {
    if (readback.edited !== true) return unknown();
    if (readback.edited_by !== user.email) return unknown();
  }

  return {
    status: 200,
    body: {
      ok: true, type, record_id,
      readback: isReport
        ? { id: readback.id, job_id: readback.job_id, message: readback.message, original_text: readback.original_text, edited_at: readback.edited_at, edited_by: readback.edited_by }
        : { id: readback.id, job_id: readback.job_id, body: readback.body, edited: readback.edited, edited_by: readback.edited_by },
    },
    write: patch,
  };
}