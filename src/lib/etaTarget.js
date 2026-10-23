import { base44 } from '@/api/base44Client';
import { purchasingRequest, messageOf } from '@/components/budgets/ProcurementForms';
import { syncEtaCalendar, CALENDAR_MISSED } from '@/lib/etaCalendar';

// One supplier ETA write. The board's job row and every extra scope row go
// through here, so the date always lands on the real record — the supplier
// order, or the budget when nothing is on order — and the matching event on
// Israel's calendar is created or moved to the same day.
//
// Returns { saved, error }: saved is true once the Hub accepted the ETA, even
// when only the calendar leg failed (the caller then offers a retry by saving
// the ETA again). A write that never landed returns saved false with the reason.
export async function saveEtaTarget({ jobId, order = null, budgetId = '', date = '' }) {
  try {
    if (order?.id) {
      await purchasingRequest({
        action: 'save_supplier_order', order_id: order.id, job_id: jobId,
        purchase_order_id: order.purchase_order_id, order_number: order.order_number,
        amount: order.amount, eta_date: date || '', received_date: order.received_date || '',
        notes: order.notes || '', expected_updated_date: order.updated_date,
        request_key: crypto.randomUUID(), review_confirmed: true,
      });
    } else if (budgetId) {
      const response = await base44.functions.invoke('jobBudgetIngest', { action: 'set_glass_eta', budget_id: budgetId, eta_date: date, source: 'manual' });
      const body = response?.data ?? response;
      if (body?.error) throw new Error(body.error);
    } else {
      return { saved: false, error: 'missing_eta_target' };
    }
  } catch (error) {
    return { saved: false, error: messageOf(error) };
  }
  const sync = await syncEtaCalendar({
    jobId,
    etaKey: order?.id ? `order:${order.id}` : `budget:${budgetId}`,
    date: date || '',
    ref: order?.order_number || '',
    vendor: order?.vendor || '',
  });
  return { saved: true, error: sync.error ? CALENDAR_MISSED : '' };
}