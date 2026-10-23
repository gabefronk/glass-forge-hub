import { Fragment } from 'react';
import EtaCell from './EtaCell';
import QuoteCell from './QuoteCell';
import DotText from './DotText';
import { refTone } from './PurchasingCard';
import { MoneyCell, MoneyStat, FieldRow, ACCENT, LINE } from './PurchasingCells';

// The extra rows of a job that holds more than one scope (a second budget, a
// reorder PO, a supplier order with no PO). Each scope keeps its own figures,
// quote, PO, ETA and supplier payment on its own row under the job's roll-up
// row, so a second order is never hidden behind the job's "Multiple". The job's
// own figures are untouched — these rows only read the scope's own records.
// No scope header bar: the row's own quote and PO identify which scope it is.

// The ETA cell of a scope row: it is given the scope's own target and no `data`,
// so it can never fall back to the job's aggregate supplier records.
function ScopeEta({ scope, job, onSaved, onOpenTracking }) {
  return <EtaCell job={job} etaTarget={scope.etaTarget} etaLabel={scope.etaLabel} onSaved={onSaved} onOpenSupplier={onOpenTracking} />;
}

// Non-money cells of a scope row: same column separators as the job row, plus a
// hairline top edge so the scope row still reads as separate from the row above
// (the removed label bar used to carry that edge).
const CELL = { borderLeft: `1px solid ${LINE}`, borderTop: '1px solid #EEE9E0' };

export function ScopeTableRows({ scopes, job, onSaved, onOpenTracking }) {
  return scopes.map((scope) => (
    <Fragment key={scope.key}>
      <tr style={{ backgroundColor: '#FCFDFC' }}>
        <MoneyCell display={scope.windows} accent={ACCENT.windows} divider />
        <MoneyCell display={scope.rough} accent={ACCENT.rough} />
        <MoneyCell display={scope.sale} accent={ACCENT.sale} />
        <MoneyCell display={scope.profit} accent={ACCENT.profit} tone={scope.profit?.tone} />
        <td className="px-2 py-2 text-center align-top" style={CELL}><QuoteCell card={scope.quoteCard} onSaved={onSaved} /></td>
        <td className="px-2 py-2 text-center align-top" style={CELL}><DotText tone={refTone(scope.poStatus) || 'gray'}>{scope.poNumber}</DotText></td>
        <td className="px-2 py-2 text-center align-top" style={CELL}>
          <ScopeEta scope={scope} job={job} onSaved={onSaved} onOpenTracking={onOpenTracking} />
        </td>
        <td className="px-2.5 py-2 align-top" style={CELL}><DotText tone={scope.payment.tone}>{scope.payment.label}</DotText></td>
        <td className="px-2 py-2 text-center align-top" style={CELL}>
          <button type="button" onClick={onOpenTracking} className="rounded-md px-1 py-0.5 text-[11.5px] font-medium underline" style={{ color: '#8A8F93' }}>Track</button>
        </td>
      </tr>
    </Fragment>
  ));
}

export function ScopeMobileBlocks({ scopes, job, onSaved, onOpenTracking }) {
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {scopes.map((scope) => (
        <div key={scope.key} className="overflow-hidden rounded-[10px]" style={{ border: `1px solid ${LINE}`, backgroundColor: '#FCFDFC' }}>
          <div className="grid grid-cols-2 gap-px" style={{ backgroundColor: LINE }}>
            <MoneyStat label="Windows incl tax" display={scope.windows} accent={ACCENT.windows} />
            <MoneyStat label="Labor & material" display={scope.rough} accent={ACCENT.rough} />
            <MoneyStat label="Sale price" display={scope.sale} accent={ACCENT.sale} />
            <MoneyStat label="Profit" display={scope.profit} accent={ACCENT.profit} tone={scope.profit?.tone} />
          </div>
          <div className="flex flex-col gap-2 p-2.5">
            <FieldRow label="Quote"><QuoteCell card={scope.quoteCard} onSaved={onSaved} /></FieldRow>
            <FieldRow label="YA PO"><DotText tone={refTone(scope.poStatus) || 'gray'}>{scope.poNumber}</DotText></FieldRow>
            <FieldRow label="ETA"><ScopeEta scope={scope} job={job} onSaved={onSaved} onOpenTracking={onOpenTracking} /></FieldRow>
            <FieldRow label="Supplier paid"><DotText tone={scope.payment.tone}>{scope.payment.label}</DotText></FieldRow>
            <button type="button" onClick={onOpenTracking} className="min-h-[44px] text-[12px] font-semibold underline" style={{ color: '#0B3F3B' }}>Open supplier tracking</button>
          </div>
        </div>
      ))}
    </div>
  );
}