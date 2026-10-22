import { useState, Fragment } from 'react';
import { ChevronDown } from 'lucide-react';
import { PaymentStatusChip } from '@/components/jobs/JobPaymentStatus';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import { RefChip, refTone, paymentTone } from './PurchasingCard';
import { money } from '@/components/budgets/ProcurementForms';
import { displayDate } from '@/lib/purchasingDates';

// Spreadsheet-style purchasing table - one row of figures per job, with the
// job name on its own line directly above (10/22 layout pass per Gabriel).
// No status column, no review tags or sublabels under the money; the quote
// cell reads "Supplier - quote #"; the PO cell is just the YA number. Fits
// the page width - no horizontal scroll. Money stays big, charcoal, tabular.
const ACCENT = { windows: '#3977CB', rough: '#7862B2', sale: '#248B88', profit: '#238557' };
const INK = '#101617', SUB = '#566063', LINE = '#E2E8F0', HEAD = '#0B3F3B';
const DOT = { green: '#166447', amber: '#C08B2E', red: '#A43432', blue: '#3977CB', gray: '#B8B0A4' };

const HEADERS = ['Windows incl tax', 'Labor & material', 'Sale price', 'Profit', 'Quote', 'YA PO', 'ETA', 'Payments', 'Actions'];

function MoneyCell({ display, accent, tone, divider }) {
  const negative = tone === 'negative';
  return (
    <td className="px-2 py-2 text-center align-top" style={{ borderTop: `2px solid ${negative ? '#A43432' : accent}`, borderLeft: divider ? undefined : `1px solid ${LINE}`, backgroundColor: negative ? '#FDE8E7' : undefined }}>
      <div className="text-[15px] font-extrabold tabular-nums" style={{ color: INK, letterSpacing: '-0.01em' }}>{money(display?.value)}</div>
    </td>
  );
}

// Colored status dot + wrapping text (no chip pill, no forced single line).
function DotText({ tone = 'gray', children }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-[12px] font-semibold" style={{ color: INK }}>
      <span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: DOT[tone] || DOT.gray }} />
      <span>{children || '—'}</span>
    </span>
  );
}

function Row({ card, data, onEdit, onSaved, zebra }) {
  const { job, windows, rough, sale, profitDisplay, refs, supplier, units } = card;
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState('budgets');
  const fullJob = data?.jobs?.find((j) => j.id === job.id) || job;
  const rowBg = zebra ? '#F8FAFC' : '#FFFFFF';
  const quoteText = refs.quoteNumber ? [card.brand, refs.quoteNumber].filter(Boolean).join(' - ') : null;
  const toggle = () => setExpanded((e) => { if (!e) setSection('budgets'); return !e; });

  return (
    <Fragment>
      <div className="px-4 pb-0.5 pt-3" style={{ backgroundColor: rowBg }}>
          <span className="break-words text-[14px] font-extrabold leading-tight" style={{ color: INK }}>{job.canonical_name || 'Unnamed job'}</span>
          {units > 0 && (
            <span className="ml-2 text-[11px] font-semibold" style={{ color: SUB }}>{`${units} ${units === 1 ? 'unit' : 'units'}`}</span>
          )}
      </div>
      <table className="w-full border-collapse text-left" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} />
          <col style={{ width: '15%' }} /><col style={{ width: '10%' }} /><col style={{ width: '8%' }} /><col style={{ width: '11%' }} /><col style={{ width: '6%' }} />
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
        <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}><DotText tone={refs.etaLabel ? 'blue' : 'gray'}>{/^\d{4}-\d{2}-\d{2}$/.test(refs.etaLabel || '') ? displayDate(refs.etaLabel) : refs.etaLabel}</DotText></td>
        <td className="px-2.5 py-2 align-top" style={{ borderLeft: `1px solid ${LINE}` }}>
          <div className="flex flex-col items-start gap-1">
            <RefChip label="Supplier" value={refs.paymentLabel} tone={paymentTone(refs.paymentLabel)} />
            <PaymentStatusChip job={fullJob} />
          </div>
        </td>
        <td className="px-2 py-2 text-center align-top" style={{ borderLeft: `1px solid ${LINE}` }}>
          <div className="flex flex-col items-center gap-1">
            <button type="button" onClick={onEdit} className="text-[11.5px] font-medium underline" style={{ color: '#8A8F93' }}>Edit money</button>
            <button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={`purchasing-row-${job.id}`}
              className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#8A8F93' }}>
              <ChevronDown className="h-3.5 w-3.5" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />{expanded ? 'Hide details' : 'Details'}
            </button>
          </div>
        </td>
      </tr>
      {expanded && fullJob && data && (
        <tr id={`purchasing-row-${job.id}`} style={{ backgroundColor: rowBg, borderTop: `1px solid ${LINE}` }}>
          <td colSpan={HEADERS.length} className="px-3 py-3">
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
