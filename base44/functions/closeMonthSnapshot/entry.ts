import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { fetchAllPages } from '../../shared/pagination.ts';
import { buildSupersededSet } from '../../shared/supersession.ts';

// Immutable month-close snapshot. Captures EVERY FeeLine for the month with
// its status at close time, so a later re-ingest can never make a previously
// invoiced month unverifiable — and so the record can answer "why wasn't this
// billed?" months later.
//
// Stores:
//   lines        — ALL month rows (billable, non-billable, superseded, future,
//                  blocked) with their status at close time.
//   invoiced_subtotal — sum of fee_amt for rows that were ready to bill.
//   earned_total — sum of fee_amt for non-superseded, non-future, labor>0 or
//                  profit_split rows (excludes scheduled work).
//   population_definition — self-documenting description of what's counted.
//
// Params:
//   month   — YYYY-MM (required)
//   force   — when true, creates a new snapshot even if one already exists
//   dry_run — when true, computes and returns the snapshot data WITHOUT writing
//                  anything to the database. Use this for testing.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const month = body.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: 'invalid_month' }, { status: 200 });
    }

    // Check for an existing snapshot
    const existing = await fetchAllPages(base44.asServiceRole.entities.MonthCloseSnapshot, '-created_date', 100);
    const prior = existing.find((s) => s.month === month);
    if (prior && !body.force) {
      return Response.json({
        error: 'already_closed',
        closed_at: prior.closed_at,
        closed_by: prior.closed_by,
        total_fee: prior.invoiced_subtotal ?? prior.total_fee,
        line_count: prior.line_count,
      }, { status: 200 });
    }

    // Build the snapshot from current FeeLines + CalendarEvents
    const allFees = await fetchAllPages(base44.asServiceRole.entities.FeeLines, '-created_date', 5000);
    const monthRows = allFees.filter((f) => f.invoice_month === month);

    // Load CalendarEvents for report_status (same as the Invoicing UI)
    const allCalEvents = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 5000);
    const reportStatusMap = new Map();
    for (const e of allCalEvents) {
      if (e.google_event_id && (e.event_date || '').startsWith(month)) {
        reportStatusMap.set(e.google_event_id, e.report_status);
      }
    }

    // Conditional supersession — same logic as the Invoicing UI
    const supersededSet = buildSupersededSet(monthRows);

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const OK_REPORT_STATUSES = ['ok', 'waived', 'pre_compliance', 'no_source_data'];

    const isFuture = (f) => !!(f.job_date && f.job_date > todayStr);
    const isMatchBlocked = (f) => f.needs_review && !f.manually_adjusted;
    const isReportBlocked = (f) => {
      if (!f.calendar_event_id) return false;
      const status = reportStatusMap.get(f.calendar_event_id);
      if (!status) return false;
      return !OK_REPORT_STATUSES.includes(status);
    };
    const isReady = (f) =>
      f.billable &&
      !f.billed_to_bfs &&
      !isFuture(f) &&
      !isMatchBlocked(f) &&
      !isReportBlocked(f) &&
      !supersededSet.has(f.id) &&
      (Number(f.labor_amt) > 0 || f.fee_type === 'profit_split');

    const isEarned = (f) =>
      !supersededSet.has(f.id) &&
      !isFuture(f) &&
      (Number(f.labor_amt) > 0 || f.fee_type === 'profit_split');

    // Store EVERY row with its status at close time
    const lines = monthRows.map((f) => ({
      id: f.id,
      job_date: f.job_date || null,
      job_name: f.job_name_norm || f.job_name_raw || null,
      line_description: f.line_description || null,
      labor_amt: Number(f.labor_amt) || 0,
      fee_pct: Number(f.fee_pct) || 0,
      fee_amt: Number(f.fee_amt) || 0,
      fee_type: f.fee_type || 'labor_pct',
      billable: f.billable !== false,
      billed_to_bfs: !!f.billed_to_bfs,
      source: f.source || null,
      superseded_by: f.superseded_by || null,
      superseded: supersededSet.has(f.id),
      needs_review: !!f.needs_review,
      match_confidence: f.match_confidence || null,
      calendar_event_id: f.calendar_event_id || null,
      report_status: f.calendar_event_id ? (reportStatusMap.get(f.calendar_event_id) || null) : null,
      ready: isReady(f),
      future: isFuture(f),
    }));

    const earnedRows = monthRows.filter(isEarned);
    const invoicedRows = monthRows.filter(isReady);

    const totalLabor = Math.round(earnedRows.reduce((s, f) => s + (Number(f.labor_amt) || 0), 0) * 100) / 100;
    const earnedTotal = Math.round(earnedRows.reduce((s, f) => s + (Number(f.fee_amt) || 0), 0) * 100) / 100;
    const invoicedSubtotal = Math.round(invoicedRows.reduce((s, f) => s + (Number(f.fee_amt) || 0), 0) * 100) / 100;

    const POPULATION_DEFINITION = [
      'Snapshot stores every FeeLine for the month with its status at close time.',
      'lines: ALL rows (billable, non-billable, superseded, future, blocked) with their status.',
      'Superseded rows are excluded from all totals via conditional supersession',
      '(calendar_labor_amt present → probuild suppressed only for trip-charge case;',
      'else merge-case: calendar labor > 0 → probuild suppressed; calendar $0 + probuild hours → calendar suppressed).',
      'invoiced_subtotal: rows that are billable, not billed_to_bfs, not future, not match-blocked',
      '(needs_review && !manually_adjusted), not report-blocked (report_status not in',
      'ok/waived/pre_compliance/no_source_data), not superseded, labor_amt > 0 or fee_type = profit_split.',
      'earned_total: non-superseded, non-future, labor_amt > 0 or fee_type = profit_split.',
      'total_rows: count of all month rows including superseded.',
    ].join(' ');

    // dry_run: return the computed snapshot without writing anything
    if (body.dry_run) {
      return Response.json({
        ok: true,
        dry_run: true,
        month,
        total_rows: monthRows.length,
        line_count: lines.length,
        total_labor: totalLabor,
        earned_total: earnedTotal,
        earned_line_count: earnedRows.length,
        invoiced_subtotal: invoicedSubtotal,
        invoiced_line_count: invoicedRows.length,
        superseded_count: supersededSet.size,
        population_definition: POPULATION_DEFINITION,
      });
    }

    const snapshot = await base44.asServiceRole.entities.MonthCloseSnapshot.create({
      month,
      closed_at: new Date().toISOString(),
      closed_by: user.email || user.id,
      population_definition: POPULATION_DEFINITION,
      total_rows: monthRows.length,
      total_labor: totalLabor,
      earned_total: earnedTotal,
      earned_line_count: earnedRows.length,
      invoiced_subtotal: invoicedSubtotal,
      invoiced_line_count: invoicedRows.length,
      line_count: lines.length,
      lines,
    });

    return Response.json({
      ok: true,
      month,
      closed_at: snapshot.closed_at,
      closed_by: snapshot.closed_by,
      total_rows: snapshot.total_rows,
      line_count: snapshot.line_count,
      total_labor: snapshot.total_labor,
      earned_total: snapshot.earned_total,
      earned_line_count: snapshot.earned_line_count,
      invoiced_subtotal: snapshot.invoiced_subtotal,
      invoiced_line_count: snapshot.invoiced_line_count,
      superseded_count: supersededSet.size,
      prior_snapshot_replaced: !!prior,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}