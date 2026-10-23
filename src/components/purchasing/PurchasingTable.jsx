import { useState, Fragment } from 'react';
import { ChevronDown } from 'lucide-react';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import PurchasingRowTitle from './PurchasingRowTitle';
import DotText from './DotText';
import EtaCell from './EtaCell';
import QuoteCell from './QuoteCell';
import { ScopeTableRows, ScopeMobileBlocks } from './ScopeRow';
import { refTone } from './PurchasingCard';
import { MoneyCell, MoneyStat, FieldRow, ACCENT, LINE, HEAD } from './PurchasingCells';
import { PAYMENT_STAGES, PAYMENT_TONES, paymentPatch, paymentStage } from '@/lib/jobPayment';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';

// Spreadsheet-style purchasing table - one row of figures per job, with the
// job name on its own line directly above (10/22 layout pass per Gabriel).
// No status column, no review tags or sublabels under the money; the quote
// cell reads "Supplier - quote #"; the PO cell is just the YA number. Fits
// the page width - no horizontal scroll. Money stays big, charcoal, tabular.
//
// 10/22 mobile pass: below 700px the nine-column table collapses into a
// stacked card (money as a 2x2 stat grid, then labeled Quote / YA PO / ETA
// rows, then the payment dropdown). The desktop table is untouched and still
// renders at >=700px. One expanded Money workspace serves both layouts.
const HEADERS = ['Windows incl tax', 'Labor & material', 'Sale price', 'Profit', 'Quote', 'YA PO', 'ETA', 'Payments', 'Actions'];

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

// Customer payment stage dropdown - shared by the desktop table cell and the
// mobile card so both write the same Jobs.payment_status patch.
function PaymentSelect({ payKey, busy, onChange }) {
  const payTone = PAYMENT_TONES[payKey] || PAYMENT_TONES.none;
  const payLabel = paymentStage(payKey)?.label || 'Not tracked';
  return (
    <Select disabled={busy} value={payKey} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
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
  const payKey = fullJob?.payment_status || 'none';
  const toggle = () => setExpanded((e) => { if (!e) setSection('budgets'); return !e; });
  // When the ETA cannot be written straight from the cell, clicking it opens the
  // row's supplier section instead of doing nothing.
  const openSupplierSection = () => { setExpanded(true); setSection('tracking'); };
  // A job with more than one scope (a second budget, a reorder PO, a supplier
  // confirmation with no PO) lists each scope on its own row under this one, so
  // a second order keeps its own quote, PO, ETA and supplier payment. One scope
  // renders exactly the row above and nothing more.
  const multiScope = (card.scopes || []).length > 1;

  return (
    <Fragment>
      <div className="px-4 pb-1.5 pt-2.5" style={{ backgroundColor: '#E6F1ED', borderBottom: '1px solid #8FB9AF' }}>
        <PurchasingRowTitle job={job} onSaved={onSaved} />
      </div>
      <div className="max-[699px]:hidden">
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
              <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}><QuoteCell card={card} onSaved={onSaved} /></td>
              <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}><DotText tone={refTone(refs.poStatus) || 'gray'}>{refs.yaPo}</DotText></td>
              <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}>
                <EtaCell job={job} data={data} etaLabel={refs.etaLabel} onSaved={onSaved} onOpenSupplier={openSupplierSection} />
              </td>
              <td className="px-2.5 py-2 align-top" style={{ borderLeft: `1px solid ${LINE}` }}>
                <div className="flex flex-col items-start gap-1">
                  <PaymentSelect payKey={payKey} busy={busy} onChange={(v) => savePayment(v)} />
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
            {multiScope && <ScopeTableRows scopes={card.scopes} job={job} onSaved={onSaved} onOpenTracking={openSupplierSection} />}
          </tbody>
        </table>
      </div>
      <div className="px-4 pb-3 pt-1 min-[700px]:hidden" style={{ backgroundColor: rowBg }}>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px]" style={{ backgroundColor: LINE, border: `1px solid ${LINE}` }}>
          <MoneyStat label="Windows incl tax" display={windows.display} accent={ACCENT.windows} />
          <MoneyStat label="Labor & material" display={rough.display} accent={ACCENT.rough} />
          <MoneyStat label="Sale price" display={sale.display} accent={ACCENT.sale} />
          <MoneyStat label="Profit" display={profitDisplay} accent={ACCENT.profit} tone={profitDisplay?.tone} />
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          <FieldRow label="Quote"><QuoteCell card={card} onSaved={onSaved} /></FieldRow>
          <FieldRow label="YA PO"><DotText tone={refTone(refs.poStatus) || 'gray'}>{refs.yaPo}</DotText></FieldRow>
          <FieldRow label="ETA">
            <EtaCell job={job} data={data} etaLabel={refs.etaLabel} onSaved={onSaved} onOpenSupplier={openSupplierSection} />
          </FieldRow>
        </div>
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.07em]" style={{ color: HEAD }}>Payments</div>
          <PaymentSelect payKey={payKey} busy={busy} onChange={(v) => savePayment(v)} />
          {payError && <div className="mt-1 text-[10px] font-semibold" style={{ color: '#A43432' }}>{payError}</div>}
        </div>
        {multiScope && <ScopeMobileBlocks scopes={card.scopes} job={job} onSaved={onSaved} onOpenTracking={openSupplierSection} />}
        <div className="mt-1 flex justify-end">
          <button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={`purchasing-row-${job.id}`}
            className="inline-flex min-h-[44px] items-center gap-1 text-[12px] font-medium underline" style={{ color: '#8A8F93' }}>
            Money<ChevronDown className="h-3.5 w-3.5" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
          </button>
        </div>
      </div>
      {expanded && fullJob && data && (
        <div id={`purchasing-row-${job.id}`} className="px-3 py-3" style={{ backgroundColor: rowBg, borderTop: `1px solid ${LINE}` }}>
          <div className="mb-2 flex justify-end">
            <button type="button" onClick={onEdit} className="text-[11.5px] font-medium underline" style={{ color: '#8A8F93' }}>Edit money</button>
          </div>
          <PurchasingJobWorkspace job={fullJob} data={data} section={section} onSection={setSection} onSaved={onSaved} />
        </div>
      )}
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