import { statusLabel, statusWithDate } from "@/lib/purchasingDates";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { aggregateJobMoney, canLoadJobMoney } from "@/lib/jobMoneyPanel";
import { jobProject } from "@/lib/jobProject";
import { denverDate } from "@/lib/feeMath";
import { procurementPath } from "@/lib/procurementRoutes";
import { ticketLabel } from "@/lib/jobHistory";
import JobInvoices from "@/components/jobs/JobInvoices";
import { useRequestPayment } from "@/components/purchasing/RequestPayment";

// Job money, QuickBooks Projects style (Oct 24): a money strip, then income, costs and profit
// as Estimate · Actual · Variance (jobProject), then customer invoices and the source records.
// The Estimate column is the job's Purchasing row. How each figure is worked out is in its
// hover title, not in caption text.
const BAND = "#0B3F3B", TITLE = "#F2EEE8", INK = "#101617", SECOND = "#566063", RULE = "#D6CCBA", RED = "#A43432";
const money = (value) => value === null || value === undefined
  ? "—"
  : Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
const pct = (value) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);
const shortDay = (iso) => (iso ? `${Number(String(iso).slice(5, 7))}/${Number(String(iso).slice(8, 10))}/${String(iso).slice(2, 4)}` : "—");
const TABLE = { display: "grid", gridTemplateColumns: "minmax(160px,1fr) 148px 148px 148px", alignItems: "center" };
const HEAD = { height: 36, background: "#E9E2D4", borderBottom: "2px solid #34403F", color: "#34403F", letterSpacing: "0.06em" };

function Figure({ label, value, title, color = INK, first = false }) {
  return (
    <div title={title} className="min-w-0 px-4 py-2.5" style={{ borderLeft: first ? "none" : `1px solid ${RULE}` }}>
      <div className="whitespace-nowrap text-[13px] font-medium" style={{ color: SECOND }}>{label}</div>
      <div className="whitespace-nowrap text-[18px] font-bold tabular-nums" style={{ color, letterSpacing: "-0.01em" }}>{value}</div>
    </div>
  );
}

// Costs are money out, so they read as negative numbers (Gabe, Oct 25). With costs negative,
// every row reads the same way: a negative variance is bad (a cost ran over, or income or
// profit came in under).
// 0 - v (not -v) so a zero stays $0.00, never -$0.00.
const shown = (row, v) => (v == null ? null : row.cost ? 0 - v : v);
const varianceColor = (v) => (v != null && v < 0 ? RED : INK);
const signed = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${money(v)}`);

function EstimateTable({ project }) {
  const partialTitle = "A scope has no cost figure yet, so this adds the scopes that have one";
  const missingTitle = "A supplier PO or order has no amount yet, so this adds the ones that have one";
  return (
    <div role="table" aria-label="Estimate and actual" className="text-[14px]" style={{ color: INK }}>
      <div role="row" className="text-[11.5px] font-semibold uppercase" style={{ ...TABLE, ...HEAD }}>
        <span role="columnheader" className="px-2.5">Job</span>
        <span role="columnheader" className="px-2.5 text-right" title="The job's Purchasing row">Estimate</span>
        <span role="columnheader" className="px-2.5 text-right" title="Customer invoices, supplier POs and orders, and job cost inputs recorded so far">Actual</span>
        <span role="columnheader" className="px-2.5 text-right">Variance</span>
      </div>
      {project.rows.map((row) => (
        <div key={row.key} role="row" className={row.total ? "font-bold" : ""} style={{ ...TABLE, minHeight: 40, borderBottom: `1px solid ${RULE}`, background: row.total ? "#FAF8F3" : undefined }}>
          <span role="cell" className="px-2.5" title={row.key === "windows" ? "Window and door material cost as entered" : undefined}>{row.label}</span>
          <span role="cell" className="px-2.5 text-right tabular-nums" title={row.estimatePartial ? partialTitle : undefined} style={row.estimatePartial ? { background: "#FAF0DA" } : undefined}>{money(shown(row, row.estimate))}</span>
          <span role="cell" className="px-2.5 text-right tabular-nums" title={row.actualPartial ? missingTitle : undefined} style={row.actualPartial ? { background: "#FAF0DA" } : undefined}>{money(shown(row, row.actual))}</span>
          <span role="cell" className="px-2.5 text-right tabular-nums" style={{ color: varianceColor(shown(row, row.variance)) }}>{signed(shown(row, row.variance))}</span>
        </div>
      ))}
      <div role="row" style={{ ...TABLE, minHeight: 40, borderBottom: `1px solid ${RULE}` }}>
        <span role="cell" className="px-2.5">Margin</span>
        <span role="cell" className="px-2.5 text-right tabular-nums">{pct(project.margin.estimate)}</span>
        <span role="cell" className="px-2.5 text-right tabular-nums">{pct(project.margin.actual)}</span>
        <span role="cell" className="px-2.5" />
      </div>
    </div>
  );
}

function RecordGroup({ title, to, linkLabel, rows, empty }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="m-0 text-[15px] font-bold" style={{ color: INK }}>{title}</h3>
        {to && <Link to={to} className="inline-flex items-center gap-1 text-[14px] font-semibold hover:underline" style={{ color: "#082F2C" }}>{linkLabel}<ExternalLink className="h-3.5 w-3.5" /></Link>}
      </div>
      <div className="text-[14px]" style={{ color: INK, borderTop: `1px solid ${RULE}` }}>
        {rows.length ? rows.map((r) => (
          <div key={r.id} className="flex min-h-10 items-center gap-3 px-2.5 py-1.5" style={{ borderBottom: `1px solid ${RULE}` }}>
            <span className="min-w-0 flex-1">{r.main}</span>
            {r.status && <span className="shrink-0" style={{ color: SECOND }}>{r.status}</span>}
            <span className="w-[120px] shrink-0 text-right tabular-nums">{money(r.amount)}</span>
          </div>
        )) : <div className="flex min-h-10 items-center px-2.5" style={{ borderBottom: `1px solid ${RULE}`, color: SECOND }}>{empty}</div>}
      </div>
    </div>
  );
}

export default function JobMoneyPanel({ jobId, memberIds }) {
  const { user } = useAuth();
  const owner = canLoadJobMoney(user);
  const memberKey = (memberIds || []).filter(Boolean).sort().join(",");
  const [state, setState] = useState({ loading: owner, error: "", raw: null });
  const [invoices, setInvoices] = useState([]);
  const [invoiceForm, setInvoiceForm] = useState(false);

  useEffect(() => {
    let active = true;
    if (!owner) {
      setState({ loading: false, error: "", raw: null });
      return () => { active = false; };
    }
    setState({ loading: true, error: "", raw: null });
    // Include duplicate records of this job so money filed under any of them shows here.
    const ids = [...new Set([jobId, ...(String(memberKey || "").split(",").filter(Boolean))])];
    const byJob = ids.length > 1 ? { job_id: { $in: ids } } : { job_id: jobId };
    Promise.all([
      base44.entities.JobBudgets.filter(byJob, "-created_date", 200),
      base44.entities.PurchaseOrders.filter(byJob, "-created_date", 500),
      base44.entities.VendorOrders.filter(byJob, "-created_date", 500),
      base44.entities.FeeLines.filter(byJob, "-job_date", 5000),
      base44.entities.CalendarEvents.filter(byJob, "-event_date", 5000),
      base44.entities.Jobs.filter({ id: jobId }, "-created_date", 1).catch(() => []),
      base44.entities.Invoices.filter(byJob, "invoice_date", 200),
      base44.entities.JobCostInputs.filter(byJob, "month", 500).catch(() => []),
    ]).then(([budgets, purchaseOrders, vendorOrders, feeLines, calendarEvents, jobs, jobInvoices, costInputs]) => {
      if (!active) return;
      setInvoices(Array.isArray(jobInvoices) ? jobInvoices : []);
      setState({ loading: false, error: "", raw: { ids, budgets, purchaseOrders, vendorOrders, feeLines, calendarEvents, jobs, costInputs } });
    }).catch(() => {
      if (active) setState({ loading: false, error: "Financial records could not be loaded.", raw: null });
    });
    return () => { active = false; };
  }, [jobId, owner, memberKey]);

  const raw = state.raw;
  const sources = useMemo(() => (raw ? aggregateJobMoney(raw.ids, raw) : null), [raw]);
  const project = useMemo(() => (raw ? jobProject(jobId, raw.ids, { ...raw, invoices, today: denverDate() }) : null), [raw, invoices, jobId]);

  const pay = useRequestPayment({ job: raw?.jobs?.[0], sale: project?.contract ?? null, budgets: raw?.budgets || [], invoices, onRecorded: (row) => setInvoices((prev) => [...prev, row]) });

  // Intentionally render nothing for non-owners: no request, amount, placeholder,
  // or hint that private pricing exists reaches a crew login.
  if (!owner) return null;

  const job = raw?.jobs?.[0];
  const owesTitle = project?.customerOwesFrom === "invoices"
    ? "Sale less customer payments received"
    : "No customer invoices yet, so this follows the payment stage: half down owes half, full payment owes nothing, any other stage owes the whole sale";
  const item = "flex min-h-9 cursor-pointer items-center text-[14px]";

  return <section aria-label="Job money" className="mt-5 overflow-hidden rounded-[12px]" style={{ background: "#FFFFFF", border: "1px solid #B3A792" }}>
    <div className="flex items-center gap-3" style={{ minHeight: 52, padding: "8px 12px 8px 20px", background: BAND }}>
      <h2 className="m-0 text-[18px] font-bold" style={{ color: TITLE, letterSpacing: "-0.02em" }}>Job money</h2>
      <div style={{ flex: 1 }} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={!project} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold disabled:opacity-50" style={{ border: "1px solid rgba(242,238,232,.3)", background: "none", color: TITLE }}>Add<ChevronDown className="h-4 w-4" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px] p-1">
          <DropdownMenuItem className={item} onSelect={() => setInvoiceForm(true)}>Customer invoice</DropdownMenuItem>
          <DropdownMenuItem className={item} asChild><Link to={procurementPath(jobId, "orders")}>Purchase order</Link></DropdownMenuItem>
          {project?.contract != null && <>
            <div className="mx-2 my-1" style={{ borderTop: `1px solid ${RULE}` }} />
            <div className="px-2 pb-1 pt-0.5 text-[13px] font-semibold" style={{ color: SECOND }}>Request payment</div>
            {pay.items}
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    {state.loading && <p className="m-0 px-5 py-4 text-[14px]" style={{ color: SECOND }}>Loading job money…</p>}
    {state.error && <p role="alert" className="m-0 px-5 py-4 text-[14px]" style={{ color: RED }}>{state.error}</p>}
    {raw && !project && <p className="m-0 px-5 py-4 text-[14px]" style={{ color: SECOND }}>No money recorded for this job.</p>}

    {project && <>
      <div className="grid grid-cols-7 max-[1279px]:grid-cols-4" style={{ borderBottom: `1px solid ${RULE}` }}>
        <Figure first label="Contract" value={money(project.contract)} title="Sale price: owner-entered, else the budget target sell (the Purchasing Sale column)" />
        <Figure label="Invoiced" value={money(project.invoiced)} title="Customer invoices recorded for this job, voided ones left out" />
        <Figure label="Received" value={money(project.received)} title="Customer invoices marked paid" />
        <Figure label="Customer owes" value={money(project.customerOwes)} title={owesTitle} />
        <Figure label="Job cost" value={money(shown({ cost: true }, project.rows.find((r) => r.key === "cost").estimate))} title="Windows plus labor & material (the Purchasing row), shown as money out" />
        <Figure label="Est. profit" value={money(project.rows.find((r) => r.key === "profit").estimate)} title="The Purchasing Est. profit column: sale less windows + tax less labor & material" color={(project.rows.find((r) => r.key === "profit").estimate ?? 0) < 0 ? RED : "#0B3F3B"} />
        <Figure label="Margin" value={pct(project.margin.estimate)} title="Est. profit as a share of the contract" />
      </div>

      <div className="space-y-6 p-5">
        {sources?.budgetWarnings?.length > 0 && <p className="m-0 rounded-lg p-3 text-[14px]" style={{ background: "#FAF0DA", color: "#6F4E10" }}>Budget totals need review: {sources.budgetWarnings.join(" ")}</p>}
        {pay.panel && <div className="overflow-hidden rounded-[12px]" style={{ border: `1px solid ${RULE}` }}>{pay.panel}</div>}
        <EstimateTable project={project} />
        <JobInvoices jobId={jobId} invoices={invoices} onChange={setInvoices} formOpen={invoiceForm} onFormOpen={setInvoiceForm} customerName={job?.customer_name || ""} />

        <RecordGroup title="Quotes & budgets" to={procurementPath(jobId)} linkLabel="Budget & Orders" empty="No budgets linked to this job."
          rows={sources.budgets.map((b) => ({ id: b.id, main: <>{b.source_pdf_url ? <a href={b.source_pdf_url} target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: "#082F2C" }}>{b.title || b.id}</a> : b.title || b.id}{b.included_in_budget ? "" : " · not counted"}</>, status: `Sell ${money(b.displayComputed.actual_total_sell)} · ${statusLabel(b.status)}`, amount: shown({ cost: true }, b.displayComputed.total_cost_overhead) }))} />
        <RecordGroup title="Purchase orders" to={procurementPath(jobId, "orders")} linkLabel="Job POs" empty="No purchase orders for this job."
          rows={sources.purchaseOrders.map((p) => ({ id: p.id, main: `${p.po_number || p.id} · ${p.vendor || "Vendor not recorded"}`, status: statusWithDate(p), amount: shown({ cost: true }, p.amount_dealer) }))} />
        <RecordGroup title="Supplier orders" to={procurementPath(jobId, "tracking")} linkLabel="Order tracking" empty="No supplier orders for this job."
          rows={sources.vendorOrders.map((o) => ({ id: o.id, main: `${o.order_number || o.title || o.id} · ${o.vendor || "Vendor not recorded"}`, status: `${statusLabel(o.status)}${o.paid_at ? ` · paid ${shortDay(o.paid_at)}` : ""}`, amount: shown({ cost: true }, o.amount) }))} />
        <RecordGroup title="Labor lines" to={`/?job_id=${encodeURIComponent(jobId)}`} linkLabel="Job invoicing" empty="No labor lines for this job."
          rows={sources.feeLines.map((l) => ({ id: l.id, main: `${shortDay(l.job_date)} · ${l.line_description || "Labor line"}${l.ticket_sequence != null ? ` · ${ticketLabel(l.ticket_sequence)}` : ""}`, status: l.paid_to_ya ? "Paid" : l.billed_to_bfs ? `Invoiced${l.invoice_number ? ` #${l.invoice_number}` : ""}` : "Not invoiced", amount: l.fee_amt }))} />
      </div>
    </>}
  </section>;
}
