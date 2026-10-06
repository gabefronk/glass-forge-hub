import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { relocateLinks, mergeJobFields } from '../../shared/jobMerge.js';

// Combine N jobs (N >= 2) into one surviving record. Admin-only. Reuses the
// existing soft-merge model: Jobs.merged_into/merged_at, JobMergeLog, and the
// shared relocateLinks + mergeJobFields used by the pairwise mergeJobs function.
//
// The caller picks exactly one survivor; every other selected job is merged
// into it, one pairwise merge at a time. The survivor is RE-FETCHED before each
// pairwise merge so unions and blank-fills from earlier sources are not
// overwritten by a stale snapshot. Each source gets its own JobMergeLog row so
// every hidden record can be undone individually via reverseMerge.
//
// Partial failure is honest: if one source fails, we record it and continue to
// the next, and the overall `ok` is false. The frontend must not claim full
// success when any source failed, and must not re-submit after an attempt.
// Nothing is deleted — merged-away records stay recoverable.
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
    if (!job_ids.includes(survivor_job_id)) return Response.json({ error: 'survivor_job_id must be one of the selected job_ids' }, { status: 400 });

    // De-duplicate the input and drop the survivor from the source list.
    const uniqueIds = [...new Set(job_ids.map(String))];
    const sourceIds = uniqueIds.filter((id) => id !== String(survivor_job_id));
    if (sourceIds.length === 0) return Response.json({ error: 'Select at least one other job to combine into the survivor' }, { status: 400 });

    // Validate the survivor up front.
    const survivor = await base44.asServiceRole.entities.Jobs.get(survivor_job_id);
    if (!survivor) return Response.json({ error: 'Survivor job not found' }, { status: 404 });
    if (survivor.merged_into) return Response.json({ error: 'The chosen survivor is itself merged into ' + survivor.merged_into }, { status: 400 });
    if (survivor.is_sample) return Response.json({ error: 'Cannot combine sample jobs' }, { status: 400 });

    const results = [];
    let anyFailed = false;

    for (const sourceId of sourceIds) {
      // Re-fetch the survivor each iteration so earlier unions/blank-fills are
      // reflected; a stale survivor would overwrite them with the original values.
      let target;
      try { target = await base44.asServiceRole.entities.Jobs.get(survivor_job_id); }
      catch (e) { results.push({ source_job_id: sourceId, ok: false, error: 'Could not re-fetch survivor: ' + (e?.message || e) }); anyFailed = true; continue; }
      if (!target) { results.push({ source_job_id: sourceId, ok: false, error: 'Survivor disappeared mid-combine' }); anyFailed = true; continue; }
      if (target.merged_into) { results.push({ source_job_id: sourceId, ok: false, error: 'Survivor was merged mid-combine into ' + target.merged_into }); anyFailed = true; continue; }

      let source;
      try { source = await base44.asServiceRole.entities.Jobs.get(sourceId); }
      catch (e) { results.push({ source_job_id: sourceId, ok: false, error: 'Could not load source: ' + (e?.message || e) }); anyFailed = true; continue; }
      if (!source) { results.push({ source_job_id: sourceId, ok: false, error: 'Source job not found' }); anyFailed = true; continue; }
      if (source.merged_into) { results.push({ source_job_id: sourceId, ok: false, error: 'Already merged into ' + source.merged_into }); anyFailed = true; continue; }
      if (source.is_sample) { results.push({ source_job_id: sourceId, ok: false, error: 'Cannot combine sample jobs' }); anyFailed = true; continue; }

      // 1. Relocate. Capture the EXACT moved ids + any per-entity errors so the
      //    audit log can record them and reverseMerge can move exactly these back.
      let relocate;
      try {
        relocate = await relocateLinks(base44, sourceId, survivor_job_id);
      } catch (e) {
        results.push({ source_job_id: sourceId, source_job_name: source?.canonical_name, ok: false, error: 'Relocate threw unexpectedly: ' + (e?.message || e) });
        anyFailed = true;
        continue;
      }
      const { counts, ids, errors: relocateErrors } = relocate;
      const partial = relocateErrors.length > 0;

      // 2. Merge identity fields onto the (fresh) survivor.
      let patch = {}, relocated = {}, conflict_note = "", fieldsError = "";
      try {
        ({ patch, relocated, conflict_note } = mergeJobFields(source, target));
        if (Object.keys(patch).length) await base44.asServiceRole.entities.Jobs.update(survivor_job_id, patch);
      } catch (e) {
        fieldsError = e?.message || String(e);
      }

      // 3. Conflict note (non-fatal if it fails, but always surfaced).
      let conflictNoteRecorded = false, conflictNoteError = "";
      if (conflict_note) {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
        try {
          await base44.asServiceRole.entities.JobNotes.create({
            job_id: survivor_job_id,
            note_date: today,
            interaction_type: "note",
            body: conflict_note,
            author: user.email || user.id || "Glass Forge Hub",
          });
          conflictNoteRecorded = true;
        } catch (e) {
          conflictNoteError = 'Could not save conflict note: ' + (e?.message || String(e));
        }
      }

      // 4. Mark this source as merged ONLY when relocate + fields fully succeeded.
      const now = new Date().toISOString();
      let markError = "";
      const fullyOk = !partial && !fieldsError;
      if (fullyOk) {
        try {
          await base44.asServiceRole.entities.Jobs.update(sourceId, { merged_into: survivor_job_id, merged_at: now });
        } catch (e) {
          markError = e?.message || String(e);
        }
      }

      // 5. ALWAYS write an audit log row with the exact moved ids, so provenance
      //    is never lost even when later steps failed. partial=true means some
      //    records moved but the source was NOT hidden (still visible) — the
      //    admin can reverse this log to put the moved ids back, or investigate.
      let logId = "";
      try {
        const log = await base44.asServiceRole.entities.JobMergeLog.create({
          source_job_id: sourceId,
          source_job_name: source.canonical_name,
          target_job_id: survivor_job_id,
          target_job_name: target.canonical_name,
          merged_by: user.email || user.id,
          merged_at: now,
          relocated_fields: relocated,
          relocated_link_counts: counts,
          relocated_link_ids: ids,
          partial: partial || !!fieldsError || !!markError,
          relocate_errors: relocateErrors.length ? relocateErrors : undefined,
          fields_error: fieldsError || undefined,
          mark_error: markError || undefined,
        });
        logId = log.id;
      } catch (e) {
        // The audit log itself failed to write — serious: records may have
        // moved with no provenance. Surface it loudly with the ids we have.
        results.push({ source_job_id: sourceId, source_job_name: source?.canonical_name, ok: false, error: 'Moved records but FAILED to write audit log: ' + (e?.message || e), relocated_link_ids: ids, relocated_link_counts: counts });
        anyFailed = true;
        continue;
      }

      const ok = fullyOk && !markError;
      if (!ok) anyFailed = true;
      results.push({
        source_job_id: sourceId,
        source_job_name: source.canonical_name,
        ok,
        partial: !ok,
        relocated_link_counts: counts,
        relocated_link_ids: ids,
        relocate_errors: relocateErrors.length ? relocateErrors : undefined,
        fields_error: fieldsError || undefined,
        mark_error: markError || undefined,
        conflict_note_recorded: conflictNoteRecorded,
        conflict_note_error: conflictNoteError || undefined,
        merge_log_id: logId,
      });
    }

    // Totals across the sources that succeeded.
    const totals = { fee_lines: 0, field_reports: 0, calendar_events: 0, job_notes: 0, contact_job_links: 0, job_budgets: 0, probuild_project_links: 0 };
    for (const r of results) {
      if (!r.ok) continue;
      for (const k of Object.keys(totals)) totals[k] += r.relocated_link_counts?.[k] || 0;
    }

    return Response.json({
      ok: !anyFailed,
      survivor_job_id,
      survivor_name: survivor.canonical_name,
      merged_count: results.filter((r) => r.ok).length,
      failed_count: results.filter((r) => !r.ok).length,
      results,
      totals,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}