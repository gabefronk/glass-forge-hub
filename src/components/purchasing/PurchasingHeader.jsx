import { money } from '@/components/budgets/ProcurementForms';

// Purchasing title band with the four header figures (M2, Oct 24): Sold,
// Customers owe, We owe suppliers, Est. profit. Every figure adds only the rows
// shown under the current search and filter (headerFigures in
// purchasingSummary.js). Replaces the dark totals table and the record counts
// that used to sit in this band. Phones stack the figures 2 x 2.
const BAND = '#0B3F3B', WHITE = '#FFFFFF', SOFT = 'rgba(255,255,255,.80)', DIVIDER = 'rgba(255,255,255,.18)', NEGATIVE = '#FFB4AE';

function Figure({ label, value, note, negative }) {
  return (
    <div className="min-w-0 px-3 py-1.5 max-[699px]:px-2.5" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.07em]" style={{ color: SOFT }}>{label}</div>
      <div className="text-[19px] font-extrabold tabular-nums leading-tight max-[699px]:text-[17px]" style={{ color: negative ? NEGATIVE : WHITE, letterSpacing: '-0.01em' }}>{money(value)}</div>
      {note ? <div className="text-[10.5px] font-medium leading-tight" style={{ color: SOFT }}>{note}</div> : null}
    </div>
  );
}

export default function PurchasingHeader({ figures, shown, total }) {
  const partial = [
    figures.partialScopes > 0 && `${figures.partialScopes} multi-scope ${figures.partialScopes === 1 ? 'job has' : 'jobs have'} a scope with no figure`,
    figures.apMissing > 0 && `${figures.apMissing} unpaid supplier ${figures.apMissing === 1 ? 'record has' : 'records have'} no amount`,
  ].filter(Boolean);
  return (
    <section className="overflow-hidden rounded-[12px]" style={{ backgroundColor: BAND, border: '1px solid #082F2C' }}>
      <div className="flex items-stretch max-[699px]:flex-col">
        <div className="flex shrink-0 flex-col justify-center px-4 py-2 max-[699px]:px-3">
          <h1 className="m-0 text-[19px] font-bold leading-[24px]" style={{ color: '#F2EEE8', letterSpacing: '-0.03em' }}>Purchasing</h1>
          <span className="text-[11.5px] font-medium" style={{ color: SOFT }}>{shown === total ? `${total} jobs` : `${shown} of ${total} jobs`}</span>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-4 max-[699px]:grid-cols-2 max-[699px]:border-t" style={{ borderColor: DIVIDER }}>
          <Figure label="Sold" value={figures.sold} note="Sale price column" />
          <Figure label="Customers owe" value={figures.customersOwe} note="Sale less payments by stage" />
          <Figure label="We owe suppliers" value={figures.weOwe} note="Unpaid POs, before tax" />
          <Figure label="Est. profit" value={figures.profit} note="Profit column" negative={figures.profit < 0} />
        </div>
      </div>
      {partial.length > 0 && (
        <div className="px-4 py-1 text-[11px] font-medium max-[699px]:px-3" style={{ color: SOFT, borderTop: `1px solid ${DIVIDER}` }}>
          Partial: {partial.join('; ')}.
        </div>
      )}
    </section>
  );
}
