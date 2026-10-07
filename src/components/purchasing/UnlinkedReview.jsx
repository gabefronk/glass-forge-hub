import { Link } from 'react-router-dom';
import { Package, FileText } from 'lucide-react';
import { C } from '@/lib/feeUI';
import QuoteDropzone from './QuoteDropzone';

// Quiet review section for no-job entities (shop POs, unlinked quotes) so they
// are never silently lost behind the one-card-per-job loop. Collapsed by
// default. The dropzone uploads via private storage (no public URL); the server
// signs a short-lived fetch link only to read the PDF, and persists the private ref.
export default function UnlinkedReview({ unlinkedQuotes = [], shopPOs = [], onUploaded }) {
  const hasAny = unlinkedQuotes.length > 0 || shopPOs.length > 0;
  return (
    <details className="rounded-[12px] p-3.5" style={{ backgroundColor: '#FFFFFF', border: '1px solid #D3CABB' }}>
      <summary className="min-h-9 cursor-pointer text-[13px] font-semibold" style={{ color: C.text }}>
        More · unlinked quotes & shop purchases {hasAny ? `(${unlinkedQuotes.length + shopPOs.length})` : ''}
      </summary>
      <div className="mt-3 space-y-3">
        {unlinkedQuotes.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: C.textSecondary }}><FileText className="mr-1 inline h-3.5 w-3.5" />Unlinked quote budgets ({unlinkedQuotes.length})</p>
            <ul className="space-y-1">
              {unlinkedQuotes.map((b) => (
                <li key={b.id}><Link to="/purchasing" className="text-[12.5px] font-medium underline" style={{ color: '#0B3F3B' }}>{b.title || b.quote_number || b.id}</Link>{b.vendor ? <span style={{ color: C.textSecondary }}> · {b.vendor}</span> : null}{b.budget_usage === 'draft' ? <span style={{ color: '#89511A' }}> · draft</span> : null}</li>
              ))}
            </ul>
          </div>
        )}
        {shopPOs.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: C.textSecondary }}><Package className="mr-1 inline h-3.5 w-3.5" />Shop purchases ({shopPOs.length})</p>
            <ul className="space-y-1">
              {shopPOs.map((p) => (
                <li key={p.id}><Link to="/purchasing" className="text-[12.5px] font-medium underline" style={{ color: '#0B3F3B' }}>{p.po_number || p.id}</Link>{p.vendor ? <span style={{ color: C.textSecondary }}> · {p.vendor}</span> : null}</li>
              ))}
            </ul>
          </div>
        )}
        {!hasAny && <p className="text-[12px]" style={{ color: C.textSecondary }}>No unlinked quotes or shop purchases.</p>}
        <QuoteDropzone onDone={onUploaded} />
      </div>
    </details>
  );
}