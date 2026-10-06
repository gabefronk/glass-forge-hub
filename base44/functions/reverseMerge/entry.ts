import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { relocateLinksByIds } from '../../shared/jobMerge.js';

// Reverse a previously performed merge. Admin-only. Moves all linked records
// back from the target to the source, clears the source's merged_into/merged_at,
// and marks the JobMergeLog entry as reversed.
//
// Identity fields (po_numbers, oe_numbers, aliases) that were moved onto the
// target are NOT removed — they are left on the target to avoid data loss.
// The source keeps its original identity fields; the snapshot in the log
// records what was moved.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { merge_log_id, source_job_id } = body;
    if (!merge_log_id && !source_job_id) return Response.json({ error: 'merge_log_id or source_job_id is required' }, { status: 400 });

    // Find the merge log entry.
    let log;
    if (merge_log_id) {
      log = await base44.asServiceRole.entities.JobMergeLog.get(merge_log_id);
    } else {
      const logs = await base44.asServiceRole.entities.JobMergeLog.filter(
        { source_job_id, reversed: false },
        { sort: '-merged_at', limit: 1 }
      );
      log = (logs.items || [])[0];
    }
    if (!log) return Response.json({ error: 'Merge log not found' }, { status: 404 });
    if (log.reversed) return Response.json({ error: 'This merge was already reversed' }, { status: 400 });

    // Distinguish audited logs (audit_version >= 1) from legacy logs that
    // predate exact-ID auditing. Legacy logs have no recorded ids and cannot be
    // safely reversed — a blind relocate would also move the survivor's own
    // records, so refuse. An audited log may legitimately have moved ZERO links
    // (a stub job): in that case there is nothing to move back, so we just clear
    // the marker. Otherwise move exactly the ids that actually moved, falling
    // back to the planned ids (the job_id guard makes moving-back of unmoved ids
    // a no-op, so the fallback is safe).
    const audited = typeof log.audit_version === "number" && log.audit_version >= 1;
    if (!audited) {
      return Response.json({
        error: "This merge log predates exact-ID auditing and cannot be safely reversed automatically. Its moved records are not individually recorded, so a blind relocate would also move the survivor's own records. Leave the merge in place or contact support.",
      }, { status: 409 });
    }

    const movedIds = log.relocated_link_ids || {};
    const plannedIds = log.planned_link_ids || {};
    const hasMovedIds = Object.values(movedIds).some((arr) => Array.isArray(arr) && arr.length);
    const hasPlannedIds = Object.values(plannedIds).some((arr) => Array.isArray(arr) && arr.length);
    const idsToReverse = hasMovedIds ? movedIds : (hasPlannedIds ? plannedIds : {});

    let backCounts = {};
    let reverseErrors = [];
    if (hasMovedIds || hasPlannedIds) {
      const r = await relocateLinksByIds(base44, idsToReverse, log.target_job_id, log.source_job_id);
      backCounts = r.counts;
      reverseErrors = r.errors;
    }
    // Audited but zero links ever moved: nothing to relocate, just clear marker.

    // Clear the source's merged flags.
    await base44.asServiceRole.entities.Jobs.update(log.source_job_id, { merged_into: null, merged_at: null });

    // Mark the log as reversed.
    const now = new Date().toISOString();
    await base44.asServiceRole.entities.JobMergeLog.update(log.id, {
      reversed: true,
      reversed_at: now,
      reversed_by: user.email || user.id,
    });

    return Response.json({
      ok: reverseErrors.length === 0,
      source_job_id: log.source_job_id,
      target_job_id: log.target_job_id,
      relocated_back_counts: backCounts,
      reverse_errors: reverseErrors.length ? reverseErrors : undefined,
      merge_log_id: log.id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}