import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import PurchasingRowTitle, { rowTitle } from './PurchasingRowTitle';
import DotText from './DotText';
import EtaCell from './EtaCell';
import QuoteCell from './QuoteCell';
import { ScopeTableRows, ScopeMobileBlocks } from './ScopeRow';
import { refTone } from './PurchasingCard';
import { MoneyCell, MoneyStat, FieldRow, ACCENT, LINE, HEAD, SHEET_EDGE, HEAD_BG, HEAD_RULE, INK, CAPTION } from './PurchasingCells';
import { money } from '@/components/budgets/ProcurementForms';
import { summarizeCards } from '@/lib/purchasingSummary';
import { displayDate, etaDistance } from '@/lib/purchasingDates';
import { PAYMENT_STAGES, PAYMENT_TONES, paymentPatch, paymentStage } from '@/lib/jobPayment';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';

// Spreadsheet-style purchasing grid (density pass, Oct 24): ONE table with one
// sticky header for every job, instead of a card and a repeated header per job.
// Each job is a group of rows: its name band (the builder - job title Gabriel
// asked for on 10/22), its figures, any scope rows, and the Money workspace when
// expanded. Money is right-aligned so decimals line up; warm rules separate rows.
// The per-figure caption carries the cost source and tax basis.
//
// Below 700px each job is one compact row (M7, Oct 24, about 100-130px): title,
// sale and profit, then three status markers (ETA, customer payment, supplier
// payment). Tapping it opens the job's details and Money workspace full width.
const COLUMNS = [
  { label: 'Windows', width: '13%', accent: ACCENT.windows, money: true },
  { label: 'Labor & material', width: '12%', accent: ACCENT.rough, money: true },
  { label: 'Sale price', width: '12%', accent: ACCENT.sale, money: true },
  { label: 'Profit', width: '11%', accent: ACCENT.profit, money: true },
  { label: 'Quote', width: '13%' },
  { label: 'YA PO', width: '9%' },
  { label: 'ETA', width: '11%' },
  { label: 'Payments', width: '13%' },
  { label: '', width: '6%' },
];
const MONEY_LINK = '#0B3F3B';

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
// mobile card so both write the same Jobs.payment_status patch. The label wraps
// instead of being cut off.
function PaymentSelect({ payKey, busy, onChange }) {
  const payTone = PAYMENT_TONES[payKey] || PAYMENT_TONES.none;
  const payLabel = paymentStage(payKey)?.label || 'Not tracked';
  return (
    <Select disabled={busy} value={payKey} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
      <SelectTrigger aria-label="Customer payment status"
        className="h-auto w-full gap-1 rounded-md border px-1.5 py-1 text-left text-[11px] font-semibold leading-tight shadow-none"
        style={{ borderColor: payTone.border, color: payTone.text, backgroundColor: payTone.bg }}>
        <span className="flex min-w-0 flex-1 items-start gap-1.5">
          <span className="mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: payTone.dot }} />
          <span className="whitespace-normal break-words">{payLabel}</span>
        </span>
      </SelectTrigger>
      <SelectContent className="min-w-[15rem]">
        <StageItem value="none" label="Not tracked" />
        {PAYMENT_STAGES.map((st) => <StageItem key={st.key} value={st.key} label={st.label} />)}
      </SelectContent>
    </Select>
  );
}

// Row state shared by the desktop rows and the mobile card of one job.
function useJobRow(card, data, onSaved) {
  const { job } = card;
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
  return {
    fullJob, expanded, section, setSection, busy, payError, savePayment,
    payKey: fullJob?.payment_status || 'none',
    toggle: () => setExpanded((e) => { if (!e) setSection('budgets'); return !e; }),
    // When the ETA cannot be written straight from the cell, clicking it opens
    // the row's supplier section instead of doing nothing.
    openSupplierSection: () => { setExpanded(true); setSection('tracking'); },
    // A job with more than one scope (a second budget, a reorder PO, a supplier
    // confirmation with no PO) lists each scope on its own row under this one.
    multiScope: (card.scopes || []).length > 1,
  };
}

function MoneyToggle({ row, jobId, className = '' }) {
  return (
    <button type="button" onClick={row.toggle} aria-expanded={row.expanded} aria-controls={`purchasing-row-${jobId}`}
      className={`inline-flex items-center gap-1 text-[11.5px] font-semibold underline ${className}`} style={{ color: MONEY_LINK }}>
      Money<ChevronDown className="h-3.5 w-3.5" style={{ transform: row.expanded ? 'rotate(180deg)' : 'none' }} />
    </button>
  );
}

function Workspace({ row, data, onEdit, onSaved, jobId }) {
  return (
    <div id={`purchasing-row-${jobId}`}>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={onEdit} className="text-[11.5px] font-semibold underline" style={{ color: MONEY_LINK }}>Edit money</button>
      </div>
      <PurchasingJobWorkspace job={row.fullJob} data={data} section={row.section} onSection={row.setSection} onSaved={onSaved} />
    </div>
  );
}

// Desktop: one <tbody> per job inside the shared table.
function JobRows({ card, data, onEdit, onSaved }) {
  const { job, windows, rough, sale, profitDisplay, refs } = card;
  const row = useJobRow(card, data, onSaved);
  const cell = { borderLeft: `1px solid ${LINE}` };
  return (
    <tbody>
      <tr>
        <td colSpan={COLUMNS.length} className="px-3 pb-1 pt-2" style={{ backgroundColor: '#F3EEE4', borderTop: `1px solid ${SHEET_EDGE}` }}>
          <PurchasingRowTitle job={job} onSaved={onSaved} />
        </td>
      </tr>
      <tr style={{ borderTop: `1px solid ${LINE}` }}>
        <MoneyCell display={windows.display} divider />
        <MoneyCell display={rough.display} />
        <MoneyCell display={sale.display} />
        <MoneyCell display={profitDisplay} tone={profitDisplay?.tone} />
        <td className="px-2 py-1.5 text-center align-top" style={cell}><QuoteCell card={card} onSaved={onSaved} /></td>
        <td className="px-2 py-1.5 text-center align-top" style={cell}><DotText tone={refTone(refs.poStatus) || 'gray'}>{refs.yaPo}</DotText></td>
        <td className="px-2 py-1.5 text-center align-top" style={cell}>
          <EtaCell job={job} data={data} etaLabel={refs.etaLabel} onSaved={onSaved} onOpenSupplier={row.openSupplierSection} />
        </td>
        <td className="px-2 py-1.5 align-top" style={cell}>
          <PaymentSelect payKey={row.payKey} busy={row.busy} onChange={(v) => row.savePayment(v)} />
          {row.payError && <span className="mt-1 block text-[10px] font-semibold" style={{ color: '#A43432' }}>{row.payError}</span>}
          {/* What we owe the supplier on this job (multi-scope jobs show it per scope row). */}
          {!row.multiScope && card.payables?.items > 0 && <div className="mt-1"><DotText tone={card.payables.tone}>Supplier · {card.payables.label}</DotText></div>}
        </td>
        <td className="px-1.5 py-1.5 text-center align-top" style={cell}><MoneyToggle row={row} jobId={job.id} /></td>
      </tr>
      {row.multiScope && <ScopeTableRows scopes={card.scopes} job={job} onSaved={onSaved} onOpenTracking={row.openSupplierSection} />}
      {row.expanded && row.fullJob && data && (
        <tr>
          <td colSpan={COLUMNS.length} className="px-3 py-3" style={{ borderTop: `1px solid ${LINE}`, backgroundColor: '#FBF9F5' }}>
            <Workspace row={row} data={data} onEdit={onEdit} onSaved={onSaved} jobId={job.id} />
          </td>
        </tr>
      )}
    </tbody>
  );
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const denverToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// ETA marker for the phone row: same label the ETA cell reads, said in a few characters.
function etaMarker(label) {
  if (!label) return { tone: 'gray', text: 'No ETA' };
  if (label === 'Delivered') return { tone: 'green', text: 'Delivered' };
  if (ISO_DAY.test(label)) {
    const d = etaDistance(label, denverToday());
    return { tone: d?.late ? 'red' : 'blue', text: d ? `ETA ${d.text}` : `ETA ${displayDate(label)}` };
  }
  return { tone: 'amber', text: `ETA ${label}` };
}

const CUSTOMER_TONE = { none: 'red', half_down: 'amber', installed: 'amber', waiting_on_payment: 'amber', paid: 'green' };

// Phone: one compact row per job; tap opens the details and workspace.
function MobileCard({ card, data, onEdit, onSaved }) {
  const { job, windows, rough, sale, profitDisplay, refs } = card;
  const row = useJobRow(card, data, onSaved);
  // Same figures the header adds (a multi-scope job adds its scope rows).
  const figures = summarizeCards([card]);
  const eta = etaMarker(refs.etaLabel);
  const customer = paymentStage(row.payKey)?.label || 'Not tracked';
  const supplier = card.payables?.items ? `Supplier ${card.payables.label.toLowerCase()}` : 'No PO';
  return (
    <div style={{ borderTop: `1px solid ${LINE}` }}>
      <button type="button" onClick={row.toggle} aria-expanded={row.expanded} aria-controls={`purchasing-row-${job.id}`}
        className="block w-full px-3 py-2.5 text-left" style={{ backgroundColor: row.expanded ? '#F3EEE4' : '#FFFFFF' }}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words text-[14px] font-extrabold leading-tight" style={{ color: INK }}>{rowTitle(job)}</span>
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" style={{ color: HEAD, transform: row.expanded ? 'rotate(180deg)' : 'none' }} />
        </span>
        <span className="mt-1 flex items-baseline gap-3 text-[12px]" style={{ color: CAPTION }}>
          <span>Sale <strong className="text-[13px] tabular-nums" style={{ color: INK }}>{money(figures.sale)}</strong></span>
          <span>Profit <strong className="text-[13px] tabular-nums" style={{ color: figures.profit < 0 ? '#A43432' : INK }}>{money(figures.profit)}</strong></span>
        </span>
        <span className="mt-1 flex flex-wrap items-start gap-x-3 gap-y-0.5">
          <DotText tone={eta.tone}>{eta.text}</DotText>
          <DotText tone={CUSTOMER_TONE[row.payKey] || 'amber'}>{customer}</DotText>
          <DotText tone={card.payables?.tone || 'gray'}>{supplier}</DotText>
        </span>
      </button>
      {row.expanded && (
      <div className="px-3 pb-3 pt-2" style={{ backgroundColor: '#FBF9F5', borderTop: `1px solid ${LINE}` }}>
        <div className="mb-2"><PurchasingRowTitle job={job} onSaved={onSaved} /></div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px]" style={{ backgroundColor: LINE, border: `1px solid ${LINE}` }}>
          <MoneyStat label="Windows" display={windows.display} accent={ACCENT.windows} />
          <MoneyStat label="Labor & material" display={rough.display} accent={ACCENT.rough} />
          <MoneyStat label="Sale price" display={sale.display} accent={ACCENT.sale} />
          <MoneyStat label="Profit" display={profitDisplay} accent={ACCENT.profit} tone={profitDisplay?.tone} />
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          <FieldRow label="Quote"><QuoteCell card={card} onSaved={onSaved} /></FieldRow>
          <FieldRow label="YA PO"><DotText tone={refTone(refs.poStatus) || 'gray'}>{refs.yaPo}</DotText></FieldRow>
          <FieldRow label="ETA">
            <EtaCell job={job} data={data} etaLabel={refs.etaLabel} onSaved={onSaved} onOpenSupplier={row.openSupplierSection} />
          </FieldRow>
        </div>
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.07em]" style={{ color: HEAD }}>Payments</div>
          <PaymentSelect payKey={row.payKey} busy={row.busy} onChange={(v) => row.savePayment(v)} />
          {row.payError && <div className="mt-1 text-[10px] font-semibold" style={{ color: '#A43432' }}>{row.payError}</div>}
        </div>
        {row.multiScope && <ScopeMobileBlocks scopes={card.scopes} job={job} onSaved={onSaved} onOpenTracking={row.openSupplierSection} />}
        {row.fullJob && data && (
          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <Workspace row={row} data={data} onEdit={onEdit} onSaved={onSaved} jobId={job.id} />
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export default function PurchasingTable({ cards, data, onEdit, onSaved }) {
  return (
    <>
      <div className="max-[699px]:hidden rounded-[12px] bg-white" style={{ border: `1px solid ${SHEET_EDGE}` }}>
        <table className="w-full border-collapse text-left" style={{ tableLayout: 'fixed' }}>
          <colgroup>{COLUMNS.map((c, i) => <col key={i} style={{ width: c.width }} />)}</colgroup>
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <th key={i} scope="col" className={`sticky top-0 z-10 px-2.5 py-2 text-[10.5px] font-bold uppercase tracking-[0.07em] ${c.money ? 'text-right' : 'text-center'}`}
                  style={{ color: HEAD, backgroundColor: HEAD_BG, borderBottom: `2px solid ${HEAD_RULE}`, borderLeft: i === 0 ? undefined : `1px solid ${LINE}`, boxShadow: c.accent ? `inset 0 3px 0 ${c.accent}` : undefined, borderTopLeftRadius: i === 0 ? 12 : undefined, borderTopRightRadius: i === COLUMNS.length - 1 ? 12 : undefined }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {cards.map((card) => <JobRows key={card.job.id} card={card} data={data} onEdit={() => onEdit(card)} onSaved={onSaved} />)}
        </table>
      </div>
      <div className="overflow-hidden rounded-[12px] bg-white min-[700px]:hidden" style={{ border: `1px solid ${SHEET_EDGE}`, borderTopWidth: 0 }}>
        {cards.map((card) => <MobileCard key={card.job.id} card={card} data={data} onEdit={() => onEdit(card)} onSaved={onSaved} />)}
      </div>
    </>
  );
}
