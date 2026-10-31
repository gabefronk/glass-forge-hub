// The one per-job purchasing workspace: opens in place beneath a Purchasing row,
// and is the whole Budget & Orders page for a job (pages/Procurement.jsx).
// Redesign (Gabriel, Oct 24): one page, no section switcher, nothing said twice.
//   1. Purchase orders & quotes - one line per PO / supplier order with its PO,
//      quote and order numbers, ETA and cost (money out; suppliers are paid up front,
//      so there is no payment tracking). Manage opens that line's forms (status,
//      confirmation, ETA).
//   2. Budget - each quote budget's cost build-up and price & margin. Edit numbers
//      is the one place job money is changed (the budget is the source). Budget use
//      (counted / draft / reference / replaces) is a dropdown on the card (Oct 30).
//   3. Job files: vendor quote PDFs (private) and everything else to the job's Drive
//      folder, plus the Drive folder menu (JobFilesPanel).
// Reuses the existing native procurement forms (PurchaseOrderForm,
// SupplierOrderForm, OrderStatusForm, NumbersEditor, DeleteUnusedQuoteButton) and the
// shared procurement service validation. Same-job records are filtered by EXACT
// immutable job id (jobProcurementRecords) - never a name join. Editor records are
// looked up from rec.* (this job only), so a record from another job can never load.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Pencil, Plus, Send } from 'lucide-react';
import {
  money, purchasingRequest, messageOf,
  PurchaseOrderForm, SupplierOrderForm, OrderStatusForm,
} from '@/components/budgets/ProcurementForms';
import { NumbersEditor } from '@/components/budgets/BudgetReviewRow';
import DeleteUnusedQuoteButton from '@/components/budgets/DeleteUnusedQuoteButton';
import PurchasingDates from '@/components/budgets/PurchasingDates';
import JobFilesPanel from './JobFilesPanel';
import OrderEmailPanel from './OrderEmailPanel';
import PrivateSourceButton from './PrivateSourceButton';
import RemoveQuoteButton from './RemoveQuoteButton';
import { duplicateOf, replacedByQuote } from '@/lib/quoteDuplicates';
import { activeBudgets, budgetFigures, budgetVersion } from '@/lib/purchasingCoreTwin';
import { statusWithDate } from '@/lib/purchasingDates';
import { jobProcurementRecords } from '@/lib/purchasingViewModel';
import { etaDate } from '@/lib/purchasingSummary';
import EtaEditor from './EtaEditor';
import { quantityReviewLabel } from '@/lib/quantityReview';

const INK = '#101617', INK2 = '#566063', INK3 = '#34403F', RULE = '#EEE9E0', EDGE = '#E2DCD1';
const EYEBROW = 'text-[13px] font-semibold uppercase tracking-[0.08em]';
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
const lineMoney = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function Chip({ tone = 'plain', children }) {
  const t = TONES[tone] || TONES.plain;
  return <span className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-[7px] px-2 text-[13px] font-semibold" style={{ color: t.c, backgroundColor: t.bg, border: `1px solid ${t.b}` }}>{children}</span>;
}
function Ref({ k, v }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[13px]" style={{ backgroundColor: '#F3EFE7', border: `1px solid ${EDGE}`, color: INK2 }}>
      {k}<span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 500, color: INK }}>{v}</span>
    </span>
  );
}
function NotesHistory({ notes }) {
  if (!notes) return null;
  return (
    <details className="text-[13px]" style={{ color: INK2 }}>
      <summary className="cursor-pointer font-semibold">Notes & history</summary>
      <p className="mt-1 whitespace-pre-line">{notes}</p>
    </details>
  );
}

// ---------- 1. Purchase orders & quotes ----------

function OrderDetail({ order, onEdit, onSaved }) {
  const etaEditable = Boolean(order.order_number) && order.amount != null && !order.received_date;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] p-3" style={{ border: `1px solid ${RULE}`, backgroundColor: '#FFFFFF' }}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: INK }}>
        <span className="font-semibold">Order {order.order_number || '(no number)'}</span>
        <Chip tone="plain">{statusWithDate(order)}</Chip>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]" style={{ color: INK3 }}>
        <span>Cost <strong className="tabular-nums" style={{ color: INK }}>{order.amount == null || order.amount === '' ? '—' : money(0 - Number(order.amount))}</strong></span>
        {etaEditable ? null : <span>ETA <strong style={{ color: INK }}>{etaDate(order.eta_date) || 'Not confirmed'}</strong></span>}
        <span>Received <strong style={{ color: INK }}>{etaDate(order.received_date) || '—'}</strong></span>
      </div>
      {/* Same editor as the grid's ETA cell: writes the supplier record and moves its calendar event(s). */}
      {etaEditable ? <EtaEditor key={`${order.id}:${order.updated_date}`} inline jobId={order.job_id} order={order} date={order.eta_date || ''} onSaved={onSaved} /> : null}
      {!order.purchase_order_id ? <p className="text-[13px]" style={{ color: INK2 }}>Not linked to a PO yet - link it before editing.</p> : null}
      <NotesHistory notes={order.notes} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onEdit({ mode: 'vendor_status', order_id: order.id })} className={BTN} style={SEC}>Record order status</button>
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
  const emailOrder = () => onEdit({ mode: 'email', po_id: po.id });
  // Until the order email has gone out, it is one click from the row (Gabriel, Oct 30).
  const emailAction = po.status === 'issued' && po.order_email_status !== 'sent'
    ? <button type="button" onClick={emailOrder} className={BTN} style={{ ...PRI, height: 32 }}><Send className="h-3.5 w-3.5" />Email order</button> : null;
  return (
    <div style={{ borderTop: `1px solid ${RULE}` }}>
      <Line supplier={po.vendor} refs={[['PO', po.po_number], ['Quote', quote], ...related.map((o) => ['Order', o.order_number])]}
        eta={etas[0]} amount={po.amount_dealer} cancelled={po.status === 'cancelled'} open={open} onToggle={onToggle} action={emailAction} />
      {open && (
        <div className="flex flex-col gap-2.5 px-4 pb-4 pt-1" style={{ backgroundColor: '#FAF8F3' }}>
          <div className="flex flex-wrap items-center gap-2"><Chip tone="plain">PO {statusWithDate(po)}</Chip>{po.amount_customer != null ? <span className="text-[13px]" style={{ color: INK2 }}>Customer amount {money(po.amount_customer)}</span> : null}</div>
          {po.order_email_status ? (
            <p className="text-[13px]" style={{ color: INK2 }}>
              Order email {po.order_email_status === 'sent' ? 'sent' : 'saved as an Outlook draft'} {etaDate(String(po.order_email_at || '').slice(0, 10))} to {(po.order_email_to || []).join(', ')}.
              {safeHref(po.order_email_ref) ? <> <a href={po.order_email_ref} target="_blank" rel="noreferrer" className="font-semibold underline">Open in Outlook</a></> : null}
            </p>
          ) : null}
          <PurchasingDates row={po} supplier={related[0] || null} showStatus={false} />
          <NotesHistory notes={po.notes} />
          {related.map((o) => <OrderDetail key={o.id} order={o} onEdit={onEdit} onSaved={onSaved} />)}
          <div className="flex flex-wrap gap-2">
            {po.status !== 'cancelled' ? <button type="button" onClick={emailOrder} className={BTN} style={SEC}><Send className="h-3.5 w-3.5" />{po.order_email_status === 'sent' ? 'Email order again' : 'Email order'}</button> : null}
            <button type="button" onClick={() => onEdit({ mode: 'po_status', po_id: po.id })} className={BTN} style={SEC}>Record PO status</button>
            {related.length === 0 ? <button type="button" onClick={() => onEdit({ mode: 'supplier', po_id: po.id })} className={BTN} style={SEC}>Record supplier confirmation</button> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderLine({ order, onEdit, onSaved, open, onToggle }) {
  return (
    <div style={{ borderTop: `1px solid ${RULE}` }}>
      <Line supplier={order.vendor} refs={[['Order', order.order_number]]} eta={order.eta_date} amount={order.amount}
        open={open} onToggle={onToggle} />
      {open && <div className="px-4 pb-4 pt-1" style={{ backgroundColor: '#FAF8F3' }}><OrderDetail order={order} onEdit={onEdit} onSaved={onSaved} /></div>}
    </div>
  );
}

const LINE_GRID = 'grid items-center gap-3 px-4 py-2.5 [grid-template-columns:minmax(96px,1fr)_minmax(0,2.6fr)_84px_104px_minmax(92px,auto)] max-[767px]:[grid-template-columns:1fr_auto]';
function Line({ supplier, refs, eta, amount, cancelled, open, onToggle, action = null }) {
  const shown = refs.filter(([, v]) => v);
  return (
    <div className={LINE_GRID}>
      <span className="truncate text-[13.5px] font-semibold" style={{ color: supplier ? INK : INK2 }}>{supplier || 'Supplier not set'}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 max-[767px]:order-3 max-[767px]:col-span-2">
        {shown.length ? shown.map(([k, v], i) => <Ref key={`${k}${v}${i}`} k={k} v={v} />) : <span className="text-[13px]" style={{ color: INK2 }}>No PO or quote number yet</span>}
        {cancelled ? <Chip tone="plain">Cancelled</Chip> : null}
      </span>
      <span className="whitespace-nowrap text-[13px] font-medium max-[767px]:hidden" style={{ color: INK }}>{etaDate(eta) || '—'}</span>
      <span className="text-right text-[13.5px] font-semibold tabular-nums max-[767px]:hidden" style={{ color: INK }}>{amount == null || amount === '' ? '—' : money(0 - Number(amount))}</span>
      <span className="flex justify-end gap-2">
        {action}
        <button type="button" onClick={onToggle} aria-expanded={open} className={BTN} style={{ ...SEC, height: 32 }}>{open ? 'Close' : 'Manage'}</button>
      </span>
    </div>
  );
}

// ---------- 2. Budget ----------

const chip = { ok: ['Counted in budget', 'ok'], warn: ['Needs review', 'warn'], draft: ['Draft', 'warn'], ref: ['Reference / replaced', 'plain'], unlinked: ['Needs a job', 'warn'] };
function budgetChip(b, active) {
  // "Needs review" is settled once the numbers on a quote that is on a job have been
  // reviewed and saved (the save also clears it on the record).
  if (b.status === 'needs_review' && !(b.job_id && b.numbers_reviewed_at)) return chip.warn;
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

// Budget use, saved as soon as it is picked: counted (alone or replacing an earlier quote on
// this job), draft or reference. Same budget_usage action and checks as before.
function BudgetUseSelect({ budget, budgets, onSaved }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const others = budgets.filter((b) => b.id !== budget.id && b.job_id === budget.job_id);
  const value = budget.budget_usage === 'draft' || budget.budget_usage === 'reference' ? budget.budget_usage
    : budget.replaces_budget_id ? `replaces:${budget.replaces_budget_id}` : 'included';
  async function choose(next) {
    if (busy || next === value) return;
    const [usage, replaces] = next.startsWith('replaces:') ? ['included', next.slice(9)] : [next, ''];
    setBusy(true); setError('');
    try {
      const r = await purchasingRequest({ action: 'budget_usage', budget_id: budget.id, budget_version: budgetVersion(budget), budget_usage: usage, replaces_budget_id: replaces, review_confirmed: true, request_key: crypto.randomUUID() });
      onSaved?.(usage === 'included' ? 'Counted in the budget. You can prepare its PO now.' : r?.message);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return (
    <label className="inline-flex flex-wrap items-center gap-2 text-[13px] font-medium" style={{ color: INK2 }}
      title="Counted quotes make up the budget and can be ordered. A replacement leaves the earlier quote out of the totals; its files, numbers and POs stay in history.">
      Budget use
      <select value={value} disabled={busy} onChange={(e) => choose(e.target.value)} className="h-9 rounded-[9px] border bg-white px-2 text-[13px] font-semibold" style={{ borderColor: EDGE, color: INK }}>
        <option value="included">Counted in budget</option>
        {others.map((o) => <option key={o.id} value={`replaces:${o.id}`}>Counted · replaces {o.title || o.quote_number || 'earlier quote'}</option>)}
        <option value="draft">Draft · not counted</option>
        <option value="reference">Reference only</option>
      </select>
      {error ? <span role="alert" className="font-semibold" style={{ color: '#A43432' }}>{error}</span> : null}
    </label>
  );
}

function QuoteLines({ budget }) {
  const lines = budget.quote?.lines;
  if (!Array.isArray(lines) || !lines.length) return null;
  return (
    <details>
      <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: INK2 }}>Quote line items ({lines.length})</summary>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums" style={{ color: INK }}>
          <thead><tr style={{ color: INK2 }}>{['Kind', 'Description', 'Qty', 'Unit', 'Extended'].map((h, idx) => <th key={h} className={`px-1.5 py-1 font-semibold ${idx >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx} style={{ borderTop: `1px solid ${RULE}` }}>
                <td className="px-1.5 py-1">{l.kind || '—'}</td>
                <td className="px-1.5 py-1">{l.description || l.desc || '—'}</td>
                <td className="px-1.5 py-1 text-right">{l.qty ?? '—'}</td>
                <td className="px-1.5 py-1 text-right">{lineMoney(l.unit_price)}</td>
                <td className="px-1.5 py-1 text-right">{lineMoney(l.extended)}</td>
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

function BudgetCard({ budget, allBudgets, pos, editing, onEdit, onPreparePO, onSaved, editorPanel }) {
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
    : noQuote ? '' : warnings.length ? warnings[0]
    : budget.budget_usage === 'draft' ? 'Draft: set Budget use to “Counted in budget” below to order it. Saving your numbers does this for a job’s only quote.' : '';
  const sourceHref = safeHref(budget.source_pdf_url) || fileHref(budget.drive_quote_file_id);
  const privateSource = !sourceHref && /^[a-f0-9]{64}$/.test(budget.source_sha256 || '') ? budget.id : null;
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
          {sub ? <span className="text-[13px]" style={{ color: INK2 }}>{sub}{qty ? <span style={{ color: '#96490F' }}> · Quantity needs review</span> : null}</span> : null}
        </div>
        <Chip tone={chipTone}>{chipText}</Chip>
        {!editing && <button type="button" onClick={() => onEdit({ mode: 'numbers', budget_id: budget.id })} className={BTN} style={PRI}><Pencil className="h-3.5 w-3.5" />Edit numbers</button>}
      </div>
      {statusLine ? <p className="rounded-[9px] px-3 py-2 text-[13px] font-medium" style={{ backgroundColor: '#FAF0DA', border: '1px solid #EFDFB7', color: '#6F4E10' }}>{statusLine}</p> : null}
      {editing ? editorPanel : noQuote ? (
        <div className="flex flex-col gap-3">
          <div className="grid max-w-[460px] grid-cols-2 gap-2">
            {[['Customer sell', lineMoney(i.actual_total_sell)], ['Labor (sub pay)', lineMoney(i.labor_cost_sub_pay)]].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 rounded-[10px] p-3" style={{ backgroundColor: '#FAF8F3', border: `1px solid ${RULE}` }}>
                <span className="text-[13px] font-medium" style={{ color: INK2 }}>{k}</span>
                <span className="text-[17px] font-bold tabular-nums tracking-[-0.02em]">{v}</span>
              </div>
            ))}
          </div>
          <p className="text-[13px]" style={{ color: INK2 }}>No vendor quote on this job, so its windows cost comes from the PO above. Drop the supplier quote below to see the full cost build-up and margin.</p>
        </div>
      ) : (
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          <div className="flex flex-col">
            <span className={EYEBROW} style={{ color: INK2, paddingBottom: 4 }}>Cost build-up</span>
            {/* No overhead is added (Gabriel, Oct 30): his sub pay already covers it. */}
            <CostLine label="Material cost" value={i.material_true_cost} />
            <CostLine label="Labor (sub pay)" value={i.labor_cost_sub_pay} />
            <CostLine label="Additional install material" value={i.additional_install_material} />
            <CostLine label="Additional equipment" value={i.additional_equipment} />
            <CostLine label="Total cost" value={c.total_cost_overhead} kind="total" />
          </div>
          <div className="flex flex-col gap-3.5">
            <span className={EYEBROW} style={{ color: INK2 }}>Price & margin</span>
            <div className="grid grid-cols-3 gap-2">
              {[['Customer sell', noSell ? 'Not set' : lineMoney(sell), noSell ? INK2 : INK], ['Margin', noSell ? '—' : pct(c.actual_margin_pct), '#082F2C'], ['Suggested', lineMoney(suggested), INK3]].map(([k, v, color]) => (
                <div key={k} className="flex flex-col gap-0.5 rounded-[10px] p-3" style={{ backgroundColor: '#FAF8F3', border: `1px solid ${RULE}` }}>
                  <span className="text-[13px] font-medium" style={{ color: INK2 }}>{k}</span>
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
                <div className="flex flex-wrap gap-3.5 text-[13px]" style={{ color: INK2 }}>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: '#8C9EAF' }} />Cost {lineMoney(total)}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: '#0B3F3B' }} />Margin {lineMoney(profit)}</span>
                </div>
              </div>
            )}
            {noSell ? <p className="text-[13px]" style={{ color: INK2 }}>No customer price yet. Use Edit numbers to add what you're charging and the margin fills in.</p> : null}
            {under ? <p className="rounded-[9px] px-3 py-2 text-[13px]" style={{ backgroundColor: '#FAF0DA', border: '1px solid #EFDFB7', color: '#6F4E10' }}>Selling {lineMoney(suggested - sell)} under the suggested price.</p> : null}
          </div>
        </div>
      )}
      <QuoteLines budget={budget} />
      {history.length > 0 && (
        <details className="text-[13px]" style={{ color: INK2 }}>
          <summary className="cursor-pointer font-semibold">Earlier numbers ({history.length})</summary>
          {history.map((h, idx) => <p key={idx} className="mt-1">{h.at} · material {money(h.inputs?.material_true_cost)} · customer sell {money(h.inputs?.actual_total_sell)}</p>)}
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: `1px solid ${RULE}` }}>
        {budget.job_id ? <BudgetUseSelect budget={budget} budgets={allBudgets} onSaved={onSaved} /> : null}
        {budget.job_id && active && fig.ready && !related.length ? <button type="button" onClick={() => onPreparePO(budget.id)} className={BTN} style={SEC}><Plus className="h-3.5 w-3.5" />Prepare PO</button> : null}
        {!budget.job_id ? <DeleteUnusedQuoteButton budget={budget} onDeleted={(_r, msg) => onSaved?.(msg)} /> : null}
        {budget.job_id && !related.length ? <RemoveQuoteButton budget={budget} duplicate={Boolean(dupe)} className={BTN} style={SEC} onRemoved={onSaved} /> : null}
        <span className="flex-1" />
        {sourceHref ? <a href={sourceHref} target="_blank" rel="noreferrer" className={BTN} style={SEC}>Vendor quote PDF<ArrowUpRight className="h-3.5 w-3.5" /></a> : null}
        {privateSource ? <PrivateSourceButton budgetId={privateSource} label="Vendor quote PDF" className={BTN} style={SEC} /> : null}
      </div>
      {/* Edit numbers replaces the figures above. The job's Drive folder is under Job files. */}
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
  const budgetDone = (r) => done(r, `Budget saved.${r?.budget?.budget_usage === 'included' ? ' Counted in the budget.' : ''} ${r?.warnings?.join(' ') || 'Issued POs, invoices and recorded payments are unchanged.'}`);
  const preparePO = (budgetId) => openEditor({ mode: 'po', budget_id: budgetId, job_id: job.id });

  const currentBudget = editor?.budget_id ? rec.budgets.find((b) => b.id === editor.budget_id) : null;
  const currentPO = editor?.po_id ? rec.pos.find((p) => p.id === editor.po_id) : null;
  const currentOrder = editor?.order_id ? rec.orders.find((o) => o.id === editor.order_id) : null;

  const close = () => setEditor(null);
  const editorPanel = (ed) => ed && (
    <div key={ed.key}>
      {ed.mode === 'po' && <PurchaseOrderForm job={job} budgets={rec.budgets} purchaseOrders={rec.pos} initialBudget={currentBudget} onDone={done} onCancel={close} />}
      {ed.mode === 'numbers' && currentBudget && <NumbersEditor budget={currentBudget} onDone={budgetDone} hideRefill onCancel={close} />}
      {ed.mode === 'supplier' && <SupplierOrderForm jobs={[job]} purchaseOrders={rec.pos} initialJobId={job.id} initialPO={currentPO} order={currentOrder} onDone={done} onCancel={close} />}
      {ed.mode === 'po_status' && currentPO && <OrderStatusForm row={currentPO} onDone={done} onCancel={close} />}
      {ed.mode === 'email' && currentPO && <OrderEmailPanel po={currentPO} onDone={done} onCancel={close} />}
      {ed.mode === 'vendor_status' && currentOrder && <OrderStatusForm row={currentOrder} supplier onDone={done} onCancel={close} />}
    </div>
  );

  const poIds = new Set(rec.pos.map((p) => p.id));
  const looseOrders = rec.orders.filter((o) => !o.purchase_order_id || !poIds.has(o.purchase_order_id));
  const hasLines = rec.pos.length + looseOrders.length > 0;
  const toggleLine = (key) => setOpenLine((k) => (k === key ? null : key));
  // Forms that are not about one budget (new PO, supplier confirmations, statuses) open under the list.
  const listEditor = editor && editor.mode !== 'numbers' ? editorPanel(editor) : null;
  const budgetEditor = (b) => (editor && editor.budget_id === b.id && editor.mode === 'numbers' ? editorPanel(editor) : null);

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
              {['Supplier', 'PO · quote · order', 'ETA', 'Cost', ''].map((h, idx) => <span key={idx} className={`text-[13px] font-semibold uppercase tracking-[0.04em] ${idx === 3 ? 'text-right' : ''}`} style={{ color: INK2 }}>{h}</span>)}
            </div>
            {rec.pos.map((p) => <POLine key={p.id} po={p} budgets={rec.budgets} orders={rec.orders} onEdit={openEditor} onSaved={onSaved} open={openLine === `po:${p.id}`} onToggle={() => toggleLine(`po:${p.id}`)} />)}
            {looseOrders.map((o) => <OrderLine key={o.id} order={o} onEdit={openEditor} onSaved={onSaved} open={openLine === `o:${o.id}`} onToggle={() => toggleLine(`o:${o.id}`)} />)}
          </div>
        ) : <p className="rounded-[10px] px-3 py-3 text-[13px]" style={{ border: `1px solid ${RULE}`, backgroundColor: '#FAF8F3', color: INK2 }}>No purchase orders or supplier confirmations yet.</p>}
        {listEditor}
        {rec.conflicts.length > 0 && (
          <details className="rounded-[10px] p-2.5 text-[13px]" style={{ border: '1px solid #EFDFB7', backgroundColor: '#FAF0DA', color: '#6F4E10' }} open>
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
          <BudgetCard key={b.id} budget={b} allBudgets={rec.budgets} pos={rec.pos} editing={editor?.mode === 'numbers' && editor.budget_id === b.id}
            onEdit={openEditor} onPreparePO={preparePO} onSaved={onSaved} editorPanel={budgetEditor(b)} />
        ))}
      </section>

      <JobFilesPanel job={job} onSaved={onSaved} />
    </div>
  );
}
