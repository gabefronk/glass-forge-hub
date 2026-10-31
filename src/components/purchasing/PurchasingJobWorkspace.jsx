// The one per-job purchasing workspace: opens in place beneath a Purchasing row,
// and is the whole Budget & Orders page for a job (pages/Procurement.jsx).
// One ruled sheet (Gabriel, Oct 31), nothing said twice, options in dropdowns:
//   1. Orders - one table line per PO / supplier order (PO, quote, order, status, ETA,
//      cost as money out; suppliers are paid up front) with a total row. A reorder or
//      remake shows its reason under the line. Click a line for its details and ETA;
//      its ⋯ menu holds the line's forms. The Add menu prepares a PO, records a supplier
//      confirmation, uploads files or links the Drive folder.
//   2. Budget - each quote budget as a ruled table (cost lines, total, sell, margin).
//      Edit numbers is the one place job money is changed. Budget use (counted / draft /
//      reference / replaces) is a dropdown on the card (Oct 30). A job with no vendor
//      quote shows its typed Budget cost / Customer total, which drive Purchasing.
//   3. Files - the Drive folder, its files and a drop target on one line (JobFilesPanel).
// Reuses the existing native procurement forms (PurchaseOrderForm, SupplierOrderForm,
// OrderStatusForm, NumbersEditor) and the shared procurement service validation.
// Same-job records are filtered by EXACT immutable job id (jobProcurementRecords) -
// never a name join. Editor records are looked up from rec.* (this job only), so a
// record from another job can never load.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, ChevronRight, FileText, MoreHorizontal, Pencil, Plus, Send } from 'lucide-react';
import {
  money, purchasingRequest, messageOf,
  PurchaseOrderForm, SupplierOrderForm, OrderStatusForm,
} from '@/components/budgets/ProcurementForms';
import { NumbersEditor } from '@/components/budgets/BudgetReviewRow';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import JobFilesPanel from './JobFilesPanel';
import InvoicePanel, { PrintedInvoices, useJobInvoices } from './InvoicePanel';
import OrderEmailPanel from './OrderEmailPanel';
import { openPrivateSource } from './PrivateSourceButton';
import { removeJobQuote } from './RemoveQuoteButton';
import { duplicateOf, replacedByQuote } from '@/lib/quoteDuplicates';
import { activeBudgets, budgetFigures, budgetVersion } from '@/lib/purchasingCoreTwin';
import { displayDate, originalOrderDate, statusLabel, statusWithDate } from '@/lib/purchasingDates';
import { jobProcurementRecords } from '@/lib/purchasingViewModel';
import { etaDate } from '@/lib/purchasingSummary';
import { orderLines, sheetTotal, typedBudget } from '@/lib/budgetOrdersSheet';
import EtaEditor from './EtaEditor';
import { quantityReviewLabel } from '@/lib/quantityReview';

const INK = '#101617', INK2 = '#566063', INK3 = '#34403F', RULE = '#EEE9E0', EDGE = '#E2DCD1';
const OPEN_BG = '#F4F8F7', HEAD_BG = '#FAF8F3', TOTAL_RULE = '#9A9080';
const BTN = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium no-underline disabled:opacity-60';
const SEC = { border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: INK3 };
const PRI = { border: '1px solid #0B3F3B', backgroundColor: '#0B3F3B', color: '#FFFFFF', fontWeight: 600 };
const HEAD = 'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5';
const ITEM = 'flex min-h-9 cursor-pointer items-center justify-between gap-6 text-[14px]';
const TONES = {
  ok: { c: '#082F2C', bg: '#E2EEEB', b: '#C7E4D2' },
  warn: { c: '#6F4E10', bg: '#FAF0DA', b: '#EFDFB7' },
  plain: { c: INK3, bg: '#F3EFE7', b: EDGE },
};

const safeHref = (v) => { try { return v && new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; } };
const fileHref = (id) => (id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '');
const lineMoney = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const outMoney = (v) => (v == null || v === '' ? '—' : lineMoney(0 - Number(v)));
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const stop = (e) => e.stopPropagation();

function Chip({ tone = 'plain', children }) {
  const t = TONES[tone] || TONES.plain;
  return <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-[6px] px-1.5 text-[13px] font-semibold" style={{ color: t.c, backgroundColor: t.bg, border: `1px solid ${t.b}` }}>{children}</span>;
}

function SectionHead({ title, note, children }) {
  return (
    <div className={HEAD} style={{ backgroundColor: HEAD_BG }}>
      <h3 className="text-[15px] font-semibold" style={{ color: INK }}>{title}</h3>
      {note ? <span className="text-[13.5px]" style={{ color: INK3 }}>{note}</span> : null}
      <span className="flex-1" />
      {children}
    </div>
  );
}

// A dropdown of actions. Menu clicks must not reach the row underneath (React bubbles
// through the portal), or choosing an item would also open or close the row.
function ActionMenu({ items, label, trigger }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger || (
          <button type="button" aria-label={label} title={label} onClick={stop} onKeyDown={stop}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-black/5 disabled:opacity-60" style={{ color: INK3 }}>
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px] p-1" onClick={stop}>
        {shown.map((it) => (
          it.href ? (
            <DropdownMenuItem key={it.label} asChild className={ITEM}>
              <a href={it.href} target="_blank" rel="noreferrer">{it.label}<ArrowUpRight className="h-4 w-4" /></a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={it.label} className={ITEM} onSelect={it.onSelect} style={it.danger ? { color: '#A43432' } : undefined}>{it.label}</DropdownMenuItem>
          )
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------- 1. Orders ----------

// Desktop: chevron · supplier · PO · quote · order · status · ETA · cost · menu.
// Phone: chevron · PO · cost · menu (the rest is in the line's details).
const GRID = 'grid items-center gap-x-3 px-4 [grid-template-columns:16px_minmax(64px,0.8fr)_minmax(112px,1fr)_minmax(72px,0.8fr)_minmax(88px,0.9fr)_minmax(120px,1.3fr)_76px_96px_32px] max-[767px]:[grid-template-columns:16px_minmax(0,1fr)_auto_32px]';
const WIDE = 'max-[767px]:hidden';
const MONO = { fontFamily: 'var(--font-mono)', fontSize: '13px', color: INK };

function Facts({ rows }) {
  return (
    <dl className="grid max-w-[760px] gap-x-5 gap-y-1 text-[13.5px] [grid-template-columns:max-content_minmax(0,1fr)]">
      {rows.filter(Boolean).map(([k, v, phoneOnly]) => (
        <div key={k} className="contents">
          <dt className={phoneOnly ? 'min-[768px]:hidden' : ''} style={{ color: INK3 }}>{k}</dt>
          <dd className={`min-w-0 break-words ${phoneOnly ? 'min-[768px]:hidden' : ''}`} style={{ color: INK }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notes({ entries }) {
  const shown = entries.filter(([, text]) => text);
  if (!shown.length) return null;
  return (
    <details className="text-[13.5px]" style={{ color: INK3 }}>
      <summary className="cursor-pointer font-semibold">Notes</summary>
      {shown.map(([label, text]) => (
        <div key={label} className="mt-1.5"><span className="font-semibold" style={{ color: INK }}>{label}</span><p className="whitespace-pre-line">{text}</p></div>
      ))}
    </details>
  );
}

// The open line: plain facts, the ETA editor for each confirmed order, one Notes toggle.
// Every form is in the line's ⋯ menu, so there are no buttons here besides Save ETA.
function LineDetail({ line, onSaved }) {
  const { po, orders } = line;
  const multi = orders.length > 1;
  const rows = [
    ['Supplier', line.supplier || 'Not set', true],
    line.quote ? ['Quote', line.quote, true] : null,
    po ? ['PO', `${po.po_number || '(no number)'} · ${statusWithDate(po)}`] : ['PO', 'Not linked to a PO yet. Use Order details / link PO in the ⋯ menu.'],
    po && num(po.amount_customer) != null ? ['Customer amount', money(po.amount_customer)] : null,
    po && originalOrderDate(po) ? ['Ordered', displayDate(originalOrderDate(po))] : null,
    ...(orders.length ? orders.map((o) => [
      `Supplier order${multi ? ` ${o.order_number || ''}` : ''}`,
      [o.order_number || '(no number)', statusWithDate(o), num(o.amount) != null && num(o.amount) !== num(po?.amount_dealer) ? `${outMoney(o.amount)} on the order` : '',
        o.received_date ? `received ${displayDate(o.received_date)}` : 'not received'].filter(Boolean).join(' · '),
    ]) : [['Supplier order', 'No confirmation recorded yet']]),
    po?.order_email_status ? ['Order email', (
      <>
        {po.order_email_status === 'sent' ? 'Sent' : 'Saved as an Outlook draft'} {etaDate(String(po.order_email_at || '').slice(0, 10))} to {(po.order_email_to || []).join(', ')}
        {safeHref(po.order_email_ref) ? <> · <a href={po.order_email_ref} target="_blank" rel="noreferrer" className="font-semibold underline">Open in Outlook</a></> : null}
      </>
    )] : po ? ['Order email', 'Not sent'] : null,
  ];
  const etaOrders = orders.filter((o) => Boolean(o.order_number) && o.amount != null && !o.received_date);
  return (
    <div className="flex flex-col gap-3 px-4 pb-3.5 pt-1.5 min-[768px]:pl-[44px]" style={{ backgroundColor: OPEN_BG }}>
      <Facts rows={rows} />
      {/* Same editor as the grid's ETA cell: writes the supplier record and moves its calendar event(s). */}
      {etaOrders.map((o) => (
        <div key={o.id} className="flex flex-col gap-1">
          {multi ? <span className="text-[13px] font-semibold" style={{ color: INK }}>Order {o.order_number}</span> : null}
          <EtaEditor key={o.id} inline jobId={o.job_id} order={o} date={o.eta_date || ''} onSaved={onSaved} />
        </div>
      ))}
      <Notes entries={[[po ? `PO ${po.po_number || ''}` : 'PO', po?.notes], ...orders.map((o) => [`Order ${o.order_number || ''}`, o.notes])]} />
    </div>
  );
}

function lineMenu(line, onEdit) {
  const { po, orders } = line;
  const multi = orders.length > 1;
  const items = [];
  if (po) {
    // While the order email hasn't gone out it is a button on the line itself (Gabriel, Oct 30).
    if (!(po.status === 'issued' && po.order_email_status !== 'sent')) items.push({ label: po.order_email_status === 'sent' ? 'Email order again' : 'Email order', onSelect: () => onEdit({ mode: 'email', po_id: po.id }) });
    items.push({ label: 'Record PO status', onSelect: () => onEdit({ mode: 'po_status', po_id: po.id }) });
  }
  for (const o of orders) {
    const suffix = multi ? ` · ${o.order_number || 'no number'}` : '';
    items.push({ label: `Record order status${suffix}`, onSelect: () => onEdit({ mode: 'vendor_status', order_id: o.id }) });
    items.push({ label: `Order details / link PO${suffix}`, onSelect: () => onEdit({ mode: 'supplier', order_id: o.id }) });
  }
  if (po && !orders.length) items.push({ label: 'Record supplier confirmation', onSelect: () => onEdit({ mode: 'supplier', po_id: po.id }) });
  return items;
}

function lineStatus(line) {
  const { po, orders } = line;
  const row = po || orders[0];
  const label = statusLabel(row?.status);
  return po?.status === 'issued' && po.order_email_status === 'drafted' ? `${label} · email drafted` : label;
}

function OrderRow({ line, open, onToggle, onEdit, onSaved, editor }) {
  const { po } = line;
  const emailPending = po && po.status === 'issued' && po.order_email_status !== 'sent';
  const keyToggle = (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } };
  return (
    <div style={{ borderTop: `1px solid ${RULE}` }}>
      <div role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={keyToggle}
        className="cursor-pointer outline-none hover:bg-[#F7F4EE] focus-visible:bg-[#F7F4EE]" style={open ? { backgroundColor: OPEN_BG } : undefined}>
        <div className={`${GRID} min-h-[44px] py-1.5 text-[13.5px]`}>
          <span style={{ color: INK3 }}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
          <span className={`${WIDE} truncate font-semibold`} style={{ color: line.supplier ? INK : INK2 }}>{line.supplier || 'Not set'}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span style={MONO}>{line.poNumber || (po ? '(no number)' : 'No PO')}</span>
            {line.tag ? <Chip tone="warn">{line.tag.label}</Chip> : null}
            <span className="min-[768px]:hidden" style={{ color: INK3 }}>{line.supplier}</span>
          </span>
          <span className={`${WIDE} truncate`} style={MONO}>{line.quote || '—'}</span>
          <span className={`${WIDE} truncate`} style={MONO}>{line.orderNumbers.join(', ') || '—'}</span>
          <span className={`${WIDE} flex min-w-0 flex-wrap items-center gap-2`} style={{ color: INK }}>
            {lineStatus(line)}
            {emailPending ? (
              <button type="button" onClick={(e) => { stop(e); onEdit({ mode: 'email', po_id: po.id }); }} onKeyDown={stop}
                className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[13px] font-semibold disabled:opacity-60" style={PRI}><Send className="h-3.5 w-3.5" />Email order</button>
            ) : null}
          </span>
          <span className={`${WIDE} whitespace-nowrap tabular-nums`} style={{ color: INK }}>{etaDate(line.eta) || '—'}</span>
          <span className="whitespace-nowrap text-right font-semibold tabular-nums" style={{ color: INK }}>{outMoney(line.amount)}</span>
          <span className="flex justify-end"><ActionMenu label={`Actions for ${line.poNumber || line.orderNumbers[0] || 'this order'}`} items={lineMenu(line, onEdit)} /></span>
        </div>
        {line.tag ? <p className="-mt-0.5 pb-2 pl-4 pr-4 text-[13.5px] min-[768px]:pl-[44px]" style={{ color: INK3 }}>{line.tag.reason}</p> : null}
      </div>
      {open ? <LineDetail line={line} onSaved={onSaved} /> : null}
      {editor ? <div className="px-4 pb-3.5 pt-1" style={{ backgroundColor: OPEN_BG }}>{editor}</div> : null}
    </div>
  );
}

function OrdersSection({ job, rec, jobNameById, onEdit, onSaved, editorFor, listEditor, addMenu }) {
  const [openLine, setOpenLine] = useState(null);
  const lines = useMemo(() => orderLines(rec), [rec]);
  const total = useMemo(() => sheetTotal(job.id, rec), [job.id, rec]);
  const toggle = (key) => setOpenLine((k) => (k === key ? null : key));
  const count = rec.pos.length;
  return (
    <section aria-label="Orders">
      <SectionHead title="Orders" note={lines.length ? `${count} PO${count === 1 ? '' : 's'}${lines.length > count ? ` · ${lines.length - count} order${lines.length - count === 1 ? '' : 's'} without a PO` : ''}` : ''}>{addMenu}</SectionHead>
      {lines.length ? (
        <>
          <div className={`${GRID} ${WIDE} py-1.5 text-[13px] font-semibold`} style={{ color: INK3, borderTop: `1px solid ${EDGE}` }}>
            <span /><span>Supplier</span><span>PO</span><span>Quote</span><span>Order</span><span>Status</span><span>ETA</span><span className="text-right">Cost</span><span />
          </div>
          {lines.map((line) => (
            <OrderRow key={line.key} line={line} open={openLine === line.key} onToggle={() => toggle(line.key)} onEdit={onEdit} onSaved={onSaved} editor={editorFor(line)} />
          ))}
          <div className={`${GRID} py-2 text-[13.5px] font-semibold`} style={{ borderTop: `1.5px solid ${TOTAL_RULE}`, backgroundColor: HEAD_BG, color: INK }}>
            <span />
            <span className="[grid-column:2/8] max-[767px]:[grid-column:2/3]">Total supplier cost{total.partial ? <span className="font-normal" style={{ color: INK3 }}> · a line has no amount yet</span> : null}</span>
            <span className="whitespace-nowrap text-right tabular-nums">{outMoney(total.value)}</span>
            <span />
          </div>
        </>
      ) : <p className="px-4 py-3 text-[13.5px]" style={{ color: INK3, borderTop: `1px solid ${RULE}` }}>No purchase orders or supplier confirmations yet. Use Add to prepare a PO or record one.</p>}
      {listEditor ? <div className="px-4 py-3" style={{ borderTop: `1px solid ${RULE}` }}>{listEditor}</div> : null}
      {rec.conflicts.length > 0 && (
        <details className="mx-4 mb-3 rounded-[10px] p-2.5 text-[13.5px]" style={{ border: '1px solid #EFDFB7', backgroundColor: '#FAF0DA', color: '#6F4E10' }} open>
          <summary className="cursor-pointer font-semibold">{rec.conflicts.length} PO reference conflict{rec.conflicts.length === 1 ? '' : 's'} - review before linking</summary>
          {rec.conflicts.map((c) => (
            <p key={c.number} className="mt-1"><strong>{c.number}</strong> appears against {c.job_ids.map((id, idx) => <span key={id}>{idx ? ' / ' : ''}<Link className="underline" to={`/jobs/${id}`}>{jobNameById(id)}</Link></span>)}. Original records are kept; nothing is cross-linked automatically.</p>
          ))}
        </details>
      )}
    </section>
  );
}

// ---------- 2. Budget ----------

// Ruled money rows: label · amount · share of sell. `total` draws the heavier rule.
const MONEY_GRID = 'grid items-center gap-x-4 px-4 [grid-template-columns:minmax(0,1fr)_120px_96px] max-[767px]:[grid-template-columns:minmax(0,1fr)_auto_64px]';
function MoneyRow({ label, value, share = '', color = null, strong = false, total = false, tone = INK }) {
  return (
    <div className={`${MONEY_GRID} py-1.5 text-[13.5px]`} style={{ borderTop: total ? `1.5px solid ${TOTAL_RULE}` : `1px solid ${RULE}`, backgroundColor: total ? HEAD_BG : undefined, fontWeight: strong || total ? 600 : 400, color: INK }}>
      <span className="inline-flex min-w-0 items-center gap-2">{color ? <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} /> : null}{label}</span>
      <span className="whitespace-nowrap text-right tabular-nums" style={{ color: tone }}>{value}</span>
      <span className="whitespace-nowrap text-right tabular-nums" style={{ color: INK3 }}>{share}</span>
    </div>
  );
}

// A job with no vendor quote: the typed figures (they drive Purchasing), split into the
// supplier orders above and everything else (crew trips, extras).
function TypedBudget({ job, ordered, framed }) {
  const t = typedBudget(job, ordered.value);
  const where = framed ? 'at the top of this page' : 'on the job’s Budget & Orders page';
  if (!t.any) return <p className="px-4 py-3 text-[13.5px]" style={{ color: INK3, borderTop: `1px solid ${RULE}` }}>No budget yet. Type Budget cost and Customer total {where}, or upload the vendor quote from Add.</p>;
  const lines = ordered.value == null ? 0 : 1;
  return (
    <div>
      {lines ? <MoneyRow label={`Supplier orders (total above${ordered.partial ? ', a line has no amount' : ''})`} value={outMoney(t.orders)} /> : null}
      {t.other != null ? <MoneyRow label="Other costs (typed budget cost less supplier orders)" value={outMoney(t.other)} /> : null}
      {t.overBy != null ? <MoneyRow label="Supplier orders are over the typed budget cost by" value={lineMoney(t.overBy)} tone="#A43432" /> : null}
      <MoneyRow label="Budget cost (typed)" value={t.cost == null ? `Not typed ${framed ? '· type it above' : ''}`.trim() : outMoney(t.cost)} strong />
      <MoneyRow label="Customer total (typed)" value={t.sell == null ? 'Not typed' : lineMoney(t.sell)} />
      <MoneyRow label="Margin" value={t.margin == null ? '—' : lineMoney(t.margin)} share={pct(t.marginPct)} total tone={t.margin != null && t.margin < 0 ? '#A43432' : INK} />
    </div>
  );
}

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
      onSaved?.(usage === 'included' ? 'Counted in the budget. You can prepare its PO from Add.' : r?.message);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select aria-label="Budget use" value={value} disabled={busy} onChange={(e) => choose(e.target.value)} className="h-9 rounded-[9px] border bg-white px-2 text-[13px] font-semibold" style={{ borderColor: EDGE, color: INK }}
        title="Counted quotes make up the budget and can be ordered. A replacement leaves the earlier quote out of the totals; its files, numbers and POs stay in history.">
        <option value="included">Counted in budget</option>
        {others.map((o) => <option key={o.id} value={`replaces:${o.id}`}>Counted · replaces {o.title || o.quote_number || 'earlier quote'}</option>)}
        <option value="draft">Draft · not counted</option>
        <option value="reference">Reference only</option>
      </select>
      {error ? <span role="alert" className="text-[13px] font-semibold" style={{ color: '#A43432' }}>{error}</span> : null}
    </span>
  );
}

function QuoteLines({ budget }) {
  const lines = budget.quote?.lines;
  if (!Array.isArray(lines) || !lines.length) return null;
  return (
    <details>
      <summary className="cursor-pointer text-[13.5px] font-semibold" style={{ color: INK3 }}>Quote line items ({lines.length})</summary>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums" style={{ color: INK }}>
          <thead><tr style={{ color: INK3 }}>{['Kind', 'Description', 'Qty', 'Unit', 'Extended'].map((h, idx) => <th key={h} className={`px-1.5 py-1 font-semibold ${idx >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
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

// A quote budget (Gabriel, Oct 30 bar; Oct 31 ruled table): the bar splits the price into
// each cost and the margin; the table below lists them with the total and the margin.
// No suggested price. No overhead is added: his sub pay already covers it. Colors pass the
// dataviz CVD check.
const COST_PARTS = [
  ['material_true_cost', 'Material', '#2a78d6'],
  ['labor_cost_sub_pay', 'Labor (sub pay)', '#eb6834'],
  ['additional_install_material', 'Install material', '#6250d6'],
  ['additional_equipment', 'Equipment', '#eda100'],
];
const MARGIN_COLOR = '#1baf7a';

function BudgetTable({ inputs, total, sell, marginPct }) {
  const profit = sell != null && total != null ? sell - total : null;
  const parts = COST_PARTS.map(([key, label, color]) => ({ key, label, color, value: num(inputs[key]) ?? 0 }));
  const bar = [...parts, ...(profit != null ? [{ label: 'Margin', color: MARGIN_COLOR, value: profit }] : [])];
  const scale = Math.max(sell || 0, total || 0) || 1;
  const share = (v) => (sell ? `${((v / sell) * 100).toFixed(1)}%` : '');
  return (
    <div>
      {total > 0 && (
        <div className="px-4 pb-2.5 pt-1">
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-[4px]" style={{ backgroundColor: '#F3EFE7' }} role="img" aria-label={bar.map((p) => `${p.label} ${lineMoney(p.value)}`).join(', ')}>
            {bar.filter((p) => p.value > 0).map((p) => (
              <span key={p.label} title={`${p.label} ${lineMoney(p.value)}${share(p.value) ? ` · ${share(p.value)}` : ''}`} style={{ width: `${(p.value / scale) * 100}%`, backgroundColor: p.color }} />
            ))}
          </div>
        </div>
      )}
      <div className={`${MONEY_GRID} py-1 text-[13px] font-semibold`} style={{ color: INK3, borderTop: `1px solid ${EDGE}` }}><span>Line</span><span className="text-right">Amount</span><span className="text-right">Share of sell</span></div>
      {parts.filter((p) => p.value > 0 || p.key === 'material_true_cost').map((p) => <MoneyRow key={p.key} label={p.label} color={p.color} value={outMoney(p.value)} share={share(p.value)} />)}
      <MoneyRow label="Total cost" value={outMoney(total)} share={total != null ? share(total) : ''} strong />
      <MoneyRow label="Customer sell" value={sell == null ? 'Not set · use Edit numbers' : lineMoney(sell)} tone={sell == null ? INK3 : INK} />
      <MoneyRow label="Margin" color={MARGIN_COLOR} value={profit == null ? '—' : lineMoney(profit)} share={profit == null ? '' : pct(marginPct)} total tone={profit != null && profit < 0 ? '#A43432' : INK} />
    </div>
  );
}

function BudgetCard({ budget, allBudgets, pos, editing, onEdit, onSaved, editorPanel }) {
  const [menuError, setMenuError] = useState('');
  const removeKey = useRef(null);
  const fig = budgetFigures(budget);
  const c = fig.calculated || {};
  const i = budget.inputs || {};
  const active = activeBudgets(allBudgets.filter((b) => b.job_id === budget.job_id)).some((b) => b.id === budget.id);
  // A job-money budget (no vendor quote yet, e.g. the Oct 24 move off the old money table):
  // sale and labor only - its windows cost comes from the PO, so no margin math is shown.
  const noQuote = num(i.material_true_cost) == null && !budget.quote_number && !budget.quote;
  // A second copy of the same quote, or a job-money placeholder a real quote has replaced:
  // flagged, with Remove in the menu (the server re-checks nothing still uses it).
  const dupe = duplicateOf(budget, allBudgets);
  const stale = replacedByQuote(budget, allBudgets);
  const [chipText, chipTone] = dupe ? ['Possible duplicate', 'warn'] : stale ? ['Replaced by vendor quote', 'plain'] : noQuote ? ['Job money · no vendor quote', 'plain'] : budgetChip(budget, active);
  // No customer price typed yet: the table says so once, instead of a $0 sell and a negative margin.
  const noSell = !(num(i.actual_total_sell) > 0);
  const warnings = fig.warnings.filter((w) => !(noSell && /customer sell/i.test(w)));
  const supplier = budget.vendor || budget.manufacturer || '';
  const sub = [supplier, budget.quote_number ? `Quote ${budget.quote_number}` : '', budget.openings_qty > 0 ? `${budget.openings_qty} unit${budget.openings_qty === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  const statusLine = dupe ? `Same quote as “${dupe.title || dupe.quote_number}”. Keep the right copy and remove the other from the ⋯ menu.`
    : stale ? 'A vendor quote is now on this job. Remove this placeholder (⋯ menu) once that quote has your customer price.'
    : noQuote ? '' : warnings.length ? warnings[0]
    : budget.budget_usage === 'draft' ? 'Draft: set Budget use to “Counted in budget” to order it. Saving your numbers does this for a job’s only quote.' : '';
  const sourceHref = safeHref(budget.source_pdf_url) || fileHref(budget.drive_quote_file_id);
  const privateSource = !sourceHref && /^[a-f0-9]{64}$/.test(budget.source_sha256 || '') ? budget.id : null;
  const related = pos.filter((p) => p.budget_id === budget.id);
  const history = distinctHistory(budget);
  const sell = noSell ? null : num(i.actual_total_sell), total = num(c.total_cost_overhead);
  const qty = quantityReviewLabel(budget);

  async function remove() {
    setMenuError('');
    removeKey.current ||= crypto.randomUUID();
    try {
      const message = await removeJobQuote(budget, { duplicate: Boolean(dupe), requestKey: removeKey.current });
      if (message) onSaved?.(message);
    } catch (e) { setMenuError(messageOf(e)); removeKey.current = null; }
  }
  const openSource = () => { setMenuError(''); openPrivateSource(privateSource).catch((e) => setMenuError(e.message)); };
  const menu = [
    sourceHref ? { label: 'Vendor quote PDF', href: sourceHref } : null,
    privateSource ? { label: 'Vendor quote PDF', onSelect: openSource } : null,
    budget.job_id && !related.length && !budget.deleted_at ? { label: dupe ? 'Remove duplicate quote' : 'Remove quote from job', onSelect: remove, danger: true } : null,
  ];

  return (
    <div style={{ borderTop: `1px solid ${EDGE}` }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-[200px] flex-1 flex-col">
          <span className="break-words text-[14.5px] font-semibold" style={{ color: INK }}>{budget.title || budget.quote_name || 'Untitled quote'}</span>
          {sub ? <span className="text-[13.5px]" style={{ color: INK3 }}>{sub}{qty ? <span style={{ color: '#96490F' }}> · Quantity needs review</span> : null}</span> : null}
        </div>
        {/* Counted / Draft / Reference is what the Budget use dropdown already says. */}
        {budget.job_id && [chip.ok[0], chip.draft[0], chip.ref[0]].includes(chipText) ? null : <Chip tone={chipTone}>{chipText}</Chip>}
        {budget.job_id ? <BudgetUseSelect budget={budget} budgets={allBudgets} onSaved={onSaved} /> : null}
        {!editing && <button type="button" onClick={() => onEdit({ mode: 'numbers', budget_id: budget.id })} className={BTN} style={SEC}><Pencil className="h-3.5 w-3.5" />Edit numbers</button>}
        <ActionMenu label="More for this quote" items={menu} />
      </div>
      {menuError ? <p role="alert" className="px-4 pb-2 text-[13.5px] font-semibold" style={{ color: '#A43432' }}>{menuError}</p> : null}
      {statusLine ? <p className="mx-4 mb-2.5 rounded-[9px] px-3 py-2 text-[13.5px] font-medium" style={{ backgroundColor: '#FAF0DA', border: '1px solid #EFDFB7', color: '#6F4E10' }}>{statusLine}</p> : null}
      {editing ? <div className="px-4 pb-4">{editorPanel}</div> : noQuote ? (
        <div>
          <MoneyRow label="Customer sell" value={lineMoney(i.actual_total_sell)} />
          <MoneyRow label="Labor (sub pay)" value={outMoney(i.labor_cost_sub_pay)} />
          <p className="px-4 py-2 text-[13.5px]" style={{ color: INK3, borderTop: `1px solid ${RULE}` }}>No vendor quote, so the windows cost is the supplier total above. Upload the quote from Add for the full build-up.</p>
        </div>
      ) : <BudgetTable inputs={i} total={total} sell={sell} marginPct={c.actual_margin_pct} />}
      {(budget.quote?.lines?.length > 0 || history.length > 0) && !editing ? (
        <div className="flex flex-col gap-1.5 px-4 py-2.5" style={{ borderTop: `1px solid ${RULE}` }}>
          <QuoteLines budget={budget} />
          {history.length > 0 && (
            <details className="text-[13.5px]" style={{ color: INK3 }}>
              <summary className="cursor-pointer font-semibold">Earlier numbers ({history.length})</summary>
              {history.map((h, idx) => <p key={idx} className="mt-1">{h.at} · material {money(h.inputs?.material_true_cost)} · customer sell {money(h.inputs?.actual_total_sell)}</p>)}
            </details>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------- The workspace ----------

// `framed`: the Budget & Orders page draws its own sheet; under a Purchasing row the
// row's white card already is the sheet.
export default function PurchasingJobWorkspace({ job, data, onSaved, framed = false }) {
  const [editor, setEditor] = useState(null);
  const [hasFolder, setHasFolder] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [invoiceRefresh, setInvoiceRefresh] = useState(0);
  const filesRef = useRef(null);
  const rec = useMemo(() => jobProcurementRecords(data, job.id), [data, job.id]);
  const ordered = useMemo(() => sheetTotal(job.id, rec), [job.id, rec]);
  const invoices = useJobInvoices(job.id, invoiceRefresh);
  const invoiceDone = (msg) => { setInvoicing(false); setInvoiceRefresh((k) => k + 1); onSaved(msg); };
  const jobNameById = (id) => (data.jobs || []).find((j) => j.id === id)?.canonical_name || id;

  const openEditor = (next) => setEditor({ ...next, key: crypto.randomUUID() });
  const done = (_r, msg) => { setEditor(null); onSaved(msg); };
  const budgetDone = (r) => done(r, `Budget saved.${r?.budget?.budget_usage === 'included' ? ' Counted in the budget.' : ''} ${r?.warnings?.join(' ') || 'Issued POs, invoices and recorded payments are unchanged.'}`);

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

  // A form about one line opens under that line; Add's forms open under the table.
  const lineOwns = (line, ed) => Boolean(ed) && ((ed.po_id && line.po?.id === ed.po_id) || (ed.order_id && line.orders.some((o) => o.id === ed.order_id)));
  const editorFor = (line) => (editor && editor.mode !== 'numbers' && lineOwns(line, editor) ? editorPanel(editor) : null);
  const ownedByLine = editor && editor.mode !== 'numbers' && (editor.po_id || editor.order_id)
    && (rec.pos.some((p) => p.id === editor.po_id) || rec.orders.some((o) => o.id === editor.order_id));
  const listEditor = editor && editor.mode !== 'numbers' && !ownedByLine ? editorPanel(editor) : null;
  const budgetEditor = (b) => (editor && editor.budget_id === b.id && editor.mode === 'numbers' ? editorPanel(editor) : null);

  const addMenu = (
    <ActionMenu label="Add" items={[
      { label: 'Prepare PO', onSelect: () => openEditor({ mode: 'po', job_id: job.id }) },
      { label: 'Record supplier confirmation', onSelect: () => openEditor({ mode: 'supplier', job_id: job.id }) },
      { label: 'Upload quote or files', onSelect: () => filesRef.current?.pick() },
      { label: hasFolder ? 'Link a different Drive folder' : 'Link Drive folder', onSelect: () => filesRef.current?.link() },
    ]} trigger={(
      <button type="button" className={BTN} style={{ ...SEC, height: 32 }}><Plus className="h-4 w-4" />Add<ChevronDown className="h-4 w-4" /></button>
    )} />
  );

  // Quote budgets show their own tables; with none, the typed figures stand in.
  const quoteBudgets = rec.budgets.filter((b) => !(num(b.inputs?.material_true_cost) == null && !b.quote_number && !b.quote));
  const budgetNote = quoteBudgets.length ? `${quoteBudgets.length} vendor quote${quoteBudgets.length === 1 ? '' : 's'}` : 'Typed figures · no vendor quote';

  return (
    <div className={framed ? 'overflow-hidden rounded-[12px] bg-white' : ''}
      style={framed ? { border: `1px solid ${EDGE}`, boxShadow: '0 1px 2px rgba(21,24,26,.05), 0 3px 8px -3px rgba(21,24,26,.10)' } : undefined}>
      <OrdersSection job={job} rec={rec} jobNameById={jobNameById} onEdit={openEditor} onSaved={onSaved} editorFor={editorFor} listEditor={listEditor} addMenu={addMenu} />

      <section aria-label="Budget" style={{ borderTop: `1px solid ${EDGE}` }}>
        <SectionHead title="Budget" note={budgetNote}>
          {invoicing ? null : <button type="button" onClick={() => setInvoicing(true)} className={BTN} style={{ ...SEC, height: 32 }}><FileText className="h-4 w-4" />Print invoice</button>}
        </SectionHead>
        {invoicing ? <div className="px-4 pb-4 pt-1"><InvoicePanel job={job} budgets={rec.budgets} invoices={invoices} onDone={invoiceDone} onCancel={() => setInvoicing(false)} /></div> : null}
        {quoteBudgets.length ? null : <TypedBudget job={job} ordered={ordered} framed={framed} />}
        {rec.budgets.map((b) => (
          <BudgetCard key={b.id} budget={b} allBudgets={rec.budgets} pos={rec.pos} editing={editor?.mode === 'numbers' && editor.budget_id === b.id}
            onEdit={openEditor} onSaved={onSaved} editorPanel={budgetEditor(b)} />
        ))}
        <PrintedInvoices invoices={invoices} />
      </section>

      <div style={{ borderTop: `1px solid ${EDGE}` }}>
        <JobFilesPanel ref={filesRef} job={job} onSaved={onSaved} onFolderChange={setHasFolder} headClass={HEAD} headStyle={{ backgroundColor: HEAD_BG }} />
      </div>
    </div>
  );
}
