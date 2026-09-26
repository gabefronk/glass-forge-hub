import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { C } from "@/lib/feeUI";
import { PageShell, PageHero, SheetCard, TILE } from "@/components/PageShell";
import PageNotFound from "@/lib/PageNotFound";
import { isPurchaseOrderOwner } from "@/lib/purchaseOrderAccess";

import { approvedSetupSheetContext, purchaseOrderSubmission } from "@/lib/purchaseOrderSetup";
import { ClipboardList, Plus, CheckCircle2, AlertTriangle } from "lucide-react";
import { fetchAllPages } from "@/lib/pagination";
import { filterJobPickerOptions } from "../../base44/shared/jobCatalog.js";

// Purchase Orders (owner only): YA-#### numbers for material orders. Numbers are
// assigned server-side by issue_purchase_order, which also appends the PO to the
// linked job's po_numbers. Everyone else gets the 404 page.

const money = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)))
  ? "-" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = (s) => { const d = s ? new Date(s) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US") : "-"; };

const EMPTY_FORM = { job_id: "", vendor: "", vendor_quote_ref: "", amount_dealer: "", amount_customer: "", notes: "" };

function statusTag(status) {
  if (status === "received" || status === "confirmed") return C.tagBillable;
  if (status === "cancelled") return C.tagReview;
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
    <SheetCard icon={ClipboardList} tile={TILE.teal} title={title} sub={sub} bodyClassName="p-5 flex flex-col gap-3 max-[699px]:p-4">
      {children}
    </SheetCard>
  );
}

export default function PurchaseOrders() {
  const { user } = useAuth();
  if (!isPurchaseOrderOwner(user)) return <PageNotFound />;
  return <PurchaseOrdersPage />;
}

function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [setupSheets, setSetupSheets] = useState([]);
  const [setupSheetsComplete, setSetupSheetsComplete] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [jobFilter, setJobFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [useSetupSheet, setUseSetupSheet] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }
  const [jobsError, setJobsError] = useState("");

  const load = useCallback(async () => {
    const [o, j, s] = await Promise.all([
      base44.entities.PurchaseOrders.list("-created_date", 500).catch(() => []),
      fetchAllPages(base44.entities.Jobs, "-created_date"),
      base44.entities.JobSetupSheets ? fetchAllPages(base44.entities.JobSetupSheets, "-created_date").then(rows => ({rows,complete:true})).catch(() => ({rows:[],complete:false})) : Promise.resolve({rows:[],complete:false}),
    ]);
    setOrders(o || []);
    setJobs(j || []);
    setSetupSheets(s.rows);
    setSetupSheetsComplete(s.complete);
    setJobsError("");
  }, []);

  const loadSafely = useCallback(async () => {
    try { await load(); }
    catch (error) { setJobs([]); setJobsError(`The complete jobs list could not be loaded. Issuing a linked PO is disabled. ${error?.message || ""}`); }
  }, [load]);

  useEffect(() => { loadSafely(); }, [loadSafely]);

  const jobOptions = useMemo(() => {
    const q = jobFilter.trim().toLowerCase();
    return filterJobPickerOptions(jobs, q, { selectedId: form.job_id })
      .sort((a, b) => String(a.canonical_name || "").localeCompare(String(b.canonical_name || "")));
  }, [jobs, jobFilter, form.job_id]);

  const jobName = (id) => jobs.find((j) => j.id === id)?.canonical_name || "";
  const setupApproval = useMemo(() => setupSheetsComplete ? approvedSetupSheetContext(setupSheets, form.job_id) : {ok:false,reason:"unavailable"}, [setupSheets, form.job_id, setupSheetsComplete]);

  async function issue() {
    if (saving) return;
    setSaving(true);
    setResult(null);
    try {
      if (jobsError) throw new Error("The complete jobs list has not loaded. Refresh before issuing a PO.");
      const job = jobs.find((j) => j.id === form.job_id);
      const payload = purchaseOrderSubmission({form: {...form, job_name: job?.canonical_name, builder: job?.builder, customer_name: job?.customer_name}, context: useSetupSheet ? setupApproval.context : null, reviewed});
      if (!payload || (useSetupSheet && !setupApproval.ok)) throw new Error("Select a job, or confirm the approved setup sheet if using it");
      const res = await base44.functions.invoke("issue_purchase_order", payload);
      const data = res?.data ?? res;
      if (!data?.po_number) throw new Error(data?.error || "PO was not issued");
      const linkNote = data.job_update && !data.job_update.ok ? ` (job link failed: ${data.job_update.error})` : "";
      setResult({ ok: !linkNote, text: `Issued ${data.po_number}${linkNote}` });
      setForm(EMPTY_FORM);
      setJobFilter("");
      setReviewed(false);
      setUseSetupSheet(false);
      setShowForm(false);
      loadSafely();
    } catch (e) {
      setResult({ ok: false, text: String(e?.message || e) });
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text };

  return (
    <PageShell width="max-w-[1080px]" className="!mx-0">
      <PageHero eyebrow="YA Windows · Orders" title="Purchase Orders" sub="YA Windows and Doors PO numbers for material orders. Each new PO takes the next YA-#### number and is added to the linked job's PO list. Numbers are never reused." />

      <div className="flex flex-col gap-[18px]">
        {jobsError && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{jobsError}</p>}
        <Section title="Purchase orders" sub={`${orders.length} on record`}>
          {result && (
            <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: result.ok ? C.accentText : C.amber }}>
              {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{result.text}
            </div>
          )}
          {orders.length === 0 && <p className="text-[13px]" style={{ color: C.textMuted }}>No purchase orders yet.</p>}
          {orders.length > 0 && (
            <div className="overflow-x-auto obsidian-scroll">
              <table className="w-full text-left text-[13px]" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ backgroundColor: C.headerBg }}>
                    {["PO", "Job", "Vendor", "Quote ref", "Dealer", "Customer", "Status", "Created"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} style={{ borderBottom: `1px solid ${C.rowBorder}` }}>
                      <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: C.text }}>{o.po_number}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: C.textSecondary }}>
                        <div>{o.job_name || (o.job_id && jobName(o.job_id)) || "-"}</div>
                        {(o.builder || o.customer_name) && <div className="text-[11px]" style={{ color: C.textFaint }}>{[o.builder, o.customer_name].filter(Boolean).join(" - ")}</div>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{o.vendor || "-"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{o.vendor_quote_ref || "-"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{money(o.amount_dealer)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{money(o.amount_customer)}</td>
                      <td className="px-4 py-3"><Tag status={o.status}>{o.status}</Tag></td>
                      <td className="px-4 py-3 whitespace-nowrap text-[12px]" style={{ color: C.textMuted }}>{shortDate(o.created_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={() => { setShowForm((v) => !v); setReviewed(false); setUseSetupSheet(false); }} className="self-start inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-[8px]"
            style={{ border: `1px solid ${C.border}`, color: C.text }}>
            <Plus className="h-4 w-4" />Issue a PO
          </button>
          {showForm && (
            <div className="grid grid-cols-2 max-[699px]:grid-cols-1 gap-2 rounded-[12px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
              <input value={jobFilter} aria-label="Search jobs" placeholder="Search name, ID, BFS PO, OE, or YA PO"
                onChange={(e) => setJobFilter(e.target.value)}
                className="text-[13px] px-3 py-2 rounded-[8px]" style={inputStyle} />
              <select aria-label="Job" value={form.job_id} disabled={Boolean(jobsError)} onChange={(e) => { setForm((f) => ({ ...f, job_id: e.target.value })); setReviewed(false); setUseSetupSheet(false); }}
                className="text-[13px] px-3 py-2 rounded-[8px]" style={inputStyle}>
                <option value="">Select a job</option>
                {jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>{[j.canonical_name || j.id, j.builder].filter(Boolean).join(" - ")}</option>
                ))}
              </select>
              <div className="col-span-2 max-[699px]:col-span-1 rounded-[8px] px-3 py-2 text-[12px]" role="status"
                style={{ border: `1px solid ${C.border}`, color: C.textMuted }}>
                {setupApproval.ok
                  ? `Optional setup sheet marked approved: ${setupApproval.context.setup_sheet_approver_name} · ${shortDate(setupApproval.context.setup_sheet_approved_date)}. Entered audit fields are not proof of approval by that person.`
                  : setupApproval.reason === "ambiguous"
                    ? "Multiple approved sheets; manual PO remains available. Sheet context requires one sheet marked approved."
                    : "No sheet marked approved is available. Manual PO remains available."}
              </div>
              {setupApproval.ok && <Link to={`/jobs/${form.job_id}/setup`} target="_blank" rel="noopener noreferrer" className="col-span-2 max-[699px]:col-span-1 text-[13px] underline">Open sheet for review</Link>}
              {setupApproval.ok && <label className="col-span-2 max-[699px]:col-span-1 flex items-start gap-2 text-[13px]" style={{ color: C.text }}>
                <input type="checkbox" checked={useSetupSheet} onChange={(e) => { setUseSetupSheet(e.target.checked); setReviewed(false); }} />
                Use the sheet as job context (optional).
              </label>}
              {[
                ["vendor", "Vendor (e.g. AMSCO)"],
                ["vendor_quote_ref", "Vendor quote ref (e.g. 3517590)"],
                ["amount_dealer", "Dealer amount"],
                ["amount_customer", "Customer amount"],
              ].map(([key, ph]) => (
                <input key={key} value={form[key]} placeholder={ph}
                  onChange={(e) => {
                    const v = key.startsWith("amount_") ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value;
                    setForm((f) => ({ ...f, [key]: v })); setReviewed(false);
                  }}
                  className="text-[13px] px-3 py-2 rounded-[8px]" style={inputStyle} />
              ))}
              <input value={form.notes} placeholder="Notes"
                onChange={(e) => { setForm((f) => ({ ...f, notes: e.target.value })); setReviewed(false); }}
                className="text-[13px] px-3 py-2 rounded-[8px] col-span-2 max-[699px]:col-span-1" style={inputStyle} />
              <p className="col-span-2 max-[699px]:col-span-1 text-[12px]" style={{ color: C.textMuted }}>
                Vendor, quote/reference, dealer cost, and customer amount are manual PO fields. Setup-sheet whole-job pricing is never copied here.
              </p>
              {useSetupSheet && <label className="col-span-2 max-[699px]:col-span-1 flex items-start gap-2 text-[13px]" style={{ color: C.text }}>
                <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
                I reviewed the sheet and every manual PO field. This checkbox does not approve a vendor purchase; issue only when I press submit.
              </label>}
              <button onClick={issue} disabled={saving || Boolean(jobsError) || !form.job_id || (useSetupSheet && (!reviewed || !setupApproval.ok))} className="text-[13px] font-semibold px-3 py-2 rounded-[8px] col-span-2 max-[699px]:col-span-1 disabled:opacity-60"
                style={{ backgroundColor: C.accent, color: "#fff" }}>{saving ? "Issuing..." : useSetupSheet ? "Review complete - submit and issue PO" : "Issue PO number"}</button>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
