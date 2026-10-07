// Reusable inline per-job purchasing workspace. Expands IN PLACE beneath a
// PurchasingCard — no route navigation. Reuses the existing native procurement
// forms (PurchaseOrderForm, BudgetUsageForm, SupplierOrderForm, OrderStatusForm,
// InvoiceBridge, NumbersEditor, LinkJobEditor, DeleteUnusedQuoteButton) and the
// shared procurement service validation. Same-job records are filtered by EXACT
// immutable job id (jobProcurementRecords) — never a name join.
//
// Constraints (preview-only):
//  - Does NOT alter the card's money tiles, cost provenance, budgets or money
//    calculations. It only displays real records and hosts owner-reviewed forms.
//  - No autosave on expand. Every mutating form keeps its own review checkbox.
//  - Quote upload uses the private QuoteDropzone (server-side receipt), never the
//    legacy public BudgetOrders upload.
//  - Optional external links (Open job, source quote, budget sheet, Drive
//    folder) are preserved but are not the routine path.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Plus, ChevronDown } from 'lucide-react';
import { C } from '@/lib/feeUI';
import {
  money, buttonClass, primaryStyle, secondaryStyle, purchasingRequest, messageOf, Field,
  PurchaseOrderForm, BudgetUsageForm, SupplierOrderForm, OrderStatusForm, InvoiceBridge,
} from '@/components/budgets/ProcurementForms';
import { NumbersEditor, LinkJobEditor } from '@/components/budgets/BudgetReviewRow';
import DeleteUnusedQuoteButton from '@/components/budgets/DeleteUnusedQuoteButton';
import QuoteDropzone from './QuoteDropzone';
import PrivateSourceButton from './PrivateSourceButton';
import { activeBudgets, budgetFigures, budgetRollup, isLiveBudget, amount } from '@/lib/purchasingCoreTwin';
import { purchasingJobName, statusWithDate, etaText } from '@/lib/purchasingDates';
import { jobProcurementRecords } from '@/lib/purchasingViewModel';

const SECTIONS = [['budgets', 'Quotes & budget'], ['orders', 'POs'], ['tracking', 'Supplier tracking'], ['invoicing', 'Invoicing']];
const safeHref = (v) => { try { return v && new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; } };
const fileHref = (id) => (id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '');
const folderHref = (id) => (id ? `https://drive.google.com/drive/folders/${encodeURIComponent(id)}` : '');
const isPaid = (o) => ['paid', 'reconciled'].includes(o.status) || Boolean(o.paid_at);

const chip = { ok: { t: 'Included scope', c: '#166447', bg: '#EAF5EE', b: '#C7E4D2' }, warn: { t: 'Needs review', c: '#89511A', bg: '#FFF3DF', b: '#F0DBA8' }, draft: { t: 'Draft', c: '#89511A', bg: '#FFF3DF', b: '#F0DBA8' }, ref: { t: 'Reference / replaced', c: '#89511A', bg: '#FFF3DF', b: '#F0DBA8' }, unlinked: { t: 'Needs a job', c: '#89511A', bg: '#FFF3DF', b: '#F0DBA8' } };
function budgetChip(b, active) {
  if (b.status === 'needs_review') return chip.warn;
  if (!b.job_id) return chip.unlinked;
  if (active) return chip.ok;
  if (b.budget_usage === 'draft') return chip.draft;
  return chip.ref;
}

function Badge({ tone, children }) {
  const s = tone === 'ok' ? { c: '#166447', bg: '#EAF5EE', b: '#C7E4D2' } : tone === 'warn' ? { c: '#89511A', bg: '#FFF3DF', b: '#F0DBA8' } : { c: '#566063', bg: '#F4F1EA', b: '#D3CABB' };
  return <span className="inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap" style={{ color: s.c, backgroundColor: s.bg, border: `1px solid ${s.b}` }}>{children}</span>;
}

const linkBtn = 'inline-flex min-h-8 items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[11.5px] font-semibold';

function BudgetRow({ budget, job, allBudgets, pos, onEdit, onPreparePO }) {
  const figures = budgetFigures(budget);
  const active = activeBudgets(allBudgets.filter((b) => b.job_id === budget.job_id)).some((b) => b.id === budget.id);
  const c = budgetChip(budget, active);
  const supplier = budget.vendor || budget.manufacturer || 'Supplier needs review';
  const subtitle = [supplier, budget.quote_number ? `Quote ${budget.quote_number}` : ''].filter(Boolean).join(' · ');
  const statusLine = figures.warnings.length ? figures.warnings[0]
    : budget.budget_usage === 'draft' ? 'Draft — review numbers and your customer price, then include this scope.'
    : 'Reviewed and ready to include.';
  const sourceHref = safeHref(budget.source_pdf_url) || fileHref(budget.drive_quote_file_id);
  const fHref = job?.drive_job_folder_url || folderHref(job?.drive_job_folder_id || budget.drive_job_folder_id);
  const privateSource = !sourceHref && /^[a-f0-9]{64}$/.test(budget.source_sha256 || '') ? budget.id : null;
  const related = pos.filter((p) => p.budget_id === budget.id);
  return (
    <div className="rounded-[10px] p-3" style={{ border: '1px solid #D3CABB', backgroundColor: '#FAF8F3' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-bold leading-tight" style={{ color: C.text }}>{budget.title || budget.quote_name || 'Untitled quote'}</p>
          <p className="mt-0.5 text-[11px]" style={{ color: C.textSecondary }}>{subtitle}</p>
        </div>
        <Badge tone={c === chip.ok ? 'ok' : 'warn'}>{c.t}</Badge>
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color: C.text }}>Material before tax: <strong>{money(budget.inputs?.material_true_cost)}</strong>{budget.openings_qty > 0 ? <span style={{ color: C.textSecondary }}> · {budget.openings_qty} units</span> : null}</p>
      <p className={`mt-1 text-[11px] ${figures.warnings.length ? 'font-semibold' : ''}`} style={{ color: figures.warnings.length ? '#89511A' : C.textSecondary }}>{statusLine}</p>
      <div className="mt-1.5 text-[12px]" style={{ color: C.text }}>Cost basis <strong>{money(figures.cost)}</strong></div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onEdit({ mode: 'numbers', budget_id: budget.id })} className={linkBtn} style={{ borderColor: C.border, color: '#fff', backgroundColor: '#0B3F3B' }}>Review numbers</button>
        {budget.job_id ? <button type="button" onClick={() => onEdit({ mode: 'usage', budget_id: budget.id })} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}>Scope / revision</button> : null}
        {budget.job_id && active && figures.ready && !related.length ? <button type="button" onClick={() => onPreparePO(budget.id)} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}>Prepare PO</button> : null}
        {related.map((p) => <Link key={p.id} to={`/jobs/${encodeURIComponent(budget.job_id)}/budget-orders?section=orders`} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}>{p.po_number}</Link>)}
        {!budget.job_id ? <DeleteUnusedQuoteButton budget={budget} onDeleted={onEdit._onSaved} /> : null}
        {sourceHref ? <a href={sourceHref} target="_blank" rel="noreferrer" className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}><ExternalLink className="h-3.5 w-3.5" />Source</a> : null}
        {privateSource ? <PrivateSourceButton budgetId={privateSource} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }} /> : null}
        {budget.drive_budget_xlsx_file_id ? <a href={fileHref(budget.drive_budget_xlsx_file_id)} target="_blank" rel="noreferrer" className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}><ExternalLink className="h-3.5 w-3.5" />Budget sheet</a> : null}
        {fHref ? <a href={fHref} target="_blank" rel="noreferrer" className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}><ExternalLink className="h-3.5 w-3.5" />Drive</a> : null}
      </div>
    </div>
  );
}

function PORow({ po, budgets, orders, onEdit }) {
  const source = budgets.find((b) => b.id === po.budget_id);
  const supplier = orders.find((o) => o.purchase_order_id === po.id);
  return (
    <div className="rounded-[10px] p-3" style={{ border: '1px solid #D3CABB', backgroundColor: '#FAF8F3' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-bold leading-tight" style={{ color: C.text }}>{po.po_number || 'PO'}</p>
          <p className="mt-0.5 text-[11px]" style={{ color: C.textSecondary }}>{po.vendor}{po.vendor_quote_ref ? ` · ${po.vendor_quote_ref}` : ''}</p>
        </div>
        <Badge tone={po.status === 'cancelled' ? 'warn' : 'ok'}>{statusWithDate(po)}</Badge>
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color: C.text }}>Supplier payable <strong>{money(po.amount_dealer)}</strong>{po.amount_customer != null ? <span style={{ color: C.textSecondary }}> · customer {money(po.amount_customer)}</span> : null}</p>
      <p className="mt-1 text-[11px]" style={{ color: C.textSecondary }}>{source ? `Source: ${source.title}` : po.purchase_type === 'shop' ? 'Shop purchase' : 'No matching quote'}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onEdit({ mode: 'po_status', po_id: po.id })} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}>Record status</button>
        {supplier ? <button type="button" onClick={() => onEdit({ mode: 'vendor_status', order_id: supplier.id })} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}>Payment status</button> : <button type="button" onClick={() => onEdit({ mode: 'supplier', po_id: po.id })} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}>Record confirmation</button>}
      </div>
    </div>
  );
}

function OrderRow({ order, pos, onEdit }) {
  const po = pos.find((p) => p.id === order.purchase_order_id);
  return (
    <div className="rounded-[10px] p-3" style={{ border: '1px solid #D3CABB', backgroundColor: '#FAF8F3' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-bold leading-tight" style={{ color: C.text }}>{order.order_number || 'Supplier order'}</p>
          <p className="mt-0.5 text-[11px]" style={{ color: C.textSecondary }}>{order.vendor}{po ? ` · ${po.po_number}` : ' · No PO link'}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone="ok">{statusWithDate(order)}</Badge>
          <Badge tone={isPaid(order) ? 'ok' : 'warn'}>{isPaid(order) ? order.status : 'Unpaid'}</Badge>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 text-[12px]" style={{ color: C.text }}>
        <span>Amount <strong>{money(order.amount)}</strong></span>
        <span>ETA <strong>{etaText(order)}</strong></span>
        <span>Received <strong>{order.received_date || '—'}</strong></span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onEdit({ mode: 'supplier', order_id: order.id })} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}>Details / link PO</button>
        <button type="button" onClick={() => onEdit({ mode: 'vendor_status', order_id: order.id })} className={linkBtn} style={{ borderColor: C.border, color: C.text, backgroundColor: '#fff' }}>Record payment status</button>
      </div>
    </div>
  );
}

export default function PurchasingJobWorkspace({ job, data, section, onSection, onSaved }) {
  const [editor, setEditor] = useState(null);
  const rec = useMemo(() => jobProcurementRecords(data, job.id), [data, job.id]);
  const active = useMemo(() => activeBudgets(rec.budgets), [rec.budgets]);
  const rollup = useMemo(() => budgetRollup(rec.budgets), [rec.budgets]);

  const openEditor = (next) => setEditor({ ...next, key: crypto.randomUUID() });
  const done = (_r, msg) => { setEditor(null); onSaved(msg); };
  const budgetDone = (r) => done(r, `Budget saved. ${r?.warnings?.join(' ') || 'Issued POs, invoices and recorded payments are unchanged.'}`);
  const preparePO = (budgetId) => { onSection('orders'); openEditor({ mode: 'po', budget_id: budgetId, job_id: job.id }); };

  const currentBudget = editor?.budget_id ? data.budgets.find((b) => b.id === editor.budget_id) : null;
  const currentPO = editor?.po_id ? data.purchase_orders.find((p) => p.id === editor.po_id) : null;
  const currentOrder = editor?.order_id ? data.vendor_orders.find((o) => o.id === editor.order_id) : null;

  const editorPanel = ed => ed && (
    <div className="mt-2" key={ed.key}>
      {ed.mode === 'po' && <PurchaseOrderForm job={job} budgets={data.budgets} initialBudget={currentBudget} onDone={done} onCancel={() => setEditor(null)} />}
      {ed.mode === 'usage' && currentBudget && <BudgetUsageForm budget={currentBudget} budgets={data.budgets} onDone={budgetDone} onCancel={() => setEditor(null)} />}
      {ed.mode === 'numbers' && currentBudget && <NumbersEditor budget={currentBudget} onDone={budgetDone} onRefilled={onSaved} onCancel={() => setEditor(null)} />}
      {ed.mode === 'link' && currentBudget && <LinkJobEditor budget={currentBudget} jobs={data.jobs} allowCreate={false} onDone={budgetDone} onCancel={() => setEditor(null)} />}
      {ed.mode === 'supplier' && <SupplierOrderForm jobs={data.jobs} purchaseOrders={data.purchase_orders} initialJobId={job.id} initialPO={currentPO} order={currentOrder} onDone={done} onCancel={() => setEditor(null)} />}
      {ed.mode === 'po_status' && currentPO && <OrderStatusForm row={currentPO} onDone={done} onCancel={() => setEditor(null)} />}
      {ed.mode === 'vendor_status' && currentOrder && <OrderStatusForm row={currentOrder} supplier onDone={done} onCancel={() => setEditor(null)} />}
    </div>
  );

  // Pass onSaved into DeleteUnusedQuoteButton via a stable ref-like prop.
  const editWithSaved = (next) => { openEditor(next); };
  editWithSaved._onSaved = onSaved;

  return (
    <div className="mt-2 rounded-[12px] p-3" style={{ border: '1px solid #D3CABB', backgroundColor: '#FFFFFF' }}>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={`Purchasing sections for ${job.canonical_name}`}>
        {SECTIONS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={section === key} type="button" onClick={() => { onSection(key); setEditor(null); }}
            className="inline-flex min-h-8 items-center rounded-[7px] px-2.5 py-1 text-[11.5px] font-semibold"
            style={section === key ? { backgroundColor: '#0B3F3B', color: '#fff', border: '1px solid #0B3F3B' } : { backgroundColor: '#FAF8F3', color: C.text, border: `1px solid ${C.border}` }}>
            {label}{key === 'budgets' ? ` (${rec.budgets.length})` : key === 'orders' ? ` (${rec.pos.length})` : key === 'tracking' ? ` (${rec.orders.length})` : ''}
          </button>
        ))}
      </div>

      {editor && !editor.budget_id && editorPanel(editor)}

      <div className="mt-2.5">
        {section === 'budgets' && (
          <div className="space-y-2">
            {rec.budgets.length === 0 ? <p className="text-[12px]" style={{ color: C.textSecondary }}>No quote budgets for this job yet. Add a quote PDF below.</p> : null}
            {rec.budgets.map((b) => <BudgetRow key={b.id} budget={b} job={job} allBudgets={rec.budgets} pos={rec.pos} onEdit={editWithSaved} onPreparePO={preparePO} />)}
            {rec.conflicts.length > 0 && <p className="text-[11.5px] font-semibold" style={{ color: '#89511A' }}>{rec.conflicts.length} PO reference conflict(s) — review before linking.</p>}
            <div className="rounded-[10px] p-2" style={{ border: '1px dashed #D3CABB', backgroundColor: '#FAF8F3' }}>
              <QuoteDropzone onDone={onSaved} />
            </div>
          </div>
        )}
        {section === 'orders' && (
          <div className="space-y-2">
            <button type="button" onClick={() => openEditor({ mode: 'po', job_id: job.id })} className={linkBtn} style={{ borderColor: '#0B3F3B', color: '#fff', backgroundColor: '#0B3F3B' }}><Plus className="h-3.5 w-3.5" />Prepare PO</button>
            {rec.pos.length === 0 ? <p className="text-[12px]" style={{ color: C.textSecondary }}>No purchase orders for this job.</p> : null}
            {rec.pos.map((p) => <PORow key={p.id} po={p} budgets={rec.budgets} orders={rec.orders} onEdit={editWithSaved} />)}
          </div>
        )}
        {section === 'tracking' && (
          <div className="space-y-2">
            <button type="button" onClick={() => openEditor({ mode: 'supplier', job_id: job.id })} className={linkBtn} style={{ borderColor: '#0B3F3B', color: '#fff', backgroundColor: '#0B3F3B' }}><Plus className="h-3.5 w-3.5" />Record confirmation</button>
            {rec.orders.length === 0 ? <p className="text-[12px]" style={{ color: C.textSecondary }}>No supplier confirmations for this job.</p> : null}
            {rec.orders.map((o) => <OrderRow key={o.id} order={o} pos={rec.pos} onEdit={editWithSaved} />)}
          </div>
        )}
        {section === 'invoicing' && (
          <div className="space-y-2">
            <div className="text-[12px]" style={{ color: C.textSecondary }}>Budget rollup · cost {money(rollup.cost)} · customer {money(rollup.sell)} · margin {money(rollup.margin_dollars)} ({rollup.status === 'ready' ? 'reviewed' : 'needs review'})</div>
            <InvoiceBridge job={job} />
          </div>
        )}
      </div>

      {editor && editor.budget_id && editorPanel(editor)}
    </div>
  );
}