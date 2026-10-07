// Owner-private read/write endpoint for the per-job rough labor/material and
// sale price (JobMoneyInputs). Authenticates the caller's auth user id BEFORE
// any entity read or write — admin role or email is not enough. Returns only
// the safe fields. Rejects malformed/missing/merged/sample jobs and any extra
// payload field. Profit is never stored; it is computed read-only in the UI.
//
// This function does NOT expose existing procurement pricing (budgets, POs,
// vendor orders). Those remain on the existing `procurement` function, whose
// access rules are unchanged.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  isPurchasingMoneyOwner, validateSavePayload, sanitizeInput,
} from '../../shared/purchasingMoneyPure.js';

export default async function (req) {
  const base44 = createClientFromRequest(req);

  // 1. Authenticate the caller by id BEFORE any entity read. Null (scheduled)
  //    and non-owner users are rejected with 403 before a single row is read.
  const user = await base44.auth.me().catch(() => null);
  if (!isPurchasingMoneyOwner(user)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'list') {
    const rows = await base44.asServiceRole.entities.JobMoneyInputs.list('-updated_date', 1000);
    const items = Array.isArray(rows) ? rows : rows?.items || [];
    return Response.json({ inputs: items.map(sanitizeInput).filter(Boolean) });
  }

  if (action === 'save') {
    const parsed = validateSavePayload(body);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

    // 2. Verify the job exists, is not merged away, and is not a sample —
    //    before any money write. Exact id only; never inferred from a name.
    const job = await base44.asServiceRole.entities.Jobs.get(parsed.job_id).catch(() => null);
    if (!job) return Response.json({ error: 'job_not_found' }, { status: 400 });
    if (job.merged_into) return Response.json({ error: 'job_merged' }, { status: 400 });
    if (job.is_sample) return Response.json({ error: 'sample_job' }, { status: 400 });

    // 3. Upsert the single money row for this job (one row per job_id).
    const existing = await base44.asServiceRole.entities.JobMoneyInputs
      .filter({ job_id: parsed.job_id }, '-updated_date', 5)
      .catch(() => []);
    const arr = Array.isArray(existing) ? existing : existing?.items || [];
    const patch = {
      rough_labor_material: parsed.rough_labor_material,
      sale_price: parsed.sale_price,
    };
    let saved;
    if (arr.length) {
      saved = await base44.asServiceRole.entities.JobMoneyInputs.update(arr[0].id, patch);
    } else {
      saved = await base44.asServiceRole.entities.JobMoneyInputs.create({
        job_id: parsed.job_id,
        ...patch,
      });
    }
    return Response.json({ input: sanitizeInput(saved) });
  }

  return Response.json({ error: 'unknown_action' }, { status: 400 });
}