import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { fetchAllPages } from '../../shared/pagination.ts';

// Issue a YA Windows and Doors purchase order number.
//   1. Scan every existing PurchaseOrders po_number, take the highest YA-#### suffix, +1,
//      zero-padded to 4 (YA-0001 when none exist). Existing POs are never reused or renumbered;
//      cancelled POs keep their number.
//   2. Create the PurchaseOrders row (status defaults to issued).
//   3. When job_id is given, append the new number to that Jobs record's po_numbers
//      (read-modify-write, existing entries preserved). oe_numbers is never touched.
// Optional guard: pass po_number to assert the number you expect to be issued; a mismatch
// returns po_number_mismatch and creates nothing.
// Returns the created PurchaseOrders row.

const PREFIX = 'YA-';
const STATUSES = ['issued', 'emailed', 'ordered', 'confirmed', 'received', 'cancelled'];
const TEXT_FIELDS = ['job_name', 'builder', 'customer_name', 'vendor', 'vendor_quote_ref', 'order_email_ref', 'notes'];

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

function toAmount(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function nextPoNumber(rows) {
  let max = 0;
  for (const r of rows || []) {
    const m = /^YA-(\d+)$/i.exec(clean(r?.po_number));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return PREFIX + String(max + 1).padStart(4, '0');
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const api = base44.asServiceRole.entities;

    const status = clean(body.status) || 'issued';
    if (!STATUSES.includes(status)) return Response.json({ error: 'invalid_status', status }, { status: 200 });

    const amount_dealer = toAmount(body.amount_dealer);
    const amount_customer = toAmount(body.amount_customer);
    if (Number.isNaN(amount_dealer) || Number.isNaN(amount_customer)) {
      return Response.json({ error: 'invalid_amount' }, { status: 200 });
    }

    const jobId = clean(body.job_id);
    let job = null;
    if (jobId) {
      job = await api.Jobs.get(jobId).catch(() => null);
      if (!job) return Response.json({ error: 'job_not_found', job_id: jobId }, { status: 200 });
    }

    const existing = await fetchAllPages(api.PurchaseOrders, 'created_date');
    const po_number = nextPoNumber(existing);
    const expected = clean(body.po_number).toUpperCase();
    if (expected && expected !== po_number) {
      return Response.json({ error: 'po_number_mismatch', expected, next: po_number }, { status: 200 });
    }

    const row = { po_number, status, created_by_email: user.email || '' };
    for (const f of TEXT_FIELDS) {
      const v = clean(body[f]);
      if (v) row[f] = v;
    }
    if (jobId) {
      row.job_id = jobId;
      if (!row.job_name && job.canonical_name) row.job_name = job.canonical_name;
      if (!row.builder && job.builder) row.builder = job.builder;
      if (!row.customer_name && job.customer_name) row.customer_name = job.customer_name;
    }
    if (amount_dealer !== undefined) row.amount_dealer = amount_dealer;
    if (amount_customer !== undefined) row.amount_customer = amount_customer;

    const created = await api.PurchaseOrders.create(row);

    let job_update = null;
    if (jobId) {
      // Re-read right before writing so a concurrent edit to the job's PO list is not lost.
      const fresh = (await api.Jobs.get(jobId).catch(() => null)) || job;
      const current = Array.isArray(fresh.po_numbers) ? fresh.po_numbers : [];
      if (current.includes(po_number)) {
        job_update = { ok: true, already_present: true };
      } else {
        try {
          await api.Jobs.update(jobId, { po_numbers: [...current, po_number] });
          job_update = { ok: true };
        } catch (e) {
          // The PO exists either way; surface the link failure instead of hiding it.
          job_update = { ok: false, error: String(e?.message || e) };
        }
      }
    }

    return Response.json({ ...created, job_update });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
