import { hasMoneyStates } from '@/lib/purchasingMoneyStates';

const money = (v) => (v == null
  ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function State({ label, state, sub }) {
  const partial = state?.partial ? ' · partial' : '';
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[10px] font-bold uppercase tracking-[0.07em]" style={{ color: '#6B7276' }}>{label}</div>
      <div className="mt-0.5 text-[13.5px] font-extrabold tabular-nums" style={{ color: '#101617' }}>{money(state?.value)}</div>
      <div className="text-[10px] font-medium leading-tight" style={{ color: '#6B7276' }}>{(sub || '') + (state?.records > 0 || state?.scopes > 0 ? partial : '')}</div>
    </div>
  );
}

// Job money stages, side by side and never summed: the same dollars move
// Estimated -> Committed -> Incurred -> Paid, so figures overlap by design.
// Estimated = reviewed budget (material incl tax + labor). Committed = open
// PO dealer amounts (pre-tax, material only). Incurred is UNKNOWN: vendor
// orders carry no invoice/bill field, so actual cost incurred is not tracked
// and never inferred from order or payment status. Paid = orders marked
// settled (processor-marked unless reconciled). A "payment requested" line
// appears only when a vendor sent an ACH link not yet marked paid.
export default function MoneyStatesStrip({ states }) {
  if (!hasMoneyStates(states)) return null;
  const est = states.estimated;
  const com = states.committed;
  const inc = states.incurred;
  const paid = states.paid;
  const req = states.paymentRequested;
  const paidSub = !paid.records ? 'none settled'
    : paid.reconciled === paid.records
      ? `${paid.records} reconciled`
      : `${paid.records} processor-marked, not reconciled`;
  return (
    <div className="mt-2.5 rounded-[9px] px-2.5 py-2" style={{ backgroundColor: '#FAF8F3', border: '1px solid #E4DCCD' }}>
      <div className="flex gap-2">
        <State label="Estimated" state={est} sub={est?.scopes > 0 ? (est.status === 'ready' ? `budget: material + labor` : 'budget needs review') : 'no budget'} />
        <State label="Committed" state={com} sub={com.records ? `${com.records} PO${com.records === 1 ? '' : 's'}, dealer pre-tax` : 'no POs'} />
        <State label="Incurred" state={inc} sub="unknown - no bill records" />
        <State label="Paid" state={paid} sub={paidSub} />
      </div>
      {req?.records > 0 ? (
        <p className="mt-1.5 text-[10px] font-bold leading-tight" style={{ color: '#34403F' }}>
          Payment requested: {money(req.value)}{req.partial ? ' (partial - some requested amounts unrecorded)' : ''} across {req.records} order{req.records === 1 ? '' : 's'} - a request is not a bill and not a payment.
        </p>
      ) : null}
      <p className="mt-1.5 text-[10px] font-medium leading-tight" style={{ color: '#6B7276' }}>
        Stages of the same money - they overlap, never add them. Vendor material only; labor actuals are not tracked here.
      </p>
    </div>
  );
}
