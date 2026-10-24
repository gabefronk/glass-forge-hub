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
// figures overlap by design. The bases differ on purpose and say so:
// estimated = reviewed budget (material incl tax + labor); committed = open
// PO dealer amounts (pre-tax, material only); incurred = vendor bills with
// positive billing evidence (ACH payment link / invoice), unpaid included;
// paid = orders marked settled (processor-marked unless reconciled).
export default function MoneyStatesStrip({ states }) {
  if (!hasMoneyStates(states)) return null;
  const est = states.estimated;
  const com = states.committed;
  const inc = states.incurred;
  const paid = states.paid;
  const paidSub = !paid.records ? 'none settled'
    : paid.reconciled === paid.records
      ? `${paid.records} reconciled`
      : `${paid.records} processor-marked, not reconciled`;
  return (
    <div className="mt-2.5 rounded-[9px] px-2.5 py-2" style={{ backgroundColor: '#FAF8F3', border: '1px solid #E4DCCD' }}>
      <div className="flex gap-2">
        <State label="Estimated" state={est} sub={est?.scopes > 0 ? (est.status === 'ready' ? `budget: material + labor` : 'budget needs review') : 'no budget'} />
        <State label="Committed" state={com} sub={com.records ? `${com.records} PO${com.records === 1 ? '' : 's'}, dealer pre-tax` : 'no POs'} />
        <State label="Incurred" state={inc} sub={inc.records ? `${inc.records} vendor bill${inc.records === 1 ? '' : 's'}, paid or not` : 'no bills yet'} />
        <State label="Paid" state={paid} sub={paidSub} />
      </div>
      <p className="mt-1.5 text-[9.5px] font-medium leading-tight" style={{ color: '#8A8F93' }}>
        Stages of the same money - they overlap, never add them. Vendor material only; labor actuals are not tracked here.
      </p>
    </div>
  );
}
