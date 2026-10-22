// Colored status dot + wrapping text used across the purchasing table cells
// (no chip pill, no forced single line). Shared so the table and its cells
// render the same indicator.
const DOT = { green: '#166447', amber: '#C08B2E', red: '#A43432', blue: '#3977CB', gray: '#B8B0A4' };
const INK = '#101617';

export default function DotText({ tone = 'gray', children }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-[12px] font-semibold" style={{ color: INK }}>
      <span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: DOT[tone] || DOT.gray }} />
      <span>{children || '—'}</span>
    </span>
  );
}