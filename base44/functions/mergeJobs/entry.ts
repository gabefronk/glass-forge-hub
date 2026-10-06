import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { mergeSourceIntoTarget, makePacedReader } from '../../shared/jobMerge.js';

// Merge one duplicate job (source) into the surviving job (target). Admin-only.
// Uses the shared audited pipeline (plan → log → move+verify → reconcile →
// fields → final check → hide). A source that cannot be fully merged is left
// visible and the result says so (ok:false); the log id is always returned.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { source_job_id, target_job_id } = body;
    if (!source_job_id || !target_job_id) return Response.json({ error: 'source_job_id and target_job_id are required' }, { status: 400 });

    const r = await mergeSourceIntoTarget(base44, {
      sourceId: source_job_id,
      targetId: target_job_id,
      actor: user.email || user.id,
      read: makePacedReader(base44),
    });
    return Response.json({ ...r, target_job_id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}