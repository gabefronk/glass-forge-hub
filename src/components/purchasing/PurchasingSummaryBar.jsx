import { money } from '@/components/budgets/ProcurementForms';
import { PAYMENT_STAGES } from '@/lib/jobPayment';
import { ETA_FILTERS } from '@/lib/purchasingSummary';

// Totals bar: same nine columns and widths as a job row, so each total sits
// directly above the column it adds up. ETA and Payments hold the filters.
// Dark teal with white figures so it reads as the page's control strip and
// stands apart from the white job rows below it.
//
// 10/22 mobile pass: below 700px the totals table collapses into a stacked
// layout - a 2x2 money grid, a counts line, then full-width filters - so the
// figures stay readable on a phone. The desktop table is untouched.
const ACCENT = { windows: '#7FB3F2', rough: '#B7A5EA', sale: '#5FD1CC', profit: '#5FD39A' };
const NEGATIVE = '#FF8A85';
const BAR = '#0B3F3B', BAR_DEEP = '#082F2C', DIVIDER = 'rgba(255,255,255,.14)';
const WHITE = '#FFFFFF', SOFT = 'rgba(255,255,255,.72)';
const HEADERS = ['Windows incl tax', 'Labor & material', 'Sale price', 'Profit', 'Quote', 'YA PO', 'ETA', 'Payments', ''];

function Total({ value, accent, first, negative }) {
  return (
    <td className="px-2 py-3.5 text-center align-middle" style={{ borderTop: `3px solid ${negative ? NEGATIVE : accent}`, borderLeft: first ? undefined : `1px solid ${DIVIDER}` }}>
      <div className="text-[18px] font-extrabold tabular-nums" style={{ color: negative ? NEGATIVE : WHITE, letterSpacing: '-0.01em' }}>{money(value)}</div>
    </td>
  );
}

// Mobile total: same accent strip + white figure as a desktop Total cell.
function TotalStat({ label, value, accent, negative }) {
  return (
    <div className="px-3 py-2.5" style={{ borderTop: `3px solid ${negative ? NEGATIVE : accent}`, backgroundColor: BAR }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.07em]" style={{ color: SOFT }}>{label}</div>
      <div className="mt-0.5 text-[18px] font-extrabold tabular-nums" style={{ color: negative ? NEGATIVE : WHITE, letterSpacing: '-0.01em' }}>{money(value)}</div>
    </div>
  );
}

function Count({ value, label }) {
  return (
    <td className="px-2 py-3.5 text-center align-middle" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
      <div className="text-[18px] font-extrabold tabular-nums" style={{ color: WHITE }}>{value}</div>
      <div className="text-[10.5px] font-medium" style={{ color: SOFT }}>{label}</div>
    </td>
  );
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border bg-white px-1 py-1 text-[11.5px] font-semibold"
      style={{ borderColor: 'transparent', color: '#101617' }}>
      {children}
    </select>
  );
}

export default function PurchasingSummaryBar({ totals, shown, total, eta, payment, onEta, onPayment }) {
  const filtered = eta !== 'all' || payment !== 'all';
  return (
    <div className="overflow-hidden rounded-[16px]" style={{ backgroundColor: BAR, border: `1px solid ${BAR_DEEP}`, boxShadow: '0 2px 4px rgba(10,29,31,.18), 0 12px 28px -8px rgba(10,29,31,.45)' }}>
      <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
        <span className="text-[15px] font-extrabold tracking-wide" style={{ color: WHITE }}>
          Totals · {shown === total ? `${total} jobs` : `${shown} of ${total} jobs`}
        </span>
        {filtered && (
          <button type="button" onClick={() => { onEta('all'); onPayment('all'); }}
            className="text-[12px] font-semibold underline" style={{ color: WHITE, minHeight: 0 }}>Clear filters</button>
        )}
      </div>
      <div className="max-[699px]:hidden">
        <table className="w-full border-collapse text-left" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} />
            <col style={{ width: '13%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '11%' }} /><col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr>
              {HEADERS.map((h, i) => (
                <th key={h || 'end'} className="px-2 py-2 text-center text-[10.5px] font-bold uppercase tracking-[0.07em]" style={{ color: SOFT, backgroundColor: BAR_DEEP, borderLeft: i === 0 ? undefined : `1px solid ${DIVIDER}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <Total value={totals.windows} accent={ACCENT.windows} first />
              <Total value={totals.rough} accent={ACCENT.rough} />
              <Total value={totals.sale} accent={ACCENT.sale} />
              <Total value={totals.profit} accent={ACCENT.profit} negative={totals.profit < 0} />
              <Count value={totals.quotes} label="quotes" />
              <Count value={totals.pos} label="POs" />
              <td className="px-2 py-3.5 align-middle" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
                <FilterSelect label="Filter by ETA" value={eta} onChange={onEta}>
                  {ETA_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </FilterSelect>
              </td>
              <td className="px-2 py-3.5 align-middle" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
                <FilterSelect label="Filter by payment status" value={payment} onChange={onPayment}>
                  <option value="all">All payments</option>
                  <option value="none">Not tracked</option>
                  {PAYMENT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </FilterSelect>
              </td>
              <td style={{ borderLeft: `1px solid ${DIVIDER}` }} />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="px-4 pb-4 min-[700px]:hidden">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px]" style={{ backgroundColor: DIVIDER, border: `1px solid ${DIVIDER}` }}>
          <TotalStat label="Windows incl tax" value={totals.windows} accent={ACCENT.windows} />
          <TotalStat label="Labor & material" value={totals.rough} accent={ACCENT.rough} />
          <TotalStat label="Sale price" value={totals.sale} accent={ACCENT.sale} />
          <TotalStat label="Profit" value={totals.profit} accent={ACCENT.profit} negative={totals.profit < 0} />
        </div>
        <div className="mt-2 text-[12px] font-semibold" style={{ color: SOFT }}>
          {totals.quotes} quotes · {totals.pos} POs
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          <FilterSelect label="Filter by ETA" value={eta} onChange={onEta}>
            {ETA_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </FilterSelect>
          <FilterSelect label="Filter by payment status" value={payment} onChange={onPayment}>
            <option value="all">All payments</option>
            <option value="none">Not tracked</option>
            {PAYMENT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </FilterSelect>
        </div>
      </div>
    </div>
  );
}
