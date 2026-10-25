import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Package, FileText } from 'lucide-react';
import { C } from '@/lib/feeUI';
import { money } from '@/components/budgets/ProcurementForms';
import { statusLabel } from '@/lib/purchasingDates';
import QuoteDropzone from './QuoteDropzone';

// Shop purchases are overhead: cost only (shown as money out), never in Sold or Est. profit.
const SHOP_GRID = { display: 'grid', gridTemplateColumns: '80px 96px minmax(140px,220px) minmax(0,1fr) 120px 112px', alignItems: 'center' };
const shopDay = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}` : '—');

// Quiet review section for no-job entities (shop POs, unlinked quotes) so they
// are never silently lost behind the one-card-per-job loop. Collapsed by
// default. The dropzone uploads via private storage (no public URL); the server
// signs a short-lived fetch link only to read the PDF, and persists the private ref.
// focusSignal (incremented by the Purchasing "Add quote" button) opens this
// section and focuses the private dropzone — never a legacy public upload page.
export default function UnlinkedReview({ unlinkedQuotes = [], shopPOs = [], onUploaded, focusSignal = 0, onReload, loading }) {
  const hasAny = unlinkedQuotes.length > 0 || shopPOs.length > 0;
  const detailsRef = useRef(null);
  useEffect(() => {
    if (!focusSignal) return;
    if (detailsRef.current) detailsRef.current.open = true;
    const dz = document.getElementById('purchasing-quote-dropzone');
    if (dz) {
      dz.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const btn = dz.querySelector('button');
      if (btn) btn.focus();
    }
  }, [focusSignal]);
  return (
    <details ref={detailsRef} className="rounded-[12px] p-3.5" style={{ backgroundColor: '#FFFFFF', border: '1px solid #D3CABB' }}>
      <summary className="min-h-9 cursor-pointer text-[13px] font-semibold" style={{ color: C.text }}>
        More · unlinked quotes & shop purchases {hasAny ? `(${unlinkedQuotes.length + shopPOs.length})` : ''}
      </summary>
      <div className="mt-3 space-y-3">
        <div className="hidden justify-end max-[699px]:flex">
          <button type="button" disabled={loading} onClick={onReload} className="text-[11.5px] font-medium underline disabled:opacity-60" style={{ color: C.textSecondary, minHeight: 0 }}>{loading ? 'Reloading…' : 'Reload'}</button>
        </div>
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
            <h3 className="m-0 mb-1.5 text-[15px] font-bold" style={{ color: C.text }} title="Overhead bought for the shop or showroom. Cost only: not in Sold, Customers owe or Est. profit."><Package className="mr-1.5 inline h-4 w-4" />Shop purchases</h3>
            <div role="table" aria-label="Shop purchases" className="overflow-x-auto text-[14px]" style={{ color: C.text }}>
              <div role="row" className="text-[11.5px] font-semibold uppercase" style={{ ...SHOP_GRID, height: 36, background: '#E9E2D4', borderBottom: '2px solid #34403F', color: '#34403F', letterSpacing: '0.06em' }}>
                <span role="columnheader" className="px-2.5">Date</span>
                <span role="columnheader" className="px-2.5">PO</span>
                <span role="columnheader" className="px-2.5">Supplier</span>
                <span role="columnheader" className="px-2.5">Items</span>
                <span role="columnheader" className="px-2.5">Status</span>
                <span role="columnheader" className="px-2.5 text-right">Amount</span>
              </div>
              {shopPOs.map((p) => (
                <div key={p.id} role="row" title={p.notes || undefined} style={{ ...SHOP_GRID, minHeight: 40, borderBottom: '1px solid #D6CCBA' }}>
                  <span role="cell" className="px-2.5 tabular-nums">{shopDay(String(p.created_date || '').slice(0, 10))}</span>
                  <span role="cell" className="px-2.5" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#34403F' }}>{p.po_number || '—'}</span>
                  <span role="cell" className="truncate px-2.5">{p.vendor || '—'}</span>
                  <span role="cell" className="truncate px-2.5">{p.vendor_quote_ref || '—'}</span>
                  <span role="cell" className="px-2.5">{statusLabel(p.status)}</span>
                  <span role="cell" className="px-2.5 text-right tabular-nums">{p.amount_dealer == null ? '—' : money(0 - Number(p.amount_dealer))}</span>
                </div>
              ))}
              <div role="row" className="font-bold" style={{ ...SHOP_GRID, minHeight: 40, background: '#FAF8F3', borderBottom: '1px solid #D6CCBA' }}>
                <span role="cell" className="px-2.5" style={{ gridColumn: '1 / 6' }}>Total</span>
                <span role="cell" className="px-2.5 text-right tabular-nums">{money(0 - Math.round(shopPOs.reduce((n, p) => n + (Number(p.amount_dealer) || 0), 0) * 100) / 100)}</span>
              </div>
            </div>
          </div>
        )}
        {!hasAny && <p className="text-[12px]" style={{ color: C.textSecondary }}>No unlinked quotes or shop purchases.</p>}
        <QuoteDropzone onDone={onUploaded} />
      </div>
    </details>
  );
}