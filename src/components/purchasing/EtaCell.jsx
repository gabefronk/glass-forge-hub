import { useState } from 'react';
import DotText from './DotText';
import EtaEditor from './EtaEditor';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { pickDisplayBudget } from '@/lib/purchasingViewModel';
import { isLiveBudget } from '@/lib/purchasingCoreTwin';
import { displayDate, etaDistance } from '@/lib/purchasingDates';
import { etaDate } from '@/lib/purchasingSummary';

// The ETA cell: clicking it opens the ETA editor in place - the date, whose
// calendar it goes on (Israel / Milan / both) and, on a supplier order, delivered
// or will call (EtaEditor; Gabriel, Oct 30).
//   - A job with ONE pending supplier confirmation keeps its ETA on that order
//     (save_supplier_order), so the supplier record stays the source of truth.
//   - A job with no supplier confirmation yet keeps its glass ETA on the budget
//     the money tiles read from (glass_eta_date, source 'manual').
// Anything else (several confirmations, a missing order number, material already
// received) is written in the Money workspace, so the cell opens that instead.
// A scope row passes its own etaTarget (its budget or its one pending order) and
// no `data`, so the cell never falls back to the job's aggregate records.
const LINE = '#D6CCBA';
const EDGE = '#E2DCD1';
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
  const [open, setOpen] = useState(false);

  const target = etaTarget ?? jobEtaTarget(job, data);
  const date = target?.date || '';

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
    <div className={`flex flex-col gap-1 ${compact ? 'items-start' : 'items-center'}`}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" title="Set the supplier ETA and its calendar"
            className="cursor-pointer rounded-md px-1 py-0.5 hover:bg-stone-100">
            {compact ? <EtaWords label={date} empty="Set ETA" /> : date ? <DotText tone="blue"><EtaText date={date} /></DotText> : <span className="rounded-md px-1.5 py-0.5 text-[13px] font-semibold" style={{ backgroundColor: '#F3EEE4', color: '#4A5652', border: `1px dashed ${LINE}` }}>Set ETA</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[280px] rounded-[12px] bg-white p-3" style={{ borderColor: EDGE }}>
          {open ? (
            <EtaEditor jobId={job.id} order={target.order || null} budgetId={target.budgetId || ''} date={date}
              onSaved={onSaved} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}