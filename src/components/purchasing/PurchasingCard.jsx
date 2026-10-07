import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import MoneyTiles from './MoneyTiles';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import { sectionForNextKey } from '@/lib/purchasingViewModel';
import { money } from '@/components/budgets/ProcurementForms';

// Tinted ref chips — honest coloring, never green for an unverified row.
// green = verified/confirmed, amber = review/pending/partial, red = unpaid,
// blue = ETA (a schedule date, never claims verified), neutral = unknown/dash.
const REF_TONES = {
  green:  { bg: '#EAF5EE', color: '#166447', border: '#C7E4D2', dot: '#166447' },
  amber:  { bg: '#FFF3DF', color: '#34403F', border: '#F0DBA8', dot: '#C08B2E' },
  red:    { bg: '#FDE8E7', color: '#A43432', border: '#F0C9C5', dot: '#A43432' },
  blue:   { bg: '#EAF2FF', color: '#3977CB', border: '#C7D8EF', dot: '#3977CB' },
};
function RefChip({ label, value, tone }) {
  if (!tone) {
    return <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#8A8F93' }}><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#B8B0A4' }} />{label} {value || '—'}</span>;
  }
  const t = REF_TONES[tone];
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap" style={{ backgroundColor: t.bg, color: t.color, border: `1px solid ${t.border}` }}><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.dot }} />{label} {value || '—'}</span>;
}
const refTone = (s) => (s === 'green' ? 'green' : s === 'amber' ? 'amber' : null);
const paymentTone = (lbl) => (lbl === 'Unpaid' ? 'red' : lbl === 'Partial' ? 'amber' : lbl === 'Paid' ? 'green' : null);
const etaTone = (lbl) => (lbl ? 'blue' : null);

// Single controlled expansion per job. aria-expanded/controls wired to the
// workspace region. The next-action opens the correct inline section (not a
// route) for budgets/orders/tracking; 'job' stays an external Open-job Link.
export default function PurchasingCard({ card, onEdit, data, onSaved }) {
  const { job, windows, rough, sale, profitDisplay, refs, next, supplier, units, conflict, chosenBudget } = card;
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState('budgets');
  const moneyDup = rough.duplicate || sale.duplicate;
  const needsAction = conflict || moneyDup || windows.status === 'review' || windows.status === 'withheld' || next.key !== 'job';
  const statusTone = needsAction ? 'amber' : 'green';
  const statusLabel = conflict ? 'Conflict' : moneyDup ? 'Duplicate money' : needsAction ? 'Action needed' : 'On track';
  const panelId = `purchasing-workspace-${job.id}`;
  const fullJob = data?.jobs?.find((j) => j.id === job.id) || job;

  const openSection = (key) => {
    const s = sectionForNextKey(key);
    if (!s) return; // 'job' stays a Link, never opens inline
    setSection(s);
    setExpanded(true);
  };
  const toggleMore = () => {
    setExpanded((e) => {
      if (!e) setSection('budgets');
      return !e;
    });
  };

  return (
    <article className="rounded-[12px] p-3.5" style={{ backgroundColor: '#FFFFFF', border: '1px solid #D3CABB', borderTop: '2px solid #0B3F3B', boxShadow: '0 1px 2px rgba(10,29,31,.05), 0 4px 10px -4px rgba(10,29,31,.10)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-[15.5px] font-extrabold leading-tight" style={{ color: '#101617' }}>{job.canonical_name || 'Unnamed job'}</h3>
          {(supplier || units > 0) && (
            <p className="mt-0.5 text-[11.5px] font-semibold" style={{ color: '#566063' }}>
              {[supplier, units > 0 ? `${units} ${units === 1 ? 'unit' : 'units'}` : ''].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap" style={{ backgroundColor: statusTone === 'amber' ? '#FDE8E7' : '#EAF5EE', color: statusTone === 'amber' ? '#A43432' : '#166447', border: `1px solid ${statusTone === 'amber' ? '#F0C9C5' : '#C7E4D2'}` }}>{statusLabel}</span>
      </div>

      <div className="mt-2.5"><MoneyTiles windows={windows.display} rough={rough.display} sale={sale.display} profit={profitDisplay} /></div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <RefChip label="Quote" value={refs.quoteNumber} tone={refTone(refs.quoteStatus)} />
        <RefChip label="Mfr" value={refs.mfrOrder} tone={refTone(refs.mfrStatus)} />
        <RefChip label="YA PO" value={refs.yaPo} tone={refTone(refs.poStatus)} />
        <RefChip label="ETA" value={refs.etaLabel} tone={etaTone(refs.etaLabel)} />
        <RefChip label="Payment" value={refs.paymentLabel} tone={paymentTone(refs.paymentLabel)} />
      </div>

      {windows.display?.review && (chosenBudget || windows.display?.alternatives?.length) ? (
        <div className="mt-1.5 text-[10.5px] leading-snug" style={{ color: '#566063' }}>
          {chosenBudget ? <span>Estimate from {chosenBudget.title}</span> : null}
          {windows.display?.alternatives?.length ? <span>{chosenBudget ? ' · ' : ''}Alternatives: {windows.display.alternatives.map((a) => `${a.label || 'estimate'} ${money(a.value)}`).join('; ')}</span> : null}
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button type="button" onClick={onEdit} className="text-[11.5px] font-medium underline" style={{ color: '#8A8F93' }}>Edit money</button>
        {next.key === 'job'
          ? <Link to={next.href} className="text-[12.5px] font-semibold underline" style={{ color: '#0B3F3B' }}>{next.label} →</Link>
          : <button type="button" onClick={() => openSection(next.key)} className="text-[12.5px] font-semibold underline" style={{ color: '#0B3F3B' }}>{next.label} →</button>}
      </div>

      <button type="button" onClick={toggleMore} aria-expanded={expanded} aria-controls={panelId}
        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#8A8F93' }}>
        <ChevronDown className="h-3.5 w-3.5" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />{expanded ? 'Hide details' : 'More details'}
      </button>

      {expanded && fullJob && data && (
        <div id={panelId} role="region" aria-label={`Purchasing workspace for ${job.canonical_name}`}>
          <PurchasingJobWorkspace job={fullJob} data={data} section={section} onSection={setSection} onSaved={onSaved} />
        </div>
      )}
    </article>
  );
}