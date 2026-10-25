// The one per-job purchasing workspace: opens in place beneath a Purchasing row,
// and is the whole Budget & Orders page for a job (pages/Procurement.jsx).
// Redesign (Gabriel, Oct 24): one page, no section switcher, nothing said twice.
//   1. Purchase orders & quotes - one line per PO / supplier order with its PO,
//      quote and order numbers, ETA, supplier payable and supplier payment. Manage
//      opens that line's real forms (status, confirmation, payment, sales tax, ETA).
//   2. Budget - each quote budget's cost build-up and price & margin. Edit numbers
//      is the one place job money is changed (the budget is the source).
//   3. The private vendor-quote upload.
// Reuses the existing native procurement forms (PurchaseOrderForm, BudgetUsageForm,
// SupplierOrderForm, OrderStatusForm, NumbersEditor, DeleteUnusedQuoteButton) and the
// shared procurement service validation. Same-job records are filtered by EXACT
// immutable job id (jobProcurementRecords) - never a name join. Editor records are
// looked up from rec.* (this job only), so a record from another job can never load.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Pencil, Plus } from 'lucide-react';
import {
  money,
  PurchaseOrderForm, BudgetUsageForm, SupplierOrderForm, OrderStatusForm,
  SalesTaxBox, purchasingRequest, messageOf,
} from '@/components/budgets/ProcurementForms';
import { NumbersEditor } from '@/components/budgets/BudgetReviewRow';
import DeleteUnusedQuoteButton from '@/components/budgets/DeleteUnusedQuoteButton';
import PurchasingDates from '@/components/budgets/PurchasingDates';
import QuoteDropzone from './QuoteDropzone';
import PrivateSourceButton from './PrivateSourceButton';
import RemoveQuoteButton from './RemoveQuoteButton';
import { duplicateOf, replacedByQuote } from '@/lib/quoteDuplicates';
import { activeBudgets, budgetFigures } from '@/lib/purchasingCoreTwin';
import { statusWithDate, supplierReplyText } from '@/lib/purchasingDates';
import { jobProcurementRecords, paymentState } from '@/lib/purchasingViewModel';
import { etaDate } from '@/lib/purchasingSummary';
import { saveEtaTarget } from '@/lib/etaTarget';
import { quantityReviewLabel } from '@/lib/quantityReview';

const INK = '#101617', INK2 = '#566063', INK3 = '#34403F', RULE = '#EEE9E0', EDGE = '#E2DCD1';
const EYEBROW = 'text-[10px] font-semibold uppercase tracking-[0.12em]';
const BTN = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium no-underline disabled:opacity-60';
const SEC = { border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: INK3 };
const PRI = { border: '1px solid #0B3F3B', backgroundColor: '#0B3F3B', color: '#FFFFFF', fontWeight: 600 };
const TONES = {
  ok: { c: '#082F2C', bg: '#E2EEEB', b: '#C7E4D2' },
  warn: { c: '#6F4E10', bg: '#FAF0DA', b: '#EFDFB7' },
  bad: { c: '#A43432', bg: '#FCEDEC', b: '#F0C9C5' },
  plain: { c: INK2, bg: '#F3EFE7', b: EDGE },
};

const safeHref = (v) => { try { return v && new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; } };
const fileHref = (id) => (id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '');
const folderHref = (id) => (id ? `https://drive.google.com/drive/folders/${encodeURIComponent(id)}` : '');
const lineMoney = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function Chip({ tone = 'plain', children }) {
  const t = TONES[tone] || TONES.plain;
  return <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-[7px] px-2 text-[11.5px] font-semibold" style={{ color: t.c, backgroundColor: t.bg, border: `1px solid ${t.b}` }}>{children}</span>;
}
function Ref({ k, v }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[11.5px]" style={{ backgroundColor: '#F3EFE7', border: `1px solid ${EDGE}`, color: INK2 }}>
      {k}<span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 500, color: INK }}>{v}</span>
    </span>
  );
}
function NotesHistory({ notes }) {
  if (!notes) return null;
  return (
    <details className="text-[12px]" style={{ color: INK2 }}>
      <summary className="cursor-pointer font-semibold">Notes & history</summary>
      <p className="mt-1 whitespace-pre-line">{notes}</p>
    </details>
  );
}

// ---------- 1. Purchase orders & quotes ----------

// Marks a PO payable that already includes the supplier's sales tax, so job cost adds no use tax.
function POSalesTax({ po, onSaved }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function toggle(checked) {
    setBusy(true); setError('');
    try {
      await purchasingRequest({ action: 'po_sales_tax', po_id: po.id, includes_sales_tax: checked, expected_updated_date: po.updated_date, request_key: crypto.randomUUID(), review_confirmed: true });
      await onSaved?.(checked ? `${po.po_number} marked as including sales tax.` : `${po.po_number} now gets the use tax.`);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <SalesTaxBox checked={po.includes_sales_tax === true} disabled={busy || po.amount_dealer == null} onChange={toggle} />
      {error && <p className="mt-1 text-[13px] font-semibold" style={{ color: '#A43432' }}>{error}</p>}
    </>
  );
}

// One supplier confirmation inside an open PO line: ETA edits in place, payment and details.
function OrderDetail({ order, onEdit, onSaved }) {
  const pay = paymentState(order);
  const [etaBusy, setEtaBusy] = useState(false);
  const [etaError, setEtaError] = useState('');
  const etaEditable = Boolean(order.order_number) && order.amount != null && !order.received_date;
  async function saveEta(value) {
    if (etaBusy) return;
    setEtaBusy(true); setEtaError('');
    try {
      // Same path as the grid's ETA cell: writes the supplier record and moves its calendar event.
      const result = await saveEtaTarget({ jobId: order.job_id, order, date: value });
      if (result.error) setEtaError(result.error);
      if (result.saved) await onSaved?.();
    } finally { setEtaBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2 rounded-[10px] p-3" style={{ border: `1px solid ${RULE}`, backgroundColor: '#FFFFFF' }}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: INK }}>
        <span className="font-semibold">Order {order.order_number || '(no number)'}</span>
        <Chip tone="plain">{statusWithDate(order)}</Chip>
        <Chip tone={pay.label === 'Paid' ? 'ok' : pay.label === 'Unpaid' ? 'bad' : 'warn'}>Supplier {pay.label.toLowerCase()}</Chip>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]" style={{ color: INK3 }}>
        <span>Amount <strong className="tabular-nums" style={{ color: INK }}>{money(order.amount)}</strong></span>
        <label className="inline-flex items-center gap-1.5">ETA
          {etaEditable ? (
            <input type="date" aria-label={`ETA for supplier order ${order.order_number}`} disabled={etaBusy}
              value={order.eta_date || ''} onChange={(e) => saveEta(e.target.value)}
              className="h-8 rounded-[7px] border px-1.5 text-[13px] font-semibold" style={{ borderColor: EDGE, color: INK, backgroundColor: '#fff' }} />
          ) : <strong style={{ color: INK }}>{etaDate(order.eta_date) || 'Not confirmed'}</strong>}
        </label>
        <span>Received <strong style={{ color: INK }}>{etaDate(order.received_date) || '—'}</strong></span>
      </div>
      {order.supplier_eta ? <p className="text-[12px]" style={{ color: INK2 }}>{supplierReplyText(null, order)}</p> : null}
      {!order.purchase_order_id ? <p className="text-[12px]" style={{ color: INK2 }}>Not linked to a PO yet - link it before editing.</p> : null}
      {etaError ? <p className="text-[12px] font-semibold" style={{ color: '#A43432' }}>{etaError}</p> : null}
      <NotesHistory notes={order.notes} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onEdit({ mode: 'vendor_status', order_id: order.id })} className={BTN} style={SEC}>Record supplier payment</button>
        <button type="button" onClick={() => onEdit({ mode: 'supplier', order_id: order.id })} className={BTN} style={SEC}>Order details / link PO</button>
      </div>
    </div>
  );
}

// A PO line: the summary is always visible, Manage opens the PO's own actions.
function POLine({ po, budgets, orders, onEdit, onSaved, open, onToggle }) {
  const source = budgets.find((b) => b.id === po.budget_id);
  const related = orders.filter((o) => o.purchase_order_id === po.id);
  const quote = source?.quote_number || po.vendor_quote_ref || '';
  const etas = related.map((o) => o.eta_date).filter(Boolean).sort();
  const pays = related.map(paymentState);
  const pay = !pays.length ? null : pays.every((p) => p.label === 'Paid') ? 'ok' : 'bad';
  return (
    <div style={{ borderTop: `1px solid ${RULE}` }}>
      <Line supplier={po.vendor} refs={[['PO', po.po_number], ['Quote', quote], ...related.map((o) => ['Order', o.order_number])]}
        eta={etas[0]} amount={po.amount_dealer} pay={pay} cancelled={po.status === 'cancelled'} open={open} onToggle={onToggle} />
      {open && (
        <div className="flex flex-col gap-2.5 px-4 pb-4 pt-1" style={{ backgroundColor: '#FAF8F3' }}>
          <div className="flex flex-wrap items-center gap-2"><Chip tone="plain">PO {statusWithDate(po)}</Chip>{po.amount_customer != null ? <span className="text-[12.5px]" style={{ color: INK2 }}>Customer amount {money(po.amount_customer)}</span> : null}</div>
          {po.status !== 'cancelled' && <POSalesTax po={po} onSaved={onSaved} />}
          <PurchasingDates row={po} supplier={related[0] || null} showStatus={false} />
          <NotesHistory notes={po.notes} />
          {related.map((o) => <OrderDetail key={o.id} order={o} onEdit={onEdit} onSaved={onSaved} />)}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onEdit({ mode: 'po_status', po_id: po.id })} className={BTN} style={SEC}>Record PO status</button>
            {related.length === 0 ? <button type="button" onClick={() => onEdit({ mode: 'supplier', po_id: po.id })} className={BTN} style={SEC}>Record supplier confirmation</button> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderLine({ order, onEdit, onSaved, open, onToggle }) {
  const pay = paymentState(order);
  return (
    <div style={{ borderTop: `1px solid ${RULE}` }}>
      <Line supplier={order.vendor} refs={[['Order', order.order_number]]} eta={order.eta_date} amount={order.amount}
        pay={pay.label === 'Paid' ? 'ok' : pay.label === 'Unpaid' ? 'bad' : null} open={open} onToggle={onToggle} />
      {open && <div className="px-4 pb-4 pt-1" style={{ backgroundColor: '#FAF8F3' }}><OrderDetail order={order} onEdit={onEdit} onSaved={onSaved} /></div>}
    </div>
  );
}

const LINE_GRID = 'grid items-center gap-3 px-4 py-2.5 [grid-template-columns:minmax(96px,1fr)_minmax(0,2.6fr)_84px_104px_92px] max-[767px]:[grid-template-columns:1fr_auto]';
function Line({ supplier, refs, eta, amount, pay, cancelled, open, onToggle }) {
  const shown = refs.filter(([, v]) => v);
  return (
    <div className={LINE_GRID}>
      <span className="truncate text-[13.5px] font-semibold" style={{ color: supplier ? INK : INK2 }}>{supplier || 'Supplier not set'}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 max-[767px]:order-3 max-[767px]:col-span-2">
        {shown.length ? shown.map(([k, v], i) => <Ref key={`${k}${v}${i}`} k={k} v={v} />) : <span className="text-[12.5px]" style={{ color: INK2 }}>No PO or quote number yet</span>}
        {cancelled ? <Chip tone="plain">Cancelled</Chip> : null}
        {pay === 'bad' ? <Chip tone="bad">Supplier unpaid</Chip> : pay === 'ok' ? <Chip tone="ok">Supplier paid</Chip> : null}
      </span>
      <span className="whitespace-nowrap text-[13px] font-medium max-[767px]:hidden" style={{ color: INK }}>{etaDate(eta) || '—'}</span>
      <span className="text-right text-[13.5px] font-semibold tabular-nums max-[767px]:hidden" style={{ color: INK }}>{amount == null ? '—' : money(amount)}</span>
      <span className="text-right">
        <button type="button" onClick={onToggle} aria-expanded={open} className={BTN} style={{ ...SEC, height: 32 }}>{open ? 'Close' : 'Manage'}</button>
      </span>
    </div>
  );
}

// ---------- 2. Budget ----------

const chip = { ok: ['Included scope', 'ok'], warn: ['Needs review', 'warn'], draft: ['Draft', 'warn'], ref: ['Reference / replaced', 'plain'], unlinked: ['Needs a job', 'warn'] };
function budgetChip(b, active) {
  if (b.status === 'needs_review') return chip.warn;
  if (!b.job_id) return chip.unlinked;
  if (active) return chip.ok;
  if (b.budget_usage === 'draft') return chip.draft;
  return chip.ref;
}

// Saved versions that actually differ - identical re-saves are not history.
function distinctHistory(budget) {
  const seen = new Set([JSON.stringify(budget.inputs || {})]);
  return (budget.input_history || []).filter((h) => { const k = JSON.stringify(h.inputs || {}); if (seen.has(k)) return false; seen.add(k); return true; });
}

function QuoteLines({ budget }) {
  const lines = budget.quote?.lines;
  if (!Array.isArray(lines) || !lines.length) return null;
  return (
    <details>
      <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: INK2 }}>Quote line items ({lines.length})</summary>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full text-[12px] tabular-nums" style={{ color: INK }}>
          <thead><tr style={{ color: INK2 }}>{['Kind', 'Description', 'Qty', 'Unit', 'Extended'].map((h) => <th key={h} className="px-1.5 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx} style={{ borderTop: `1px solid ${RULE}` }}>
                <td className="px-1.5 py-1">{l.kind || '—'}</td>
                <td className="px-1.5 py-1">{l.description || l.desc || '—'}</td>
                <td className="px-1.5 py-1">{l.qty ?? '—'}</td>
                <td className="px-1.5 py-1">{lineMoney(l.unit_price)}</td>
                <td className="px-1.5 py-1">{lineMoney(l.extended)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function CostLine({ label, value, kind }) {
  const zero = num(value) === 0;
  const style = kind === 'total' ? { borderTop: '1px solid #CEC6B8', marginTop: 4, paddingTop: 8, fontWeight: 700, color: INK, fontSize: 14.5 }
    : kind === 'sub' ? { borderTop: '1px dashed #E2DCD1', fontWeight: 600, color: INK } : { color: zero ? '#616A6D' : INK3 };
  return <div className="flex min-h-[32px] items-center justify-between gap-4 text-[13.5px]" style={style}><span>{label}</span><span className="tabular-nums">{lineMoney(value)}</span></div>;
}

function BudgetCard({ budget, job, allBudgets, pos, editing, onEdit, onPreparePO, onSaved, editorPanel }) {
  const fig = budgetFigures(budget);
  const c = fig.calculated || {};
  const i = budget.inputs || {};
  const active = activeBudgets(allBudgets.filter((b) => b.job_id === budget.job_id)).some((b) => b.id === budget.id);
  // A job-money budget (no vendor quote yet, e.g. the Oct 24 move off the old money table):
  // sale and labor only - its windows cost comes from the PO, so no margin math is shown.
  const noQuote = num(i.material_true_cost) == null && !budget.quote_number && !budget.quote;
  // A second copy of the same quote, or a job-money placeholder a real quote has replaced:
  // flagged, with a Remove button below (the server re-checks nothing still uses it).
  const dupe = duplicateOf(budget, allBudgets);
  const stale = replacedByQuote(budget, allBudgets);
  const [chipText, chipTone] = dupe ? ['Possible duplicate', 'warn'] : stale ? ['Replaced by vendor quote', 'plain'] : noQuote ? ['Job money · no vendor quote', 'plain'] : budgetChip(budget, active);
  // No customer price typed yet: say that once, instead of a $0 sell, a negative margin
  // and an "under the suggested price" warning.
  const noSell = !(num(i.actual_total_sell) > 0);
  const warnings = fig.warnings.filter((w) => !(noSell && /customer sell/i.test(w)));
  const supplier = budget.vendor || budget.manufacturer || '';
  const sub = [supplier, budget.quote_number ? `Quote ${budget.quote_number}` : '', budget.openings_qty > 0 ? `${budget.openings_qty} unit${budget.openings_qty === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  const statusLine = dupe ? `Same quote as “${dupe.title || dupe.quote_number}”. Keep the right copy and remove the other.`
    : stale ? 'A vendor quote is now on this job. Remove this placeholder once that quote has your customer price.'
    : noQuote ? '' : warnings.length ? warnings[0] : budget.budget_usage === 'draft' ? 'Draft - review the numbers and your customer price, then include this scope.' : '';
  const sourceHref = safeHref(budget.source_pdf_url) || fileHref(budget.drive_quote_file_id);
  const privateSource = !sourceHref && /^[a-f0-9]{64}$/.test(budget.source_sha256 || '') ? budget.id : null;
  const fHref = safeHref(job?.drive_job_folder_url) || folderHref(job?.drive_job_folder_id || budget.drive_job_folder_id);
  const related = pos.filter((p) => p.budget_id === budget.id);
  const history = distinctHistory(budget);
  const sell = noSell ? null : num(i.actual_total_sell), total = num(c.total_cost_overhead), suggested = num(c.suggested_total_sell);
  const profit = sell != null && total != null ? sell - total : null;
  const scale = Math.max(sell || 0, suggested || 0, total || 0) || 1;
  const under = sell != null && suggested != null && sell < suggested - 0.005;
  const qty = quantityReviewLabel(budget);
  return (
    <div className="flex flex-col gap-3.5 rounded-[12px] p-4" style={{ border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF' }}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="break-words text-[14.5px] font-semibold" style={{ color: INK }}>{budget.title || budget.quote_name || 'Untitled quote'}</span>
          {sub ? <span className="text-[12.5px]" style={{ color: INK2 }}>{sub}{qty ? <span style={{ color: '#96490F' }}> · Quantity needs review</span> : null}</span> : null}
        </div>
        <Chip tone={chipTone}>{chipText}</Chip>
        {!editing && <button type="button" onClick={() => onEdit({ mode: 'numbers', budget_id: budget.id })} className={BTN} style={PRI}><Pencil className="h-3.5 w-3.5" />Edit numbers</button>}
      </div>
      {statusLine ? <p className="rounded-[9px] px-3 py-2 text-[12.5px] font-medium" style={{ backgroundColor: '#FAF0DA', border: '1px solid #EFDFB7', color: '#6F4E10' }}>{statusLine}</p> : null}
      {editing ? editorPanel : noQuote ? (
        <div className="flex flex-col gap-3">
          <div className="grid max-w-[460px] grid-cols-2 gap-2">
            {[['Customer sell', lineMoney(i.actual_total_sell)], ['Labor (sub pay)', lineMoney(i.labor_cost_sub_pay)]].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 rounded-[10px] p-3" style={{ backgroundColor: '#FAF8F3', border: `1px solid ${RULE}` }}>
                <span className="text-[11px] font-medium" style={{ color: INK2 }}>{k}</span>
                <span className="text-[17px] font-bold tabular-nums tracking-[-0.02em]">{v}</span>
              </div>
            ))}
          </div>
          <p className="text-[12.5px]" style={{ color: INK2 }}>No vendor quote on this job, so its windows cost comes from the PO above. Drop the supplier quote below to see the full cost build-up and margin.</p>
        </div>
      ) : (
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          <div className="flex flex-col">
            <span className={EYEBROW} style={{ color: INK2, paddingBottom: 4 }}>Cost build-up</span>
            <CostLine label="Material cost" value={i.material_true_cost} />
            <CostLine label="Use tax" value={c.use_tax} />
            <CostLine label="Material with overhead + tax" value={c.cost_material_tax} kind="sub" />
            <CostLine label="Labor (sub pay)" value={i.labor_cost_sub_pay} />
            <CostLine label="Additional install material" value={i.additional_install_material} />
            <CostLine label="Additional equipment" value={i.additional_equipment} />
            <CostLine label="Total cost with overhead" value={c.total_cost_overhead} kind="total" />
          </div>
          <div className="flex flex-col gap-3.5">
            <span className={EYEBROW} style={{ color: INK2 }}>Price & margin</span>
            <div className="grid grid-cols-3 gap-2">
              {[['Customer sell', noSell ? 'Not set' : lineMoney(sell), noSell ? INK2 : INK], ['Margin', noSell ? '—' : pct(c.actual_margin_pct), '#082F2C'], ['Suggested', lineMoney(suggested), INK3]].map(([k, v, color]) => (
                <div key={k} className="flex flex-col gap-0.5 rounded-[10px] p-3" style={{ backgroundColor: '#FAF8F3', border: `1px solid ${RULE}` }}>
                  <span className="text-[11px] font-medium" style={{ color: INK2 }}>{k}</span>
                  <span className="text-[17px] font-bold tabular-nums tracking-[-0.02em]" style={{ color }}>{v}</span>
                </div>
              ))}
            </div>
            {sell != null && total != null && (
              <div className="flex flex-col gap-2">
                <div className="flex h-3 overflow-hidden rounded-full" style={{ backgroundColor: '#E2EEEB' }} role="img" aria-label={`Cost ${lineMoney(total)}, profit ${lineMoney(profit)}`}>
                  <span style={{ width: `${(Math.min(total, sell) / scale) * 100}%`, backgroundColor: '#8C9EAF' }} />
                  <span style={{ width: `${(Math.max(profit, 0) / scale) * 100}%`, backgroundColor: '#0B3F3B' }} />
                </div>
                <div className="flex flex-wrap gap-3.5 text-[12px]" style={{ color: INK2 }}>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: '#8C9EAF' }} />Cost {lineMoney(total)}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: '#0B3F3B' }} />Margin after overhead {lineMoney(profit)}</span>
                </div>
              </div>
            )}
            {noSell ? <p className="text-[12.5px]" style={{ color: INK2 }}>No customer price yet. Use Edit numbers to add what you're charging and the margin fills in.</p> : null}
            {under ? <p className="rounded-[9px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: '#FAF0DA', border: '1px solid #EFDFB7', color: '#6F4E10' }}>Selling {lineMoney(suggested - sell)} under the suggested price.</p> : null}
          </div>
        </div>
      )}
      <QuoteLines budget={budget} />
      {history.length > 0 && (
        <details className="text-[12.5px]" style={{ color: INK2 }}>
          <summary className="cursor-pointer font-semibold">Earlier numbers ({history.length})</summary>
          {history.map((h, idx) => <p key={idx} className="mt-1">{h.at} · material {money(h.inputs?.material_true_cost)} · customer sell {money(h.inputs?.actual_total_sell)}</p>)}
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: `1px solid ${RULE}` }}>
        {budget.job_id ? <button type="button" onClick={() => onEdit({ mode: 'usage', budget_id: budget.id })} className={BTN} style={SEC}>Scope / revision</button> : null}
        {budget.job_id && active && fig.ready && !related.length ? <button type="button" onClick={() => onPreparePO(budget.id)} className={BTN} style={SEC}><Plus className="h-3.5 w-3.5" />Prepare PO</button> : null}
        {!budget.job_id ? <DeleteUnusedQuoteButton budget={budget} onDeleted={onSaved} /> : null}
        {budget.job_id && !related.length ? <RemoveQuoteButton budget={budget} duplicate={Boolean(dupe)} className={BTN} style={SEC} onRemoved={onSaved} /> : null}
        <span className="flex-1" />
        {sourceHref ? <a href={sourceHref} target="_blank" rel="noreferrer" className={BTN} style={SEC}>Vendor quote PDF<ArrowUpRight className="h-3.5 w-3.5" /></a> : null}
        {privateSource ? <PrivateSourceButton budgetId={privateSource} label="Vendor quote PDF" className={BTN} style={SEC} /> : null}
        {fHref ? <a href={fHref} target="_blank" rel="noreferrer" className={BTN} style={SEC}>Drive folder<ArrowUpRight className="h-3.5 w-3.5" /></a> : null}
      </div>
      {/* Scope / revision opens under the buttons; Edit numbers replaces the figures above. */}
      {!editing && editorPanel}
    </div>
  );
}

// ---------- The workspace ----------

export default function PurchasingJobWorkspace({ job, data, onSaved }) {
  const [editor, setEditor] = useState(null);
  const [openLine, setOpenLine] = useState(null);
  const rec = useMemo(() => jobProcurementRecords(data, job.id), [data, job.id]);
  const jobNameById = (id) => (data.jobs || []).find((j) => j.id === id)?.canonical_name || id;

  const openEditor = (next) => setEditor({ ...next, key: crypto.randomUUID() });
  const done = (_r, msg) => { setEditor(null); onSaved(msg); };
  const budgetDone = (r) => done(r, `Budget saved. ${r?.warnings?.join(' ') || 'Issued POs, invoices and recorded payments are unchanged.'}`);
  const preparePO = (budgetId) => openEditor({ mode: 'po', budget_id: budgetId, job_id: job.id });

  const currentBudget = editor?.budget_id ? rec.budgets.find((b) => b.id === editor.budget_id) : null;
  const currentPO = editor?.po_id ? rec.pos.find((p) => p.id === editor.po_id) : null;
  const currentOrder = editor?.order_id ? rec.orders.find((o) => o.id === editor.order_id) : null;

  const close = () => setEditor(null);
  const editorPanel = (ed) => ed && (
    <div key={ed.key}>
      {ed.mode === 'po' && <PurchaseOrderForm job={job} budgets={rec.budgets} initialBudget={currentBudget} onDone={done} onCancel={close} />}
      {ed.mode === 'usage' && currentBudget && <BudgetUsageForm budget={currentBudget} budgets={rec.budgets} onDone={budgetDone} onCancel={close} />}
      {ed.mode === 'numbers' && currentBudget && <NumbersEditor budget={currentBudget} onDone={budgetDone} hideRefill onCancel={close} />}
      {ed.mode === 'supplier' && <SupplierOrderForm jobs={[job]} purchaseOrders={rec.pos} initialJobId={job.id} initialPO={currentPO} order={currentOrder} onDone={done} onCancel={close} />}
      {ed.mode === 'po_status' && currentPO && <OrderStatusForm row={currentPO} onDone={done} onCancel={close} />}
      {ed.mode === 'vendor_status' && currentOrder && <OrderStatusForm row={currentOrder} supplier onDone={done} onCancel={close} />}
    </div>
  );

  const poIds = new Set(rec.pos.map((p) => p.id));
  const looseOrders = rec.orders.filter((o) => !o.purchase_order_id || !poIds.has(o.purchase_order_id));
  const hasLines = rec.pos.length + looseOrders.length > 0;
  const toggleLine = (key) => setOpenLine((k) => (k === key ? null : key));
  // Forms that are not about one budget (new PO, supplier confirmations, statuses) open under the list.
  const listEditor = editor && editor.mode !== 'numbers' && editor.mode !== 'usage' ? editorPanel(editor) : null;
  const budgetEditor = (b) => (editor && editor.budget_id === b.id && (editor.mode === 'numbers' || editor.mode === 'usage') ? editorPanel(editor) : null);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <section className="flex flex-col gap-2" aria-label="Purchase orders and quotes">
        <div className="flex flex-wrap items-center gap-2">
          <span className={EYEBROW} style={{ color: INK2 }}>Purchase orders & quotes</span>
          <span className="flex-1" />
          <button type="button" onClick={() => openEditor({ mode: 'po', job_id: job.id })} className={BTN} style={{ ...SEC, height: 32 }}><Plus className="h-3.5 w-3.5" />Prepare PO</button>
          <button type="button" onClick={() => openEditor({ mode: 'supplier', job_id: job.id })} className={BTN} style={{ ...SEC, height: 32 }}><Plus className="h-3.5 w-3.5" />Record confirmation</button>
        </div>
        {hasLines ? (
          <div className="overflow-hidden rounded-[10px]" style={{ border: `1px solid ${RULE}` }}>
            <div className={`${LINE_GRID} max-[767px]:hidden`} style={{ backgroundColor: '#FAF8F3', paddingTop: 7, paddingBottom: 7 }}>
              {['Supplier', 'PO · quote · order', 'ETA', 'Supplier payable', ''].map((h, idx) => <span key={idx} className={`text-[10.5px] font-semibold uppercase tracking-[0.06em] ${idx === 3 ? 'text-right' : ''}`} style={{ color: INK2 }}>{h}</span>)}
            </div>
            {rec.pos.map((p) => <POLine key={p.id} po={p} budgets={rec.budgets} orders={rec.orders} onEdit={openEditor} onSaved={onSaved} open={openLine === `po:${p.id}`} onToggle={() => toggleLine(`po:${p.id}`)} />)}
            {looseOrders.map((o) => <OrderLine key={o.id} order={o} onEdit={openEditor} onSaved={onSaved} open={openLine === `o:${o.id}`} onToggle={() => toggleLine(`o:${o.id}`)} />)}
          </div>
        ) : <p className="rounded-[10px] px-3 py-3 text-[13px]" style={{ border: `1px solid ${RULE}`, backgroundColor: '#FAF8F3', color: INK2 }}>No purchase orders or supplier confirmations yet.</p>}
        {listEditor}
        {rec.conflicts.length > 0 && (
          <details className="rounded-[10px] p-2.5 text-[12.5px]" style={{ border: '1px solid #EFDFB7', backgroundColor: '#FAF0DA', color: '#6F4E10' }} open>
            <summary className="cursor-pointer font-semibold">{rec.conflicts.length} PO reference conflict{rec.conflicts.length === 1 ? '' : 's'} - review before linking</summary>
            {rec.conflicts.map((c) => (
              <p key={c.number} className="mt-1"><strong>{c.number}</strong> appears against {c.job_ids.map((id, idx) => <span key={id}>{idx ? ' / ' : ''}<Link className="underline" to={`/jobs/${id}`}>{jobNameById(id)}</Link></span>)}. Original records are kept; nothing is cross-linked automatically.</p>
            ))}
          </details>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Budget">
        <span className={EYEBROW} style={{ color: INK2 }}>Budget</span>
        {rec.budgets.length === 0 ? <p className="text-[13px]" style={{ color: INK2 }}>No vendor quote attached yet. Add the supplier quote below to build the cost and margin.</p> : null}
        {rec.budgets.map((b) => (
          <BudgetCard key={b.id} budget={b} job={job} allBudgets={rec.budgets} pos={rec.pos} editing={editor?.mode === 'numbers' && editor.budget_id === b.id}
            onEdit={openEditor} onPreparePO={preparePO} onSaved={onSaved} editorPanel={budgetEditor(b)} />
        ))}
      </section>

      <div className="rounded-[12px] p-2" style={{ border: '1.5px dashed #CEC6B8', backgroundColor: '#FAF8F3' }}>
        <QuoteDropzone jobId={job.id} onDone={onSaved} />
      </div>
    </div>
  );
}
