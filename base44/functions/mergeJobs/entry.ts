import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { relocateLinks, mergeJobFields } from '../../shared/jobMerge.js';

// Merge a duplicate job (source) into the surviving job (target).
// Admin-only. Relocates all linked records, merges identity fields onto the
// target, marks the source as merged_into, and writes an append-only
// JobMergeLog entry for audit and reversal.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { source_job_id, target_job_id } = body;
    if (!source_job_id || !target_job_id) return Response.json({ error: 'source_job_id and target_job_id are required' }, { status: 400 });
    if (source_job_id === target_job_id) return Response.json({ error: 'Cannot merge a job into itself' }, { status: 400 });

    const source = await base44.asServiceRole.entities.Jobs.get(source_job_id);
    const target = await base44.asServiceRole.entities.Jobs.get(target_job_id);
    if (!source) return Response.json({ error: 'Source job not found' }, { status: 404 });
    if (!target) return Response.json({ error: 'Target job not found' }, { status: 404 });
    if (source.merged_into) return Response.json({ error: 'Source job is already merged into ' + source.merged_into }, { status: 400 });
    if (target.merged_into) return Response.json({ error: 'Target job is itself merged into ' + target.merged_into }, { status: 400 });
    if (source.is_sample || target.is_sample) return Response.json({ error: 'Cannot merge sample jobs' }, { status: 400 });

    // 1. Relocate all linked records from source → target.
    const counts = await relocateLinks(base44, source_job_id, target_job_id);

    // 2. Merge identity fields (po_numbers, oe_numbers, aliases, and blank
    //    identity/document scalars) onto target. A conflict note records any
    //    source value that differed from a non-empty target value, so it is
    //    never lost. The survivor's value always wins.
    const { patch, relocated, conflict_note } = mergeJobFields(source, target);
    if (Object.keys(patch).length) await base44.asServiceRole.entities.Jobs.update(target_job_id, patch);
    if (conflict_note) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
      await base44.asServiceRole.entities.JobNotes.create({
        job_id: target_job_id,
        note_date: today,
        interaction_type: "note",
        body: conflict_note,
        author: user.email || user.id || "Glass Forge Hub",
      }).catch(() => { /* a failed conflict note must not fail the merge */ });
    }

    // 3. Mark source as merged.
    const now = new Date().toISOString();
    await base44.asServiceRole.entities.Jobs.update(source_job_id, { merged_into: target_job_id, merged_at: now });

    // 4. Write append-only audit log.
    const log = await base44.asServiceRole.entities.JobMergeLog.create({
      source_job_id,
      source_job_name: source.canonical_name,
      target_job_id,
      target_job_name: target.canonical_name,
      merged_by: user.email || user.id,
      merged_at: now,
      relocated_fields: relocated,
      relocated_link_counts: counts,
    });

    return Response.json({
      ok: true,
      source_job_id,
      target_job_id,
      relocated_link_counts: counts,
      relocated_fields: relocated,
      target_patch: patch,
      conflict_note_recorded: !!conflict_note,
      merge_log_id: log.id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}