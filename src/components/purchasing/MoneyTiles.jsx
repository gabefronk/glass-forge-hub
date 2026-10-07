import { ChevronRight } from 'lucide-react';

const money = (v) => (v == null
  ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Each tile shows the display value (candidate or verified). When `review` is
// true the value is a best-known candidate, not a verified figure: the top
// border turns amber, a dot marks the label, and the honest provenance label
// renders beneath the number. value null → dash (truly absent); a real 0
// stays $0.00 (never invented, never blanked).
function Tile({ label, value, tone = null, review = false, sub = null }) {
  const color = review ? '#101617' : tone === 'positive' ? '#166447' : tone === 'negative' ? '#A43432' : tone === 'zero' ? '#53615B' : '#101617';
  return (
    <div className="min-w-0 rounded-[9px] px-2.5 py-2 sm:min-w-[130px] sm:flex-1" style={{ backgroundColor: '#FAF8F3', borderTop: `2px solid ${review ? '#8C9EAF' : '#0B3F3B'}` }}>
      <div className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: '#53615B' }}>
        {review && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: '#8C9EAF' }} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-[16px] font-bold tabular-nums [overflow-wrap:anywhere]" style={{ color, letterSpacing: '-0.02em' }}>{money(value)}</div>
      {review ? <div className="mt-0.5 text-[9.5px] font-medium leading-tight" style={{ color: '#566063' }}>Needs review{sub ? ` · ${sub}` : ''}</div> : null}
    </div>
  );
}

// windows / rough / sale are the display objects { value, label, review, source }
// from the viewmodel; profit is the display profit { value, tone, review }.
export default function MoneyTiles({ windows, rough, sale, profit }) {
  return (
    <div className="grid grid-cols-2 gap-1 sm:flex sm:items-stretch">
      <Tile label="Windows incl tax" value={windows?.value} review={windows?.review} sub={windows?.label} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile label="Labor & material" value={rough?.value} review={rough?.review} sub={rough?.label} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile label="Sale price" value={sale?.value} review={sale?.review} sub={sale?.label} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile label="Profit" value={profit?.value} tone={profit?.tone} review={profit?.review} sub={null} />
    </div>
  );
}