// Owner-private read/write endpoint for the per-job rough labor/material and
// sale price (JobMoneyInputs). Authenticates the caller's auth user id BEFORE
// any entity read or write — admin role or email is not enough. Returns only
// the safe fields. Rejects malformed/missing/merged/sample jobs and any extra
// payload field. Profit is never stored; it is computed read-only in the UI.
//
// This function does NOT expose existing procurement pricing (budgets, POs,
// vendor orders). Those remain on the existing `procurement` function, whose
// access rules are unchanged. The handler logic lives in the injectable,
// SDK-free base44/shared/purchasingMoneyHandle.js so it can be tested with a
// mocked adapter.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { handle } from '../../shared/purchasingMoneyHandle.js';

export default async function (req) {
  const base44 = createClientFromRequest(req);
  const adapter = {
    authMe: () => base44.auth.me(),
    jobsGet: (id) => base44.asServiceRole.entities.Jobs.get(id),
    moneyList: (opts) => base44.asServiceRole.entities.JobMoneyInputs.list({ sort: opts.sort, limit: opts.limit, cursor: opts.cursor }),
    moneyFilter: (q, opts) => base44.asServiceRole.entities.JobMoneyInputs.filter(q, { sort: opts.sort, limit: opts.limit }),
    moneyGet: (id) => base44.asServiceRole.entities.JobMoneyInputs.get(id),
    moneyUpdate: (id, patch) => base44.asServiceRole.entities.JobMoneyInputs.update(id, patch),
    moneyCreate: (data) => base44.asServiceRole.entities.JobMoneyInputs.create(data),
  };
  const { status, body } = await handle(req, adapter);
  return Response.json(body, { status });
}