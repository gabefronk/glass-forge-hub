import { hasMoneyStates } from '@/lib/purchasingMoneyStates';

const money = (v) => (v == null
  ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function State({ label, state, sub }) {
  const partial = state?.partial ? ' · partial' : '';
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[9.5px] font-bold uppercase tracking-[0.07em]" style={{ color: '#8A8F93' }}>{label}</div>
      <div className="mt-0.5 text-[13.5px] font-extrabold tabular-nums" style={{ color: '#101617' }}>{money(state?.value)}</div>
      <div className="text-[9.5px] font-medium leading-tight" style={{ color: '#8A8F93' }}>{(sub || '') + (state?.records > 0 || state?.scopes > 0 ? partial : '')}</div>
    </div>
  );
}

// The four QBO-style job-money stages, shown side by side and never summed:
// the same dollars move Estimated -> Committed -> Incurred -> Paid, so the
// figures overlap by design. Estimated comes from the reviewed budget,
// committed from open POs, incurred from vendor bills received (paid or not),
// and paid from vendor orders recorded settled.
export default function MoneyStatesStrip({ states }) {
  if (!hasMoneyStates(states)) return null;
  const est = states.estimated;
  const com = states.committed;
  const inc = states.incurred;
  const paid = states.paid;
  return (
    <div className="mt-2.5 rounded-[9px] px-2.5 py-2" style={{ backgroundColor: '#FAF8F3', border: '1px solid #E4DCCD' }}>
      <div className="flex gap-2">
        <State label="Estimated" state={est} sub={est?.scopes > 0 ? (est.status === 'ready' ? `${est.scopes} scope${est.scopes === 1 ? '' : 's'} (budget)` : 'budget needs review') : 'no budget'} />
        <State label="Committed" state={com} sub={com.records ? `${com.records} PO${com.records === 1 ? '' : 's'} (dealer)` : 'no POs'} />
        <State label="Incurred" state={inc} sub={inc.records ? `${inc.records} vendor bill${inc.records === 1 ? '' : 's'}` : 'none billed'} />
        <State label="Paid" state={paid} sub={paid.records ? `${paid.records} order${paid.records === 1 ? '' : 's'} settled` : 'none settled'} />
      </div>
      <p className="mt-1.5 text-[9.5px] font-medium leading-tight" style={{ color: '#8A8F93' }}>
        Stages of the same money - they overlap, never add them. Incurred counts unpaid vendor bills.
      </p>
    </div>
  );
}
