import { useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { PaymentStatusChip } from '@/components/jobs/JobPaymentStatus';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import { sectionForNextKey } from '@/lib/purchasingViewModel';
import { RefChip, refTone, paymentTone, etaTone } from './PurchasingCard';
import { money } from '@/components/budgets/ProcurementForms';

// Spreadsheet-style purchasing table - one row per job, same data and actions
// as the old cards. Money stays big, charcoal and tabular (never color-coded);
// column accent colors match the old tiles so the eye keeps the same map.
// Horizontally scrollable with a sticky job column on narrow screens.
const ACCENT = { windows: '#3977CB', rough: '#7862B2', sale: '#248B88', profit: '#238557' };
const INK = '#101617', SUB = '#566063', LINE = '#E2E8F0', HEAD = '#0B3F3B';

const HEADERS = ['Job', 'Status', 'Windows incl tax', 'Labor & material', 'Sale price', 'Profit', 'Quote', 'Mfr', 'YA PO', 'ETA', 'Payments', 'Actions'];

function MoneyCell({ display, accent, tone }) {
  const negative = tone === 'negative';
  return (
    <td className="px-3 py-2.5 align-top whitespace-nowrap" style={{ borderTop: `2px solid ${negative ? '#A43432' : accent}`, backgroundColor: negative ? '#FDE8E7' : undefined }}>
      <div className="text-[15px] font-extrabold tabular-nums" style={{ color: INK, letterSpacing: '-0.01em' }}>{money(display?.value)}</div>
      {display?.review ? <div className="mt-0.5 text-[9.5px] font-bold uppercase tracking-[0.05em]" style={{ color: '#3977CB' }}>Needs review</div> : null}
      {display?.label ? <div className="mt-0.5 max-w-[140px] truncate text-[10px] font-medium" style={{ color: SUB }} title={display.label}>{display.label}</div> : null}
    </td>
  );
}

function statusOf(card) {
  const { windows, rough, sale, conflict, next } = card;
  const moneyDup = rough.duplicate || sale.duplicate;
  const needsAction = conflict || moneyDup || windows.status === 'review' || windows.status === 'withheld' || next.key !== 'job';
  const label = conflict ? 'Conflict' : moneyDup ? 'Duplicate money' : needsAction ? 'Action needed' : 'On track';
  return needsAction
    ? { label, bg: '#FDE8E7', color: '#A43432', border: '#F0C9C5' }
    : { label, bg: '#EAF5EE', color: '#166447', border: '#C7E4D2' };
}

function Row({ card, data, onEdit, onSaved, zebra }) {
  const { job, windows, rough, sale, profitDisplay, refs, next, supplier, units } = card;
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState('budgets');
  const st = statusOf(card);
  const fullJob = data?.jobs?.find((j) => j.id === job.id) || job;
  const rowBg = zebra ? '#F8FAFC' : '#FFFFFF';

  const openSection = (key) => {
    const s = sectionForNextKey(key);
    if (!s) return;
    setSection(s);
    setExpanded(true);
  };
  const toggle = () => setExpanded((e) => { if (!e) setSection('budgets'); return !e; });

  return (
    <Fragment>
      <tr style={{ backgroundColor: rowBg, borderTop: `1px solid ${LINE}` }}>
        <td className="sticky left-0 z-[1] min-w-[190px] max-w-[240px] px-3 py-2.5 align-top" style={{ backgroundColor: rowBg, boxShadow: `1px 0 0 ${LINE}` }}>
          <div className="break-words text-[13.5px] font-extrabold leading-tight" style={{ color: INK }}>{job.canonical_name || 'Unnamed job'}</div>
          {(supplier || units > 0) && (
            <div className="mt-0.5 text-[10.5px] font-semibold" style={{ color: SUB }}>
              {[supplier, units > 0 ? `${units} ${units === 1 ? 'unit' : 'units'}` : ''].filter(Boolean).join(' · ')}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 align-top whitespace-nowrap">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ backgroundColor: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{st.label}</span>
        </td>
        <MoneyCell display={windows.display} accent={ACCENT.windows} />
        <MoneyCell display={rough.display} accent={ACCENT.rough} />
        <MoneyCell display={sale.display} accent={ACCENT.sale} />
        <MoneyCell display={profitDisplay} accent={ACCENT.profit} tone={profitDisplay?.tone} />
        <td className="px-3 py-2.5 align-top whitespace-nowrap"><RefChip label="Quote" value={refs.quoteNumber} tone={refTone(refs.quoteStatus)} /></td>
        <td className="px-3 py-2.5 align-top whitespace-nowrap"><RefChip label="Mfr" value={refs.mfrOrder} tone={refTone(refs.mfrStatus)} /></td>
        <td className="px-3 py-2.5 align-top whitespace-nowrap"><RefChip label="YA PO" value={refs.yaPo} tone={refTone(refs.poStatus)} /></td>
        <td className="px-3 py-2.5 align-top whitespace-nowrap"><RefChip label="ETA" value={refs.etaLabel} tone={etaTone(refs.etaLabel)} /></td>
        <td className="px-3 py-2.5 align-top whitespace-nowrap">
          <div className="flex flex-col items-start gap-1">
            <RefChip label="Supplier" value={refs.paymentLabel} tone={paymentTone(refs.paymentLabel)} />
            <PaymentStatusChip job={fullJob} />
          </div>
        </td>
        <td className="px-3 py-2.5 align-top whitespace-nowrap">
          <div className="flex flex-col items-start gap-1">
            <button type="button" onClick={onEdit} className="text-[11.5px] font-medium underline" style={{ color: '#8A8F93' }}>Edit money</button>
            {next.key === 'job'
              ? <Link to={next.href} className="text-[12px] font-semibold underline" style={{ color: HEAD }}>{next.label} →</Link>
              : <button type="button" onClick={() => openSection(next.key)} className="text-[12px] font-semibold underline" style={{ color: HEAD }}>{next.label} →</button>}
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
    </Fragment>
  );
}

export default function PurchasingTable({ cards, data, onEdit, onSaved }) {
  return (
    <div className="overflow-x-auto rounded-[12px] bg-white" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(10,29,31,.05)' }}>
      <table className="w-full min-w-[1180px] border-collapse text-left">
        <thead>
          <tr style={{ backgroundColor: '#F1F5F4' }}>
            {HEADERS.map((h, i) => (
              <th key={h} className={`px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.07em] whitespace-nowrap ${i === 0 ? 'sticky left-0 z-[1] min-w-[190px]' : ''}`}
                style={{ color: HEAD, backgroundColor: '#F1F5F4', ...(i === 0 ? { boxShadow: `1px 0 0 ${LINE}` } : {}) }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cards.map((card, i) => (
            <Row key={card.job.id} card={card} data={data} zebra={i % 2 === 1} onEdit={() => onEdit(card)} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
