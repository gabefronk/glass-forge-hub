import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { fetchAllPages } from '../../shared/pagination.ts';

// Immutable month-close snapshot. Captures every FeeLine included in the
// month's totals at the moment the admin marks the month closed, so a later
// re-ingest can never make a previously invoiced month unverifiable.
//
// Stores line ids, amounts, fees, and totals. Once written, the snapshot is
// never modified — re-closing requires force=true and creates a NEW record
// (the old one remains as history).
//
// Params:
//   month  — YYYY-MM (required)
//   force  — when true, creates a new snapshot even if one already exists
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
        total_fee: prior.total_fee,
        line_count: prior.line_count,
      }, { status: 200 });
    }

    // Build the snapshot from current FeeLines
    const allFees = await fetchAllPages(base44.asServiceRole.entities.FeeLines, '-created_date', 5000);
    const monthRows = allFees.filter((f) => f.invoice_month === month);

    // Superseded set: rows that are excluded from totals
    const supersededIds = new Set();
    for (const f of monthRows) {
      if (f.superseded_by) supersededIds.add(f.id);
    }

    // Included rows: non-superseded, billable, non-future, labor > 0 or profit_split
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const included = monthRows.filter((f) => {
      if (supersededIds.has(f.id)) return false;
      if (!f.billable) return false;
      if (f.job_date && f.job_date > todayStr) return false;
      return Number(f.labor_amt) > 0 || f.fee_type === 'profit_split';
    });

    const lines = included.map((f) => ({
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
    }));

    const totalLabor = lines.reduce((s, l) => s + l.labor_amt, 0);
    const totalFee = Math.round(lines.reduce((s, l) => s + l.fee_amt, 0) * 100) / 100;

    const snapshot = await base44.asServiceRole.entities.MonthCloseSnapshot.create({
      month,
      closed_at: new Date().toISOString(),
      closed_by: user.email || user.id,
      total_labor: Math.round(totalLabor * 100) / 100,
      total_fee: totalFee,
      line_count: lines.length,
      lines,
    });

    return Response.json({
      ok: true,
      month,
      closed_at: snapshot.closed_at,
      closed_by: snapshot.closed_by,
      total_labor: snapshot.total_labor,
      total_fee: snapshot.total_fee,
      line_count: snapshot.line_count,
      superseded_count: supersededIds.size,
      prior_snapshot_replaced: !!prior,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}