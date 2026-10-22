import { useState, Fragment } from 'react';
import { ChevronDown } from 'lucide-react';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import PurchasingRowTitle from './PurchasingRowTitle';
import DotText from './DotText';
import EtaCell from './EtaCell';
import { refTone } from './PurchasingCard';
import { money } from '@/components/budgets/ProcurementForms';
import { PAYMENT_STAGES, PAYMENT_TONES, paymentPatch, paymentStage } from '@/lib/jobPayment';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';

// Spreadsheet-style purchasing table - one row of figures per job, with the
// job name on its own line directly above (10/22 layout pass per Gabriel).
// No status column, no review tags or sublabels under the money; the quote
// cell reads "Supplier - quote #"; the PO cell is just the YA number. Fits
// the page width - no horizontal scroll. Money stays big, charcoal, tabular.
const ACCENT = { windows: '#3977CB', rough: '#7862B2', sale: '#248B88', profit: '#238557' };
const INK = '#101617', LINE = '#E2E8F0', HEAD = '#0B3F3B';

const HEADERS = ['Windows incl tax', 'Labor & material', 'Sale price', 'Profit', 'Quote', 'YA PO', 'ETA', 'Payments', 'Actions'];

function MoneyCell({ display, accent, tone, divider }) {
  const negative = tone === 'negative';
  return (
    <td className="px-2 py-2 text-center align-top" style={{ borderTop: `2px solid ${negative ? '#A43432' : accent}`, borderLeft: divider ? undefined : `1px solid ${LINE}`, backgroundColor: negative ? '#FDE8E7' : undefined }}>
      <div className="text-[15px] font-extrabold tabular-nums" style={{ color: INK, letterSpacing: '-0.01em' }}>{money(display?.value)}</div>
    </td>
  );
}

// One row of the payment dropdown: tinted + dotted along the red → green ramp so
// the list reads as a scale at a glance.
function StageItem({ value, label }) {
  const t = PAYMENT_TONES[value] || PAYMENT_TONES.none;
  return (
    <SelectItem value={value} className="text-[12px] font-semibold" style={{ backgroundColor: t.bg, color: t.text }}>
      <span className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.dot }} />
      {label}
    </SelectItem>
  );
}

function Row({ card, data, onEdit, onSaved, zebra }) {
  const { job, windows, rough, sale, profitDisplay, refs, supplier } = card;
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState('budgets');
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const fullJob = data?.jobs?.find((j) => j.id === job.id) || job;
  // Customer payment stage on the Jobs entity - the same one-tap stages the
  // job page uses. Records a fact only; never sends anything to QuickBooks.
  async function savePayment(key) {
    if (busy) return;
    setBusy(true); setPayError('');
    try {
      const patch = key ? paymentPatch(fullJob, key) : { payment_status: null, payment_status_at: null };
      await base44.entities.Jobs.update(job.id, patch);
      await onSaved?.();
    } catch (e) { setPayError(messageOf(e)); } finally { setBusy(false); }
  }
  const rowBg = zebra ? '#F8FAFC' : '#FFFFFF';
  const quoteText = refs.quoteNumber ? [card.brand, refs.quoteNumber].filter(Boolean).join(' - ') : null;
  const payKey = fullJob?.payment_status || 'none';
  const payTone = PAYMENT_TONES[payKey] || PAYMENT_TONES.none;
  const payLabel = paymentStage(payKey)?.label || 'Not tracked';
  const toggle = () => setExpanded((e) => { if (!e) setSection('budgets'); return !e; });
  // When the ETA cannot be written straight from the cell, clicking it opens the
  // row's supplier section instead of doing nothing.
  const openSupplierSection = () => { setExpanded(true); setSection('tracking'); };

  return (
    <Fragment>
      <div className="px-4 pb-0.5 pt-3" style={{ backgroundColor: rowBg }}>
        <PurchasingRowTitle job={job} onSaved={onSaved} />
      </div>
      <table className="w-full border-collapse text-left" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} />
          <col style={{ width: '13%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '11%' }} /><col style={{ width: '6%' }} />
        </colgroup>
        <thead>
          <tr style={{ backgroundColor: '#F1F5F4' }}>
            {HEADERS.map((h, hi) => (
              <th key={h} className="px-2 py-2 text-center text-[10.5px] font-bold uppercase tracking-[0.07em]" style={{ color: HEAD, backgroundColor: '#F1F5F4', borderLeft: hi === 0 ? undefined : `1px solid ${LINE}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
      <tr style={{ backgroundColor: rowBg }}>
        <MoneyCell display={windows.display} accent={ACCENT.windows} divider />
        <MoneyCell display={rough.display} accent={ACCENT.rough} />
        <MoneyCell display={sale.display} accent={ACCENT.sale} />
        <MoneyCell display={profitDisplay} accent={ACCENT.profit} tone={profitDisplay?.tone} />
        <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}><DotText tone={refTone(refs.quoteStatus) || 'gray'}>{quoteText}</DotText></td>
        <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}><DotText tone={refTone(refs.poStatus) || 'gray'}>{refs.yaPo}</DotText></td>
        <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}>
          <EtaCell job={job} data={data} etaLabel={refs.etaLabel} onSaved={onSaved} onOpenSupplier={openSupplierSection} />
        </td>
        <td className="px-2.5 py-2 align-top" style={{ borderLeft: `1px solid ${LINE}` }}>
          <div className="flex flex-col items-start gap-1">
            <Select disabled={busy} value={payKey} onValueChange={(v) => savePayment(v === 'none' ? '' : v)}>
              <SelectTrigger aria-label="Customer payment status"
                className="h-auto w-full gap-1 rounded-md border px-1.5 py-1 text-[11px] font-semibold shadow-none"
                style={{ borderColor: payTone.border, color: payTone.text, backgroundColor: payTone.bg }}>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: payTone.dot }} />
                  <span className="truncate">{payLabel}</span>
                </span>
              </SelectTrigger>
              <SelectContent className="min-w-[15rem]">
                <StageItem value="none" label="Not tracked" />
                {PAYMENT_STAGES.map((st) => <StageItem key={st.key} value={st.key} label={st.label} />)}
              </SelectContent>
            </Select>
            {payError && <span className="text-[10px] font-semibold" style={{ color: '#A43432' }}>{payError}</span>}
          </div>
        </td>
        <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}>
          <button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={`purchasing-row-${job.id}`}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium underline" style={{ color: '#8A8F93' }}>
            Money<ChevronDown className="h-3.5 w-3.5" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
          </button>
        </td>
      </tr>
      {expanded && fullJob && data && (
        <tr id={`purchasing-row-${job.id}`} style={{ backgroundColor: rowBg, borderTop: `1px solid ${LINE}` }}>
          <td colSpan={HEADERS.length} className="px-3 py-3">
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={onEdit} className="text-[11.5px] font-medium underline" style={{ color: '#8A8F93' }}>Edit money</button>
            </div>
            <PurchasingJobWorkspace job={fullJob} data={data} section={section} onSection={setSection} onSaved={onSaved} />
          </td>
        </tr>
      )}
        </tbody>
      </table>
    </Fragment>
  );
}

export default function PurchasingTable({ cards, data, onEdit, onSaved }) {
  return (
    <div className="flex flex-col gap-4">
      {cards.map((card, i) => (
        <div key={card.job.id} className="overflow-hidden rounded-[16px] bg-white" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(10,29,31,.05)' }}>
          <Row card={card} data={data} zebra={i % 2 === 1} onEdit={() => onEdit(card)} onSaved={onSaved} />
        </div>
      ))}
    </div>
  );
}