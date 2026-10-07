import { ChevronRight } from 'lucide-react';

const money = (v) => (v == null
  ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Distinct tinted money boxes — one clear color per line so the eye separates
// windows / labor / sale / profit at a glance. The dollar figure is ALWAYS
// near-black charcoal (#101617), extrabold + tabular, so every amount carries
// the same weight — a review candidate never turns amber/brown. A negative
// profit swaps the profit box to a red tint/border, but the number itself stays
// charcoal (honest, not color-coded). value null → dash (truly absent); a real
// 0 stays $0.00 (never invented, never blanked).
const KIND = {
  windows: { bg: '#EAF2FF', top: '#3977CB' },
  rough:   { bg: '#F1ECFF', top: '#7862B2' },
  sale:    { bg: '#E5F3F3', top: '#248B88' },
  profit:  { bg: '#E4F3E9', top: '#238557' },
};
const PROFIT_NEG = { bg: '#FDE8E7', top: '#A43432' };
const PROFIT_UNKNOWN = { bg: '#E7EDF2', top: '#34506A' };

function Tile({ kind, label, value, tone = null, review = false, sub = null }) {
  let tint = KIND[kind] || { bg: '#FAF8F3', top: '#0B3F3B' };
  if (kind === 'profit') {
    if (tone === 'negative') tint = PROFIT_NEG;
    else if (value == null || tone === 'unknown' || tone === 'zero') tint = PROFIT_UNKNOWN;
  }
  return (
    <div className="min-w-0 rounded-[9px] px-2.5 py-2.5 sm:min-w-[130px] sm:flex-1" style={{ backgroundColor: tint.bg, borderTop: `2px solid ${tint.top}` }}>
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: '#34403F' }}>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-[20px] font-extrabold tabular-nums [overflow-wrap:anywhere] sm:text-[22px]" style={{ color: '#101617', letterSpacing: '-0.02em' }}>{money(value)}</div>
      {review ? (
        <div className="mt-1">
          <div className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.06em]" style={{ color: '#3977CB' }}>
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: '#3977CB' }} aria-hidden />
            Needs review
          </div>
          {sub ? <div className="mt-0.5 text-[9.5px] font-medium leading-tight" style={{ color: '#566063' }}>{sub}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// windows / rough / sale are the display objects { value, label, review, source }
// from the viewmodel; profit is the display profit { value, tone, review }.
export default function MoneyTiles({ windows, rough, sale, profit }) {
  return (
    <div className="grid grid-cols-2 gap-1 sm:flex sm:items-stretch">
      <Tile kind="windows" label="Windows incl tax" value={windows?.value} review={windows?.review} sub={windows?.label} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile kind="rough" label="Labor & material" value={rough?.value} review={rough?.review} sub={rough?.label} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile kind="sale" label="Sale price" value={sale?.value} review={sale?.review} sub={sale?.label} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile kind="profit" label="Profit" value={profit?.value} tone={profit?.tone} review={profit?.review} sub={null} />
    </div>
  );
}