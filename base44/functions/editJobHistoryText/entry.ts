import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { applyHistoryTextEdit } from '../../shared/historyEdit.js';

// Owner-only inline text correction for crew field-report (FieldReports.message)
// and job-note (JobNotes.body) text on the job History cards. See
// base44/shared/historyEdit.js for the full security model (owner gate, strict
// whitelist, concurrency, provenance markers, stored readback). Runs as the
// service role so the owner can write FieldReports (admin-only RLS) and JobNotes
// without a role check on the entity itself; the owner-gate is enforced in code.
//
// Reports and notes are explicit types backed by different models:
//   report -> FieldReports (message + original_text/edited_at/edited_by)
//   note   -> JobNotes     (body + edited/edited_by)
//
// The request body is destructured to EXACTLY five fields — type, record_id,
// job_id, expected_text, new_text — and nothing else is forwarded to
// applyHistoryTextEdit. A client cannot override server-stamped values: now is
// server-time, edited_at/edited_by come from the auth user, and original_text is
// set-once from the pre-edit text. Spreading the raw body would let a caller
// pass now/edited_at/edited_by/original_text and override provenance; the
// destructure closes that.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const body = await req.json().catch(() => ({}));
    const { type, record_id, job_id, expected_text, new_text } = body;
    const db = base44.asServiceRole.entities;
    const get = (t, id) => (t === 'report' ? db.FieldReports.get(id) : db.JobNotes.get(id));
    const update = (t, id, patch) => (t === 'report' ? db.FieldReports.update(id, patch) : db.JobNotes.update(id, patch));
    const result = await applyHistoryTextEdit({ type, record_id, job_id, expected_text, new_text, user, get, update });
    // Platform convention for these action endpoints: return 200 with the error
    // code in the body (matches resolveFieldReport). The owner gate is enforced
    // in code regardless of HTTP status. save_unknown is also 200 with
    // { ok:false, save_unknown:true } so the UI locks and asks for a Reload.
    return Response.json(result.body, { status: 200 });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}