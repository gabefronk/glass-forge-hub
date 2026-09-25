import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { computeJobBudget } from "../../base44/shared/jobBudgetMath.js";
import { ownerConfirmedJobPatch } from "../../base44/shared/jobLinking.js";
import { UploadCloud, FileText, FolderOpen, DollarSign, AlertTriangle, CheckCircle2, Truck, Plus } from "lucide-react";

// Job Budgets: drop vendor quote PDFs -> cost basis + margins -> Drive filing ->
// invoicing cost inputs. Plus the unpaid-jobs tracker (ordered -> ETA -> ACH link
// -> paid -> reconciled) so every open payable is one list.

const money = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)))
  ? "-" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n))) ? "-" : (Number(n) * 100).toFixed(1) + "%";

const ORDER_CHAIN = ["ordered", "eta_set", "ach_link_received", "paid", "reconciled"];
const ORDER_LABEL = { ordered: "Ordered", eta_set: "ETA set", ach_link_received: "ACH link in", paid: "Paid", reconciled: "Reconciled" };
const NEXT_ACTION = { ordered: "Set ETA", eta_set: "ACH link received", ach_link_received: "Mark paid", paid: "Reconcile" };

function statusTag(status) {
  if (status === "filed" || status === "reconciled" || status === "paid") return C.tagBillable;
  if (status === "needs_review" || status === "ordered") return C.tagReview;
  return C.tagCal;
}

function Tag({ status, children }) {
  const t = statusTag(status);
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }}>
      {children}
    </span>
  );
}

function Section({ title, sub, children }) {
  return (
    <section className="rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
        <h2 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>{title}</h2>
        {sub && <p className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>{sub}</p>}
      </div>
      <div className="p-5 flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default function JobBudgets() {
  const [budgets, setBudgets] = useState([]);
  const [orders, setOrders] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [processing, setProcessing] = useState([]); // per-drop progress lines
  const [dragOver, setDragOver] = useState(false);
  const [newOrder, setNewOrder] = useState({ order_number: "", vendor: "", po_name: "", amount: "", payer: "", payment_route: "ach_link", billed_account: "", notes: "" });
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [linking, setLinking] = useState("");
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    const [b, o, j] = await Promise.all([
      base44.entities.JobBudgets.list("-created_date", 200).catch(() => []),
      base44.entities.VendorOrders.list("-created_date", 200).catch(() => []),
      base44.entities.Jobs.list("-created_date", 1000).catch(() => []),
    ]);
    setBudgets(b || []);
    setOrders(o || []);
    setJobs(j || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function processFiles(files) {
    const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name));
    if (!pdfs.length) return;
    for (const file of pdfs) {
      setProcessing((p) => [...p, { name: file.name, state: "uploading" }]);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setProcessing((p) => p.map((x) => x.name === file.name ? { ...x, state: "extracting" } : x));
        const res = await base44.functions.invoke("jobBudgetIngest", { file_url, file_name: file.name });
        setProcessing((p) => p.map((x) => x.name === file.name ? { ...x, state: res?.status === "filed" ? "done" : "review", detail: res } : x));
      } catch (e) {
        setProcessing((p) => p.map((x) => x.name === file.name ? { ...x, state: "error", detail: String(e?.message || e) } : x));
      }
    }
    load();
  }

  async function logOrder() {
    const payload = {
      ...newOrder,
      amount: newOrder.amount === "" ? undefined : Number(newOrder.amount),
    };
    await base44.functions.invoke("jobBudgetIngest", { action: "upsert_order", order: payload });
    setNewOrder({ order_number: "", vendor: "", po_name: "", amount: "", payer: "", payment_route: "ach_link", billed_account: "", notes: "" });
    setShowOrderForm(false);
    load();
  }

  async function advanceOrder(order) {
    const idx = ORDER_CHAIN.indexOf(order.status);
    if (idx < 0 || idx >= ORDER_CHAIN.length - 1) return;
    const next = ORDER_CHAIN[idx + 1];
    const extra = {};
    if (next === "ach_link_received") {
      const link = window.prompt("Paste the ACH link from the vendor:");
      if (link === null) return;
      extra.ach_link = link;
    }
    if (next === "paid") {
      const ref = window.prompt("Payment reference (ACH confirmation, check #) - optional:") || "";
      extra.paid_reference = ref;
    }
    if (next === "eta_set") {
      const eta = window.prompt("ETA date (yyyy-mm-dd):");
      if (!eta) return;
      extra.eta_date = eta;
    }
    await base44.functions.invoke("jobBudgetIngest", { action: "advance_order_status", order_id: order.id, status: next, ...extra });
    load();
  }

  async function confirmBudgetJob(budget, jobId) {
    if (!jobId) return;
    setLinking(budget.id);
    try {
      const selected = jobs.find((job) => job.id === jobId);
      await base44.entities.JobBudgets.update(budget.id, ownerConfirmedJobPatch(budget, selected, new Date().toISOString()));
      await load();
    } finally { setLinking(""); }
  }

  const openPayables = orders.filter((o) => o.status !== "reconciled");
  const openPayableTotal = openPayables.reduce((n, o) => n + (Number(o.amount) || 0), 0);
  const jobName = (id) => jobs.find((j) => j.id === id)?.canonical_name || "";

  return (
    <div className="flex flex-col" style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }}>
      <header className="shrink-0 px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-5" style={{ background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))", color: "var(--gf-sidebar-text-on)" }}>
        <div className="flex items-center gap-3">
          <DollarSign className="h-7 w-7" style={{ color: "var(--gf-brass-300)" }} strokeWidth={1.8} strokeLinecap="round" />
          <h1 className="font-heading text-[30px] font-bold" style={{ color: "var(--gf-sidebar-text-on)", letterSpacing: "-0.03em" }}>Job Budgets</h1>
        </div>
        <p className="mt-2 text-[13px] max-w-[680px]" style={{ color: "var(--gf-sidebar-muted)" }}>
          Drop a vendor quote PDF. The Hub builds the cost basis and margin from your Window Budget Sheet math,
          files everything under Glass Forge Jobs in Drive, and feeds the invoicing page. Unpaid vendor orders
          are tracked below until they reconcile.
        </p>
      </header>

      <div className="px-[26px] max-[699px]:px-[18px] py-6 flex flex-col gap-6 max-w-[1080px]">

        {/* Drop zone */}
        <Section title="Drop quote PDFs" sub="Amsco dealer quotes parse automatically; other vendors are read by the document model. Multiple files at once are fine.">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files); }}
            onClick={() => fileInput.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-[12px] py-10 cursor-pointer transition-colors"
            style={{ border: `2px dashed ${dragOver ? C.accent : C.border}`, backgroundColor: dragOver ? C.accent18 : C.cardAlt }}>
            <UploadCloud className="h-8 w-8" style={{ color: C.accent }} strokeWidth={1.6} />
            <span className="text-[14px] font-medium" style={{ color: C.text }}>Drop quote PDFs here, or click to choose</span>
            <span className="text-[12px]" style={{ color: C.textMuted }}>Budget sheet, Drive filing, and invoicing cost inputs happen automatically</span>
            <input ref={fileInput} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { processFiles(e.target.files); e.target.value = ""; }} />
          </div>
          {processing.length > 0 && (
            <div className="flex flex-col gap-2">
              {processing.map((p, i) => (
                <div key={i} className="flex items-center gap-3 rounded-[10px] px-4 py-3" style={{ border: `1px solid ${C.rowBorder}`, backgroundColor: C.cardAlt }}>
                  <FileText className="h-4 w-4 shrink-0" style={{ color: C.textMuted }} />
                  <span className="text-[13px] font-medium flex-1 min-w-0 truncate" style={{ color: C.text }}>{p.name}</span>
                  {p.state === "uploading" && <Tag status="review">uploading</Tag>}
                  {p.state === "extracting" && <Tag status="review">building budget</Tag>}
                  {p.state === "done" && <Tag status="filed"><CheckCircle2 className="inline h-3 w-3 mr-1" />filed{p.detail?.drive?.folder_path ? ` - ${p.detail.drive.folder_path}` : ""}</Tag>}
                  {p.state === "review" && <Tag status="needs_review"><AlertTriangle className="inline h-3 w-3 mr-1" />{p.detail?.match_reason || p.detail?.reason || "needs review"}</Tag>}
                  {p.state === "error" && <Tag status="err">{p.detail || "failed"}</Tag>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Budgets list */}
        <Section title="Budgets" sub={`${budgets.length} on record`}>
          {budgets.length === 0 && <p className="text-[13px]" style={{ color: C.textMuted }}>No budgets yet. Drop a quote PDF above.</p>}
          <div className="overflow-x-auto obsidian-scroll">
            <table className="w-full text-left text-[13px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: C.headerBg }}>
                  {["Budget", "Cost basis", "Sell", "Margin", "Job", "Drive", "Status"].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id} style={{ borderBottom: `1px solid ${C.rowBorder}` }}>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: C.text }}>{b.title}</div>
                      <div className="text-[11px]" style={{ color: C.textFaint }}>{[b.quoted_by && `by ${b.quoted_by}`, b.openings_qty && `${b.openings_qty} openings`].filter(Boolean).join(" - ")}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{money(b.computed?.cost_material_tax)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{money(b.computed?.actual_total_sell)}</td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: (b.computed?.actual_margin_pct ?? 0) >= 0.3 ? C.accentText : C.amber }}>{pct(b.computed?.actual_margin_pct)}</td>
                    <td className="px-4 py-3 text-[12px]" style={{ color: C.textSecondary }}>
                      {b.job_id ? <Link className="font-medium underline" to={`/jobs/${encodeURIComponent(b.job_id)}`}>{jobName(b.job_id) || b.job_name || b.job_id}</Link> : <BudgetLinkReview budget={b} jobs={jobs} busy={linking === b.id} onConfirm={confirmBudgetJob} />}
                    </td>
                    <td className="px-4 py-3">
                      {b.drive_job_folder_id && (
                        <a href={`https://drive.google.com/drive/folders/${b.drive_job_folder_id}`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: C.accentText }}>
                          <FolderOpen className="h-3.5 w-3.5" />{b.drive_job_folder_path || "folder"}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3"><Tag status={b.status}>{b.status === "needs_review" ? "review" : b.status}</Tag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Unpaid jobs tracker */}
        <Section
          title="Unpaid vendor orders"
          sub={`${openPayables.length} open - ${money(openPayableTotal)} outstanding - ordered -> ETA -> ACH link -> paid -> reconciled`}>
          {orders.length === 0 && <p className="text-[13px]" style={{ color: C.textMuted }}>No vendor orders logged yet.</p>}
          {orders.map((o) => {
            const idx = ORDER_CHAIN.indexOf(o.status);
            return (
              <div key={o.id} className="rounded-[12px] px-4 py-3 flex flex-col gap-2" style={{ border: `1px solid ${C.rowBorder}`, backgroundColor: C.cardAlt }}>
                <div className="flex items-center gap-3 flex-wrap">
                  <Truck className="h-4 w-4 shrink-0" style={{ color: C.textMuted }} />
                  <span className="text-[14px] font-semibold" style={{ color: C.text }}>{o.title}</span>
                  <span className="text-[13px] font-medium" style={{ color: C.textSecondary }}>{money(o.amount)}</span>
                  <Tag status={o.status}>{ORDER_LABEL[o.status] || o.status}</Tag>
                  {idx >= 0 && idx < ORDER_CHAIN.length - 1 && (
                    <button onClick={() => advanceOrder(o)} className="text-[12px] font-semibold px-3 py-1.5 rounded-[8px]"
                      style={{ backgroundColor: C.accent, color: "#fff" }}>
                      {NEXT_ACTION[o.status]}
                    </button>
                  )}
                </div>
                <div className="text-[12px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: C.textMuted }}>
                  {o.order_number && <span>Order {o.order_number}</span>}
                  {o.po_name && <span>PO "{o.po_name}"</span>}
                  {o.billed_account && <span>billed under {o.billed_account}</span>}
                  {o.payer && <span>pays: {o.payer}</span>}
                  {o.payment_route && o.payment_route !== "unknown" && <span>via {o.payment_route.replace(/_/g, " ")}</span>}
                  {o.notes && <span>note: {o.notes}</span>}
                  {o.eta_date && <span>ETA {o.eta_date}</span>}
                  {o.ach_link && <a href={o.ach_link} target="_blank" rel="noreferrer" className="font-medium" style={{ color: C.accentText }}>ACH link</a>}
                  {o.job_id && jobName(o.job_id) && <span>job: {jobName(o.job_id)}</span>}
                </div>
              </div>
            );
          })}
          <button onClick={() => setShowOrderForm((v) => !v)} className="self-start inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-[8px]"
            style={{ border: `1px solid ${C.border}`, color: C.text }}>
            <Plus className="h-4 w-4" />Log an order
          </button>
          {showOrderForm && (
            <div className="grid grid-cols-2 max-[699px]:grid-cols-1 gap-2 rounded-[12px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
              {[
                ["order_number", "Order number (e.g. 09-3900)"],
                ["vendor", "Vendor (e.g. AMSCO)"],
                ["po_name", "PO name"],
                ["billed_account", "Billed under account"],
                ["amount", "Amount"],
                ["payer", "Who pays (e.g. Israel)"],
                ["payment_route", "Payment route (ach_link, card, check...)"],
                ["notes", "Note (e.g. ACH link pending; Israel pays on Gabriel's ok)"],
              ].map(([key, ph]) => (
                <input key={key} value={newOrder[key]} placeholder={ph}
                  onChange={(e) => setNewOrder((o) => ({ ...o, [key]: e.target.value }))}
                  className="text-[13px] px-3 py-2 rounded-[8px]" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }} />
              ))}
              <button onClick={logOrder} className="text-[13px] font-semibold px-3 py-2 rounded-[8px] col-span-2 max-[699px]:col-span-1"
                style={{ backgroundColor: C.accent, color: "#fff" }}>Save order</button>
            </div>
          )}
        </Section>

        {/* Live margin scratchpad */}
        <Scratchpad />
      </div>
    </div>
  );
}

function BudgetLinkReview({ budget, jobs, busy, onConfirm }) {
  const [choice, setChoice] = useState("");
  const rawCandidates = budget.job_match?.candidates || budget.job_match?.candidate_job_ids || [];
  const candidateIds = rawCandidates.map((candidate) => typeof candidate === "string" ? candidate : candidate?.id).filter(Boolean);
  const candidates = candidateIds.length ? jobs.filter((job) => candidateIds.includes(job.id)) : jobs;
  const evidence = [
    ...(budget.job_match?.hits || []),
    ...(budget.job_match?.evidence || []),
    budget.job_match?.reason,
  ].filter(Boolean);
  return <div className="min-w-[220px] space-y-1.5">
    <div className="font-medium">{budget.job_name || "Unlinked budget"}</div>
    <div className="text-[11px]" style={{ color: C.amber }}>{evidence.length ? evidence.join(" · ") : "No confident job match"}</div>
    {candidateIds.length > 0 && <div className="text-[10px] break-all" style={{ color: C.textFaint }}>Candidate IDs: {candidateIds.join(", ")}</div>}
    <div className="flex gap-1.5">
      <select aria-label={`Choose job for ${budget.title}`} value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy}
        className="min-w-0 flex-1 rounded border px-2 py-1 text-[11px]" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <option value="">Owner review…</option>
        {candidates.map((job) => <option key={job.id} value={job.id}>{job.canonical_name} [{job.id}]</option>)}
      </select>
      <button type="button" disabled={!choice || busy} onClick={() => onConfirm(budget, choice)} className="rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50" style={{ backgroundColor: C.accent, color: "white" }}>Confirm</button>
    </div>
  </div>;
}

function Scratchpad() {
  const [cost, setCost] = useState("");
  const [sell, setSell] = useState("");
  const b = computeJobBudget({ material_true_cost: Number(cost) || 0, actual_total_sell: Number(sell) || 0 });
  const has = Number(cost) > 0;
  return (
    <section className="rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
        <h2 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>Quick margin check</h2>
        <p className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>Same math as the Window Budget Sheet - tax 7.45%, targets at 30% material / 27% labor.</p>
      </div>
      <div className="p-5 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-[12px] font-medium" style={{ color: C.textMuted }}>
          Material true cost
          <input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="1256.98"
            className="text-[14px] px-3 py-2 rounded-[8px] w-40" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium" style={{ color: C.textMuted }}>
          Actual sell (incl. tax)
          <input value={sell} onChange={(e) => setSell(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="2411.81"
            className="text-[14px] px-3 py-2 rounded-[8px] w-40" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }} />
        </label>
        {has && (
          <div className="flex gap-6 text-[13px]" style={{ color: C.textSecondary }}>
            <span>Use tax <b>{money(b.use_tax)}</b></span>
            <span>Cost basis <b>{money(b.cost_material_tax)}</b></span>
            <span>Target sell @30% <b>{money(b.sell_material_tax_target)}</b></span>
            {Number(sell) > 0 && <span>Margin <b style={{ color: (b.actual_margin_pct ?? 0) >= 0.3 ? C.accentText : C.amber }}>{pct(b.actual_margin_pct)}</b></span>}
          </div>
        )}
      </div>
    </section>
  );
}
