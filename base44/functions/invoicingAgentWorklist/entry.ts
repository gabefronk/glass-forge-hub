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
    // sample: return counts + up to 3 real examples per section (for quick
    // read-only verification). Full payload otherwise.
    const sample = !!(body && body.sample);

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
    const slimC = (g) => ({ job_name: g.job_name, job_date: g.job_date, amounts: g.amounts, lines: g.lines.map((l) => ({ line_id: l.line_id, source: l.source, labor_amt: l.labor_amt, superseded_by: l.superseded_by })) });
    if (body && body.section === 'conflicts') {
      return Response.json({ counts: worklist.counts, pricing_conflicts: worklist.pricing_conflicts.map(slimC) });
    }
    if (!sample) return Response.json(worklist);
    const top = (arr, n) => arr.slice(0, n);
    const slimP = (r) => ({ line_id: r.line_id, job_date: r.job_date, title: r.job_name_raw, source: r.source, job_id: r.job_id, labor_amt: r.labor_amt, crew_line: r.crew_line, send_for_review_eligible: r.send_for_review_eligible });
    const slimL = (r) => ({ line_id: r.line_id, job_date: r.job_date, title: r.job_name_raw, source: r.source, reason: r.reason, current_job_name: r.current_job_name, suggested_job_name: r.suggested_job_name, candidates: (r.candidates || []).map((c) => c.job_name) });
    return Response.json({
      current_month: worklist.current_month,
      prior_month: worklist.prior_month,
      today: worklist.today,
      scoped_line_count: worklist.scoped_line_count,
      counts: worklist.counts,
      ready_to_bill: worklist.ready_to_bill,
      needs_pricing: top(worklist.needs_pricing, 2).map(slimP),
      needs_job_link: top(worklist.needs_job_link, 2).map(slimL),
      pricing_conflicts: top(worklist.pricing_conflicts, 2).map(slimC),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}