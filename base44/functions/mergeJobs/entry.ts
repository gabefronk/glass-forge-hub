import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { planRelocateLinks, executeRelocateLinks, mergeJobFields } from '../../shared/jobMerge.js';

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

    const now = new Date().toISOString();

    // 1. PLAN — list the exact source link ids WITHOUT mutating.
    const { plan, errors: planErrors } = await planRelocateLinks(base44, source_job_id);
    const planPartial = planErrors.length > 0;

    // 2. CREATE the audit log BEFORE any move, with planned ids. If this fails
    //    we abort with zero moves — nothing to reverse.
    let log;
    try {
      log = await base44.asServiceRole.entities.JobMergeLog.create({
        source_job_id,
        source_job_name: source.canonical_name,
        target_job_id,
        target_job_name: target.canonical_name,
        merged_by: user.email || user.id,
        merged_at: now,
        planned_link_ids: plan,
        relocated_link_ids: {},
        relocated_link_counts: {},
        relocated_fields: {},
        audit_version: 1,
        status: "planned",
        partial: true,
        relocate_errors: planErrors.length ? planErrors : undefined,
      });
    } catch (e) {
      return Response.json({ error: 'Could not create audit log before moving; aborted with zero moves: ' + (e?.message || e) }, { status: 500 });
    }

    // 3. EXECUTE — move exactly the planned ids, guarded by current job_id.
    let exec;
    try {
      exec = await executeRelocateLinks(base44, plan, source_job_id, target_job_id);
    } catch (e) {
      await base44.asServiceRole.entities.JobMergeLog.update(log.id, {
        status: "failed",
        relocate_errors: ['execute threw: ' + (e?.message || e)],
      }).catch(() => {});
      return Response.json({ error: 'Relocate threw after audit created; see log ' + log.id, merge_log_id: log.id }, { status: 500 });
    }
    const { moved, counts, errors: execErrors } = exec;
    const relocateErrors = [...planErrors, ...execErrors];
    const relocatePartial = relocateErrors.length > 0;

    // 4. UPDATE the audit log with the ids that actually moved. If this fails
    //    after records moved, STOP and return the log id + recovery info.
    try {
      await base44.asServiceRole.entities.JobMergeLog.update(log.id, {
        relocated_link_ids: moved,
        relocated_link_counts: counts,
        relocate_errors: relocateErrors.length ? relocateErrors : undefined,
        status: relocatePartial ? "relocated_partial" : "relocated",
      });
    } catch (e) {
      return Response.json({ error: 'Moved records but could not update audit log. Stopped before field merge. Reverse log ' + log.id + ' to recover (planned ids are recorded).', merge_log_id: log.id, relocated_link_ids: moved, relocated_link_counts: counts }, { status: 500 });
    }

    // 5. Merge identity fields (po_numbers, oe_numbers, aliases, and blank
    //    identity/document scalars) onto target. A conflict note records any
    //    source value that differed from a non-empty target value, so it is
    //    never lost. The survivor's value always wins.
    let patch = {}, relocated = {}, conflict_note = "", fieldsError = "";
    try {
      ({ patch, relocated, conflict_note } = mergeJobFields(source, target));
      if (Object.keys(patch).length) await base44.asServiceRole.entities.Jobs.update(target_job_id, patch);
    } catch (e) {
      fieldsError = e?.message || String(e);
    }
    let conflictNoteRecorded = false, conflictNoteError = "";
    if (conflict_note) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
      try {
        await base44.asServiceRole.entities.JobNotes.create({
          job_id: target_job_id,
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

    // 6. Mark source as merged ONLY when relocate + fields fully succeeded.
    let markError = "";
    const fullyOk = !relocatePartial && !fieldsError;
    if (fullyOk) {
      try {
        await base44.asServiceRole.entities.Jobs.update(source_job_id, { merged_into: target_job_id, merged_at: now });
      } catch (e) {
        markError = e?.message || String(e);
      }
    }

    // 7. Final audit update. Conflict-note or mark failures never claim full
    //    success. Source-specific reversal stays usable via merge_log_id.
    const ok = fullyOk && !markError && !conflictNoteError;
    try {
      await base44.asServiceRole.entities.JobMergeLog.update(log.id, {
        relocated_fields: relocated,
        partial: !ok,
        fields_error: fieldsError || undefined,
        mark_error: markError || undefined,
        status: ok ? "complete" : "partial",
      });
    } catch (e) {
      return Response.json({ error: 'Merge proceeded but final audit update failed: ' + (e?.message || e), merge_log_id: log.id, relocated_link_ids: moved }, { status: 500 });
    }

    return Response.json({
      ok,
      source_job_id,
      target_job_id,
      relocated_link_counts: counts,
      relocated_link_ids: moved,
      relocated_fields: relocated,
      target_patch: patch,
      partial: !ok,
      relocate_errors: relocateErrors.length ? relocateErrors : undefined,
      fields_error: fieldsError || undefined,
      mark_error: markError || undefined,
      conflict_note_recorded: conflictNoteRecorded,
      conflict_note_error: conflictNoteError || undefined,
      merge_log_id: log.id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}