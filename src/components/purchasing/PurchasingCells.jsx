import { money } from '@/components/budgets/ProcurementForms';

// Small display primitives shared by the purchasing table and its per-scope
// rows, so a scope row renders exactly like the job row above it.
// Density & contrast (Oct 24): warm rules that read on white (#D6CCBA), captions in
// AA-safe grey (#6B7276), money right-aligned so decimals line up. The column
// accent colors sit on the shared header, not on every cell.
export const ACCENT = { windows: '#3977CB', rough: '#7862B2', sale: '#1F7A77', profit: '#238557' };
export const INK = '#101617', LINE = '#D6CCBA', HEAD = '#0B3F3B', CAPTION = '#6B7276';
export const SHEET_EDGE = '#B3A792', HEAD_BG = '#E9E2D4', HEAD_RULE = '#34403F';

export function MoneyCell({ display, tone, divider }) {
  const negative = tone === 'negative';
  return (
    <td className="px-2.5 py-1.5 text-right align-top" style={{ borderLeft: divider ? undefined : `1px solid ${LINE}`, backgroundColor: negative ? '#FDE8E7' : undefined }}>
      <div className="text-[14px] font-extrabold tabular-nums" style={{ color: negative ? '#A43432' : INK, letterSpacing: '-0.01em' }}>{money(display?.value)}</div>
      <ReviewCaption display={display} align="right" />
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
      <ReviewCaption display={display} />
    </div>
  );
}

// Provenance caption under a money figure: rendered only when the viewmodel
// flags the figure as a candidate (review). Review figures without an
// explicit label (display profit) read "Estimate".
export function ReviewCaption({ display, align = 'left' }) {
  if (!display?.review) return null;
  return (
    <div className={`mt-0.5 text-[10px] font-semibold leading-snug ${align === 'right' ? 'ml-auto text-right' : ''}`} style={{ color: CAPTION, maxWidth: 170 }}>
      {display.label || 'Estimate'}
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
