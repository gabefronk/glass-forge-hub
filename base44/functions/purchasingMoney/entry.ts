// Owner-private read/write endpoint for the per-job rough labor/material and
// sale price (JobMoneyInputs). Authenticates the caller's auth user id BEFORE
// any entity read or write — admin role or email is not enough. Returns only
// the safe fields. Profit is never stored; it is computed read-only in the UI.
//
// SDK pinned to 0.8.53, the version whose entities contract (options-object
// list/filter → EntityPage { items, next_cursor, has_more }) the handler
// validates. The handler logic lives in the injectable, SDK-free
// base44/shared/purchasingMoneyHandle.js so it can be tested with a mock.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { handle } from '../../shared/purchasingMoneyHandle.js';

export default async function (req) {
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities;
  const adapter = {
    authMe: () => base44.auth.me(),
    jobsGet: (id) => db.Jobs.get(id),
    moneyList: (opts) => db.JobMoneyInputs.list(opts),
    moneyFilter: (q, opts) => db.JobMoneyInputs.filter(q, opts),
    moneyGet: (id) => db.JobMoneyInputs.get(id),
    moneyUpdate: (id, patch) => db.JobMoneyInputs.update(id, patch),
    moneyCreate: (data) => db.JobMoneyInputs.create(data),
  };
  const { status, body } = await handle(req, adapter);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}