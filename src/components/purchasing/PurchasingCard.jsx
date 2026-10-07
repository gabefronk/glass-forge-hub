import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import MoneyTiles from './MoneyTiles';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import { C } from '@/lib/feeUI';
import { sectionForNextKey } from '@/lib/purchasingViewModel';

function RefDot({ status }) {
  const color = status === 'green' ? '#166447' : status === 'amber' ? '#C08B2E' : '#B8B0A4';
  return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

const linkBtn = 'inline-flex min-h-8 items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[11.5px] font-semibold';

// Single controlled expansion per job. aria-expanded/controls wired to the
// workspace region. The next-action opens the correct inline section (not a
// route) for budgets/orders/tracking; 'job' stays an external Open-job Link.
export default function PurchasingCard({ card, onEdit, data, onSaved }) {
  const { job, windows, rough, sale, profit, refs, next, files, supplier, units, conflict } = card;
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState('budgets');
  const moneyDup = rough.duplicate || sale.duplicate;
  const needsAction = conflict || moneyDup || windows.status === 'review' || windows.status === 'withheld' || next.key !== 'job';
  const statusTone = needsAction ? 'amber' : 'green';
  const statusLabel = conflict ? 'Conflict' : moneyDup ? 'Duplicate money' : needsAction ? 'Action needed' : 'On track';
  const winNote = windows.provenance === 'source_quote' ? 'from supplier quote total incl tax' : '';
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
          <h3 className="break-words text-[14.5px] font-bold leading-tight" style={{ color: '#101617' }}>{job.canonical_name || 'Unnamed job'}</h3>
          {(supplier || units > 0) && (
            <p className="mt-0.5 text-[11.5px]" style={{ color: '#566063' }}>
              {[supplier, units > 0 ? `${units} ${units === 1 ? 'unit' : 'units'}` : ''].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: statusTone === 'amber' ? '#FFF3DF' : '#EAF5EE', color: statusTone === 'amber' ? '#89511A' : '#166447', border: `1px solid ${statusTone === 'amber' ? '#F0DBA8' : '#C7E4D2'}` }}>{statusLabel}</span>
      </div>

      <div className="mt-2.5"><MoneyTiles windows={windows.value} windowsStatus={windows.status} rough={rough.value} sale={sale.value} profit={profit} /></div>
      {winNote && <p className="mt-1 text-[10.5px]" style={{ color: '#8A8F93' }}>Windows incl tax {winNote}</p>}

      <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]" style={{ color: '#566063' }}>
        <span><RefDot status={refs.quoteStatus} />Quote {refs.quoteNumber || '—'}</span>
        <span><RefDot status={refs.mfrStatus} />Mfr {refs.mfrOrder || '—'}</span>
        <span><RefDot status={refs.poStatus} />YA PO {refs.yaPo || '—'}</span>
        <span><RefDot status={refs.etaStatus} />ETA {refs.etaLabel || '—'}</span>
        <span><RefDot status={refs.payment} />Payment {refs.paymentLabel || '—'}</span>
      </div>

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