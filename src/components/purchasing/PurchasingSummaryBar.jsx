import { money } from '@/components/budgets/ProcurementForms';
import { PAYMENT_STAGES } from '@/lib/jobPayment';
import { ETA_FILTERS } from '@/lib/purchasingSummary';

// Totals bar: same nine columns and widths as a job row, so each total sits
// directly above the column it adds up. ETA and Payments hold the filters.
const ACCENT = { windows: '#3977CB', rough: '#7862B2', sale: '#248B88', profit: '#238557' };
const INK = '#101617', LINE = '#E2E8F0', HEAD = '#0B3F3B';
const HEADERS = ['Windows incl tax', 'Labor & material', 'Sale price', 'Profit', 'Quote', 'YA PO', 'ETA', 'Payments', ''];

function Total({ value, accent, first, negative }) {
  return (
    <td className="px-2 py-2 text-center align-middle" style={{ borderTop: `2px solid ${negative ? '#A43432' : accent}`, borderLeft: first ? undefined : `1px solid ${LINE}` }}>
      <div className="text-[15px] font-extrabold tabular-nums" style={{ color: INK, letterSpacing: '-0.01em' }}>{money(value)}</div>
    </td>
  );
}

function Count({ value, label }) {
  return (
    <td className="px-2 py-2 text-center align-middle" style={{ borderLeft: `1px solid ${LINE}` }}>
      <div className="text-[15px] font-extrabold tabular-nums" style={{ color: INK }}>{value}</div>
      <div className="text-[10.5px] font-medium" style={{ color: '#8A8F93' }}>{label}</div>
    </td>
  );
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border bg-white px-1 py-1 text-[11.5px] font-semibold"
      style={{ borderColor: LINE, color: INK }}>
      {children}
    </select>
  );
}

export default function PurchasingSummaryBar({ totals, shown, total, eta, payment, onEta, onPayment }) {
  const filtered = eta !== 'all' || payment !== 'all';
  return (
    <div className="overflow-hidden rounded-[16px] bg-white" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(10,29,31,.05)' }}>
      <div className="flex items-center justify-between px-4 pb-0.5 pt-3">
        <span className="text-[13px] font-bold" style={{ color: INK }}>
          Totals · {shown === total ? `${total} jobs` : `${shown} of ${total} jobs`}
        </span>
        {filtered && (
          <button type="button" onClick={() => { onEta('all'); onPayment('all'); }}
            className="text-[11.5px] font-medium underline" style={{ color: '#8A8F93', minHeight: 0 }}>Clear filters</button>
        )}
      </div>
      <table className="w-full border-collapse text-left" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} />
          <col style={{ width: '13%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '11%' }} /><col style={{ width: '6%' }} />
        </colgroup>
        <thead>
          <tr>
            {HEADERS.map((h, i) => (
              <th key={h || 'end'} className="px-2 py-2 text-center text-[10.5px] font-bold uppercase tracking-[0.07em]" style={{ color: HEAD, backgroundColor: '#F1F5F4', borderLeft: i === 0 ? undefined : `1px solid ${LINE}` }}>{h}</th>
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
            <td className="px-2 py-2 align-middle" style={{ borderLeft: `1px solid ${LINE}` }}>
              <FilterSelect label="Filter by ETA" value={eta} onChange={onEta}>
                {ETA_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </FilterSelect>
            </td>
            <td className="px-2 py-2 align-middle" style={{ borderLeft: `1px solid ${LINE}` }}>
              <FilterSelect label="Filter by payment status" value={payment} onChange={onPayment}>
                <option value="all">All payments</option>
                <option value="none">Not tracked</option>
                {PAYMENT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </FilterSelect>
            </td>
            <td style={{ borderLeft: `1px solid ${LINE}` }} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}