import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Fee-line crew review (Hub-side only — no email/text/external notification).
//   list    → returns lines flagged sent_for_review, exposing ONLY crew-safe fields
//             (job, description, notes, labor). No fee %, fee amounts, margins or
//             owner-only pricing ever leaves this function.
//   confirm → the crew (Israel) enters the labor; clears the sent_for_review flag,
//             sets needs_review true so Gabriel sees it back as Needs review, and
//             recomputes fee_amt from the stored fee_pct. Existing fee_pct, manual
//             adjustments and all other fields are preserved.
// Runs as the service role because FeeLines RLS is admin-only; the crew role cannot
// read or update FeeLines directly. The caller must be authenticated.

export default async function feeLineReview(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;
    const action = body.action || 'list';

    if (action === 'list') {
      const page = await db.FeeLines.filter({ sent_for_review: true }, { sort: '-created_date', limit: 200 });
      const rows = Array.isArray(page) ? page : (page?.items || []);
      const items = rows.map((r) => ({
        id: r.id,
        job_id: r.job_id || '',
        job_name: r.job_name_raw || r.job_name_norm || '',
        job_date: r.job_date || '',
        line_description: r.line_description || '',
        note_text: r.note_text || '',
        calendar_note_text: r.calendar_note_text || '',
        labor_amt: r.labor_amt ?? 0,
        sent_for_review_at: r.sent_for_review_at || '',
        sent_for_review_by: r.sent_for_review_by || '',
      }));
      return Response.json({ items });
    }

    if (action === 'confirm') {
      const id = String(body.id || '');
      const labor = Number(body.labor_amt);
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      if (!Number.isFinite(labor) || labor < 0) return Response.json({ error: 'Enter a valid labor amount.' }, { status: 400 });
      const row = await db.FeeLines.get(id).catch(() => null);
      if (!row) return Response.json({ error: 'line not found' }, { status: 404 });
      if (!row.sent_for_review) return Response.json({ error: 'This line is not waiting for crew confirmation.' }, { status: 409 });
      const feePct = Number(row.fee_pct) || 0;
      const feeAmt = Math.round(labor * feePct * 100) / 100;
      // Clear the crew flag and return the line to Gabriel as Needs review.
      // fee_pct and manually_adjusted are intentionally untouched (hard rule).
      await db.FeeLines.update(id, {
        labor_amt: labor,
        fee_amt: feeAmt,
        needs_review: true,
        sent_for_review: false,
        sent_for_review_at: null,
        sent_for_review_by: null,
      });
      return Response.json({ status: 'ok', id });
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}