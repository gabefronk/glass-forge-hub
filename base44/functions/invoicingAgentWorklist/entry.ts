import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { buildAgentWorklist } from '../../shared/invoicingAgent.js';
import { fetchAllPages } from '../../shared/pagination.ts';

// Invoicing Agent v1 — read-only worklist. Admin-only. Never writes to any
// record. Returns the current month + prior month's open lines grouped into
// needs_pricing, needs_job_link, pricing_conflicts and ready_to_bill.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const currentMonth =
      (body && body.month && /^\d{4}-\d{2}$/.test(body.month) && body.month) ||
      new Date().toISOString().slice(0, 7);

    // Read-only fetches. Admin user-scoped reads return all records (FeeLines /
    // CalendarEvents RLS allow admin). Jobs has no read restriction.
    const [feeLines, jobs, events] = await Promise.all([
      fetchAllPages(base44.entities.FeeLines, '-job_date', 1000),
      fetchAllPages(base44.entities.Jobs, '-created_date', 1000),
      fetchAllPages(base44.entities.CalendarEvents, '-event_date', 1000),
    ]);

    const worklist = buildAgentWorklist({
      feeLines,
      jobs,
      events,
      currentMonth,
    });
    return Response.json(worklist);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}