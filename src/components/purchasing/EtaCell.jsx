import { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import DotText from './DotText';
import { pickDisplayBudget } from '@/lib/purchasingViewModel';
import { isLiveBudget } from '@/lib/purchasingCoreTwin';
import { displayDate } from '@/lib/purchasingDates';
import { purchasingRequest, messageOf } from '@/components/budgets/ProcurementForms';
import { syncEtaCalendar, CALENDAR_MISSED } from '@/lib/etaCalendar';

// The ETA cell: clicking it picks a date in place - no form to fill in.
//   - A job with ONE pending supplier confirmation keeps its ETA on that order
//     (save_supplier_order), so the supplier record stays the source of truth.
//   - A job with no supplier confirmation yet keeps its glass ETA on the budget
//     the money tiles read from (glass_eta_date, source 'manual').
// Anything else (several confirmations, a missing order number, material already
// received) is written in the Money workspace, so the cell opens that instead.
const LINE = '#E2E8F0';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function EtaCell({ job, data, etaLabel, onSaved, onOpenSupplier }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // showPicker() is refused inside the preview's cross-origin iframe (SecurityError).
  // When that happens, swap the label for a real date field: tapping it opens the
  // browser's own calendar, which is allowed in a frame.
  const [manual, setManual] = useState(false);
  const inputRef = useRef(null);

  // Reference-only rows (PO-reconciliation placeholders with no supplier order
  // number) are not real orders: they never get a picker or block one.
  const orders = (data?.vendor_orders || []).filter((o) => o.job_id === job.id && o.order_number &&
    !(o.purchase_order_id && (data?.purchase_orders || []).some((po) => po.id === o.purchase_order_id && po.status === 'cancelled')));
  const pending = orders.filter((o) => !o.received_date);
  const order = pending.length === 1 && pending[0].order_number && pending[0].amount != null ? pending[0] : null;
  const budget = !orders.length
    ? pickDisplayBudget((data?.budgets || []).filter((b) => b.job_id === job.id && isLiveBudget(b)))
    : null;
  const target = order || budget;
  const date = order ? order.eta_date || '' : budget?.glass_eta_date || '';

  async function save(value) {
    if (busy || !target) return;
    setBusy(true); setError('');
    try {
      if (order) {
        await purchasingRequest({ action: 'save_supplier_order', order_id: order.id, job_id: job.id,
          purchase_order_id: order.purchase_order_id, order_number: order.order_number,
          amount: order.amount, eta_date: value || '', received_date: order.received_date || '',
          notes: order.notes || '', expected_updated_date: order.updated_date,
          request_key: crypto.randomUUID(), review_confirmed: true });
      } else {
        const response = await base44.functions.invoke('jobBudgetIngest', { action: 'set_glass_eta', budget_id: budget.id, eta_date: value, source: 'manual' });
        const body = response?.data ?? response;
        if (body?.error) throw new Error(body.error);
      }
      // The ETA on Israel's Google Calendar is the same ETA: it is created here
      // and moved here, never duplicated, and removed when the ETA is cleared.
      const sync = await syncEtaCalendar({
        jobId: job.id, etaKey: order ? `order:${order.id}` : `budget:${budget.id}`, date: value || '',
        ref: order?.order_number || '', vendor: order?.vendor || '',
      });
      if (sync.error) setError(CALENDAR_MISSED);
      await onSaved?.();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  function openPicker() {
    const el = inputRef.current;
    if (!el) return;
    try {
      if (!el.showPicker) throw new Error('unsupported');
      el.showPicker();
    } catch { setManual(true); }
  }

  if (!target) {
    return (
      <button type="button" onClick={onOpenSupplier}
        title={etaLabel ? "Open this job's supplier dates" : 'Record the supplier ETA for this job'}
        className="cursor-pointer rounded-md px-1 py-0.5 hover:bg-stone-100">
        <DotText tone={etaLabel ? 'blue' : 'gray'}>{ISO_DAY.test(etaLabel || '') ? displayDate(etaLabel) : etaLabel}</DotText>
      </button>
    );
  }

  return (
    <div className="relative flex flex-col items-center gap-1">
      {manual ? (
        <input type="date" aria-label="Supplier ETA" disabled={busy}
          value={date}
          onChange={(e) => save(e.target.value)}
          className="w-full rounded-md border px-1 py-1 text-[11.5px] font-semibold"
          style={{ borderColor: LINE, color: '#101617', backgroundColor: '#FFFFFF' }} />
      ) : (
        <button type="button" disabled={busy} title="Pick the supplier ETA" onClick={openPicker}
          className="cursor-pointer rounded-md px-1 py-0.5 hover:bg-stone-100">
          <DotText tone="blue">{date ? displayDate(date) : 'Set ETA'}</DotText>
        </button>
      )}
      <input ref={inputRef} type="date" aria-label="Supplier ETA" tabIndex={-1}
        value={date}
        onChange={(e) => save(e.target.value)}
        style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      {error && <span className="text-[10px] font-semibold" style={{ color: '#A43432' }}>{error}</span>}
    </div>
  );
}