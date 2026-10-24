import { useRef, useState } from 'react';
import DotText from './DotText';
import { pickDisplayBudget } from '@/lib/purchasingViewModel';
import { isLiveBudget } from '@/lib/purchasingCoreTwin';
import { displayDate, etaDistance } from '@/lib/purchasingDates';
import { saveEtaTarget } from '@/lib/etaTarget';
import { etaDate } from '@/lib/purchasingSummary';

// The ETA cell: clicking it picks a date in place - no form to fill in.
//   - A job with ONE pending supplier confirmation keeps its ETA on that order
//     (save_supplier_order), so the supplier record stays the source of truth.
//   - A job with no supplier confirmation yet keeps its glass ETA on the budget
//     the money tiles read from (glass_eta_date, source 'manual').
// Anything else (several confirmations, a missing order number, material already
// received) is written in the Money workspace, so the cell opens that instead.
// A scope row passes its own etaTarget (its budget or its one pending order) and
// no `data`, so the cell never falls back to the job's aggregate records.
const LINE = '#D6CCBA';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const denverToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// The date plus how far away it is: "11/9/2026 · 17d", or "· 23d late" in red.
function EtaText({ date }) {
  const d = etaDistance(date, denverToday());
  return <>{displayDate(date)}{d ? <span className="ml-1 font-bold" style={{ color: d.late ? '#A43432' : '#4A5652' }}>· {d.text}</span> : null}</>;
}

// Compact grid form (Gabriel, Oct 24): just the date, "10/13/26" - no countdown, no late flag.
function EtaWords({ label, empty = '—' }) {
  const text = etaDate(label);
  return <span className="whitespace-nowrap text-[14px]" style={{ color: text ? '#101617' : '#566063', fontWeight: 500 }}>{text || empty}</span>;
}

function jobEtaTarget(job, data) {
  // Reference-only rows (PO-reconciliation placeholders with no supplier order
  // number) are not real orders: they never get a picker or block one.
  const orders = (data?.vendor_orders || []).filter((o) => o.job_id === job.id && o.order_number &&
    !(o.purchase_order_id && (data?.purchase_orders || []).some((po) => po.id === o.purchase_order_id && po.status === 'cancelled')));
  const pending = orders.filter((o) => !o.received_date);
  const order = pending.length === 1 && pending[0].order_number && pending[0].amount != null ? pending[0] : null;
  if (order) return { order, date: order.eta_date || '' };
  if (orders.length) return null;
  const budget = pickDisplayBudget((data?.budgets || []).filter((b) => b.job_id === job.id && isLiveBudget(b)));
  return budget ? { budgetId: budget.id, date: budget.glass_eta_date || '' } : null;
}

export default function EtaCell({ job, data, etaLabel, onSaved, onOpenSupplier, etaTarget, compact = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // showPicker() is refused inside the preview's cross-origin iframe (SecurityError).
  // When that happens, swap the label for a real date field: tapping it opens the
  // browser's own calendar, which is allowed in a frame.
  const [manual, setManual] = useState(false);
  const inputRef = useRef(null);

  const target = etaTarget ?? jobEtaTarget(job, data);
  const date = target?.date || '';

  async function save(value) {
    if (busy || !target) return;
    setBusy(true); setError('');
    try {
      // The ETA on Israel's Google Calendar is the same ETA: it is created here
      // and moved here, never duplicated, and removed when the ETA is cleared.
      const result = await saveEtaTarget({ jobId: job.id, order: target.order || null, budgetId: target.budgetId || '', date: value });
      if (result.error) setError(result.error);
      if (result.saved) await onSaved?.();
    } finally { setBusy(false); }
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
        {compact ? <EtaWords label={etaLabel} /> : <DotText tone={etaLabel ? 'blue' : 'gray'}>{ISO_DAY.test(etaLabel || '') ? <EtaText date={etaLabel} /> : etaLabel}</DotText>}
      </button>
    );
  }

  return (
    <div className={`relative flex flex-col gap-1 ${compact ? 'items-start' : 'items-center'}`}>
      {manual ? (
        <input type="date" aria-label="Supplier ETA" disabled={busy}
          value={date}
          onChange={(e) => save(e.target.value)}
          className="w-full rounded-md border px-1 py-1 text-[11.5px] font-semibold"
          style={{ borderColor: LINE, color: '#101617', backgroundColor: '#FFFFFF' }} />
      ) : (
        <button type="button" disabled={busy} title="Pick the supplier ETA" onClick={openPicker}
          className="cursor-pointer rounded-md px-1 py-0.5 hover:bg-stone-100">
          {compact ? <EtaWords label={date} empty="Set ETA" /> : date ? <DotText tone="blue"><EtaText date={date} /></DotText> : <span className="rounded-md px-1.5 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: '#F3EEE4', color: '#4A5652', border: `1px dashed ${LINE}` }}>Set ETA</span>}
        </button>
      )}
      <input ref={inputRef} type="date" aria-label="Supplier ETA" tabIndex={-1}
        value={date}
        onChange={(e) => save(e.target.value)}
        style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      {error && <span className="text-[13px] font-semibold" style={{ color: '#A43432' }}>{error}</span>}
    </div>
  );
}