import { money } from '@/components/budgets/ProcurementForms';

// Small display primitives shared by the purchasing table and its per-scope
// rows, so a scope row renders exactly like the job row above it.
export const ACCENT = { windows: '#3977CB', rough: '#7862B2', sale: '#248B88', profit: '#238557' };
export const INK = '#101617', LINE = '#E2E8F0', HEAD = '#0B3F3B';

export function MoneyCell({ display, accent, tone, divider }) {
  const negative = tone === 'negative';
  return (
    <td className="px-2 py-2 text-center align-top" style={{ borderTop: `2px solid ${negative ? '#A43432' : accent}`, borderLeft: divider ? undefined : `1px solid ${LINE}`, backgroundColor: negative ? '#FDE8E7' : undefined }}>
      <div className="text-[15px] font-extrabold tabular-nums" style={{ color: INK, letterSpacing: '-0.01em' }}>{money(display?.value)}</div>
    </td>
  );
}

// Mobile stat: same accent strip and figure style as a desktop money cell.
export function MoneyStat({ label, display, accent, tone }) {
  const negative = tone === 'negative';
  return (
    <div className="px-3 py-2.5" style={{ borderTop: `2px solid ${negative ? '#A43432' : accent}`, backgroundColor: negative ? '#FDE8E7' : '#FFFFFF' }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.07em]" style={{ color: HEAD }}>{label}</div>
      <div className="mt-0.5 text-[16px] font-extrabold tabular-nums" style={{ color: INK, letterSpacing: '-0.01em' }}>{money(display?.value)}</div>
    </div>
  );
}

// Labeled row inside the mobile card: label left, cell content right.
export function FieldRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.07em]" style={{ color: HEAD }}>{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}