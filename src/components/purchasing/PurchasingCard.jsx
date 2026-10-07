import { ChevronDown, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import MoneyTiles from './MoneyTiles';
import { C } from '@/lib/feeUI';
import { procurementPath } from '@/lib/procurementRoutes';

function RefDot({ status }) {
  const color = status === 'green' ? '#166447' : status === 'amber' ? '#C08B2E' : '#B8B0A4';
  return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

const linkBtn = 'inline-flex min-h-8 items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[11.5px] font-semibold';

export default function PurchasingCard({ card, onEdit }) {
  const { job, windows, rough, sale, profit, refs, next, files, supplier, units, conflict } = card;
  const moneyDup = rough.duplicate || sale.duplicate;
  const statusTone = conflict || moneyDup || [refs.quoteStatus, refs.mfrStatus, refs.etaStatus, refs.payment].includes('amber') ? 'amber' : 'green';
  const statusLabel = conflict ? 'Conflict' : moneyDup ? 'Duplicate money' : statusTone === 'amber' ? 'Action needed' : 'On track';
  const winNote = windows.provenance === 'source_quote' ? 'from supplier quote total incl tax' : '';

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
        <Link to={next.href} className="text-[12.5px] font-semibold underline" style={{ color: '#0B3F3B' }}>{next.label} →</Link>
      </div>

      <details className="mt-1.5">
        <summary className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium" style={{ color: '#8A8F93' }}><ChevronDown className="h-3.5 w-3.5" />More details</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link to={procurementPath(job.id, 'budgets')} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#FAF8F3' }}>Quotes & budget</Link>
          <Link to={procurementPath(job.id, 'orders')} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#FAF8F3' }}>Purchase orders</Link>
          <Link to={procurementPath(job.id, 'tracking')} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#FAF8F3' }}>Supplier tracking</Link>
          <Link to={`/jobs/${job.id}`} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#FAF8F3' }}>Open job</Link>
          {files.sourceQuote && <a href={files.sourceQuote} target="_blank" rel="noreferrer" className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#FAF8F3' }}><ExternalLink className="h-3.5 w-3.5" />Source quote</a>}
          {files.budgetSheet && <a href={files.budgetSheet} target="_blank" rel="noreferrer" className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#FAF8F3' }}><ExternalLink className="h-3.5 w-3.5" />Budget sheet</a>}
          {files.driveFolder && <a href={files.driveFolder} target="_blank" rel="noreferrer" className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#FAF8F3' }}><ExternalLink className="h-3.5 w-3.5" />Drive folder</a>}
        </div>
      </details>
    </article>
  );
}