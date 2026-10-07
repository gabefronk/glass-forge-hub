import { ChevronRight } from 'lucide-react';

const money = (v) => (v == null
  ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Tile({ label, value, tone = null }) {
  const color = tone === 'positive' ? '#166447' : tone === 'negative' ? '#A43432' : tone === 'zero' ? '#53615B' : '#101617';
  return (
    <div className="flex-1 min-w-[130px] rounded-[9px] px-2.5 py-2" style={{ backgroundColor: '#FAF8F3', borderTop: '2px solid #0B3F3B' }}>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: '#53615B' }}>{label}</div>
      <div className="mt-0.5 text-[16px] font-bold tabular-nums" style={{ color, letterSpacing: '-0.02em' }}>{money(value)}</div>
    </div>
  );
}

export default function MoneyTiles({ windows, rough, sale, profit }) {
  return (
    <div className="flex flex-wrap items-stretch gap-1">
      <Tile label="Windows incl tax" value={windows} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile label="Labor & material" value={rough} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile label="Sale price" value={sale} />
      <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 self-center sm:block" style={{ color: '#B8B0A4' }} strokeWidth={2.2} strokeLinecap="round" />
      <Tile label="Profit" value={profit.value} tone={profit.tone} />
    </div>
  );
}