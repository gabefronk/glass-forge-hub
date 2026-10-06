import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { reverseMergeLog, makePacedReader } from '../../shared/jobMerge.js';

// Undo one audited merge (complete OR partial). Admin-only. Moves back exactly
// the record ids the log recorded (guarded by their current job_id, so the
// survivor's own records are never touched), un-hides the source first, and
// only marks the log reversed when nothing is left behind — a failed undo can be
// run again. Legacy logs without exact-ID auditing are refused.
// Identity fields (po_numbers, oe_numbers, aliases) stay on the survivor.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { merge_log_id, source_job_id } = body;
    if (!merge_log_id && !source_job_id) return Response.json({ error: 'merge_log_id or source_job_id is required' }, { status: 400 });

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

    const r = await reverseMergeLog(base44, log, { actor: user.email || user.id, read: makePacedReader(base44) });
    const { status = 200, ...rest } = r;
    return Response.json(rest, { status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}