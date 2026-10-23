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

// Non-money cells of a scope row: same column separators as the job row. The
// row separator is its own full-width divider row (DIVIDER), so it runs edge to
// edge instead of stopping at the money columns.
const CELL = { borderLeft: `1px solid ${LINE}` };
const ROW = { backgroundColor: '#FCFDFC' };

// One-pixel divider between the job row and its scopes, and between each scope.
// A single spanning cell keeps the line continuous across every column (the
// money cells carry their own colored top strip, so a row border would break).
const ACCENT_WINDOWS = '#3977CB';

const DIVIDER = (
  <tr aria-hidden="true">
    <td colSpan={9} style={{ height: 0, padding: 0, borderTop: `1px solid ${LINE}`, backgroundColor: '#FCFDFC' }} />
  </tr>
);

export function ScopeTableRows({ scopes, job, onSaved, onOpenTracking }) {
  return scopes.map((scope) => (
    <Fragment key={scope.key}>
      {DIVIDER}
      {scope.label ? (
        <tr>
          <td colSpan={9} className="px-2.5 pt-1.5" style={{ ...CELL, backgroundColor: '#FCFDFC', borderLeft: `3px solid ${ACCENT_WINDOWS}` }}>
            <span className="text-[10px] font-bold uppercase tracking-[0.05em]" style={{ color: '#5E6B66' }}>Scope</span>{' '}
            <span className="text-[11px] font-medium" style={{ color: '#33403B' }}>{scope.label}</span>
          </td>
        </tr>
      ) : null}
      <tr style={ROW}>
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
          {scope.label ? (
            <div className="px-3 py-1.5" style={{ borderLeft: `3px solid ${ACCENT_WINDOWS}`, borderBottom: `1px solid ${LINE}` }}>
              <span className="text-[10px] font-bold uppercase tracking-[0.05em]" style={{ color: '#5E6B66' }}>Scope</span>{' '}
              <span className="text-[11.5px] font-medium" style={{ color: '#33403B' }}>{scope.label}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-px" style={{ backgroundColor: LINE }}>
            <MoneyStat label="Windows" display={scope.windows} accent={ACCENT.windows} />
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