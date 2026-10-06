import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { mergeSourceIntoTarget, makePacedReader } from '../../shared/jobMerge.js';

// Combine N jobs (N >= 2) into one surviving record. Admin-only. Every other
// selected job is merged into the survivor one at a time through the shared
// audited pipeline (the same one mergeJobs uses), so each source gets its own
// JobMergeLog and can be undone individually. The pipeline re-fetches the
// survivor for every source, so earlier unions are never overwritten.
//
// A source that fails or is blocked is reported honestly and left visible; the
// loop continues with the next source and the overall ok is false.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { job_ids, survivor_job_id } = body;
    if (!Array.isArray(job_ids) || job_ids.length < 2) return Response.json({ error: 'job_ids must be an array of 2 or more ids' }, { status: 400 });
    if (!survivor_job_id) return Response.json({ error: 'survivor_job_id is required' }, { status: 400 });
    if (!job_ids.map(String).includes(String(survivor_job_id))) return Response.json({ error: 'survivor_job_id must be one of the selected job_ids' }, { status: 400 });

    const uniqueIds = [...new Set(job_ids.map(String))];
    const sourceIds = uniqueIds.filter((id) => id !== String(survivor_job_id));
    if (sourceIds.length === 0) return Response.json({ error: 'Select at least one other job to combine into the survivor' }, { status: 400 });

    const survivor = await base44.asServiceRole.entities.Jobs.get(survivor_job_id);
    if (!survivor) return Response.json({ error: 'Survivor job not found' }, { status: 404 });
    if (survivor.merged_into) return Response.json({ error: 'The chosen survivor is itself merged into ' + survivor.merged_into }, { status: 400 });
    if (survivor.is_sample) return Response.json({ error: 'Cannot combine sample jobs' }, { status: 400 });

    const actor = user.email || user.id;
    // One paced reader shared across every source so read scans serialize over the
    // whole request (not reset per source) and transient 429s back off without
    // parallel bursts.
    const read = makePacedReader(base44);
    const results = [];
    for (const sourceId of sourceIds) {
      try {
        results.push(await mergeSourceIntoTarget(base44, { sourceId, targetId: survivor_job_id, actor, read }));
      } catch (e) {
        results.push({ source_job_id: sourceId, ok: false, error: 'Unexpected error: ' + (e?.message || e) });
      }
    }

    const totals = { fee_lines: 0, field_reports: 0, calendar_events: 0, job_notes: 0, contact_job_links: 0, job_budgets: 0, probuild_project_links: 0, job_knowledge: 0, field_library_projects: 0 };
    for (const r of results) {
      if (!r.ok) continue;
      for (const k of Object.keys(totals)) totals[k] += r.relocated_link_counts?.[k] || 0;
    }

    return Response.json({
      ok: results.every((r) => r.ok),
      survivor_job_id,
      survivor_name: survivor.canonical_name,
      requested_count: job_ids.length,
      unique_source_count: sourceIds.length,
      merged_count: results.filter((r) => r.ok).length,
      failed_count: results.filter((r) => !r.ok).length,
      results,
      totals,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}