import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { C } from "@/lib/feeUI";
import PageNotFound from "@/lib/PageNotFound";
import { isPurchaseOrderOwner } from "@/lib/purchaseOrderAccess";
import { canSubmitPurchaseOrder, selectJobSetupSheetPrefill } from "@/lib/jobSetupSheetPurchaseOrder";
import { ClipboardList, Plus, CheckCircle2, AlertTriangle } from "lucide-react";

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
    <section className="rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
        <h2 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>{title}</h2>
        {sub && <p className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>{sub}</p>}
      </div>
      <div className="p-5 flex flex-col gap-3">{children}</div>
    </section>
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
  const [form, setForm] = useState(EMPTY_FORM);
  const [jobFilter, setJobFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [prefillState, setPrefillState] = useState("unselected");
  const [result, setResult] = useState(null); // { ok, text }

  const load = useCallback(async () => {
    const [o, j, sheets] = await Promise.all([
      base44.entities.PurchaseOrders.list("-created_date", 500).catch(() => []),
      base44.entities.Jobs.list("-created_date", 1000).catch(() => []),
      // PR #3 supplies this entity. Until it lands, the adapter is a no-op.
      base44.entities.JobSetupSheets?.list?.("-created_date", 1000)?.catch(() => []) ?? Promise.resolve([]),
    ]);
    setOrders(o || []);
    setJobs(j || []);
    setSetupSheets(sheets || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const jobOptions = useMemo(() => {
    const q = jobFilter.trim().toLowerCase();
    return jobs
      .filter((j) => !q || [j.id, j.canonical_name, j.builder, j.customer_name, ...(j.po_numbers || []), ...(j.oe_numbers || [])].some((v) => String(v || "").toLowerCase().includes(q)) || j.id === form.job_id)
      .sort((a, b) => String(a.canonical_name || "").localeCompare(String(b.canonical_name || "")));
  }, [jobs, jobFilter, form.job_id]);

  const jobName = (id) => jobs.find((j) => j.id === id)?.canonical_name || "";

  function selectJob(jobId) {
    const prefill = selectJobSetupSheetPrefill(setupSheets, jobId);
    setPrefillState(prefill.state);
    setOwnerConfirmed(false);
    setForm((current) => ({
      ...EMPTY_FORM,
      job_id: jobId,
      ...(prefill.draft || {}),
      notes: current.job_id === jobId ? current.notes : "",
    }));
  }

  async function issue() {
    if (!canSubmitPurchaseOrder({ saving, jobId: form.job_id, ownerConfirmed })) return;
    setSaving(true);
    setResult(null);
    try {
      const job = jobs.find((j) => j.id === form.job_id);
      const payload = {
        vendor: form.vendor,
        vendor_quote_ref: form.vendor_quote_ref,
        notes: form.notes,
        amount_dealer: form.amount_dealer === "" ? undefined : Number(form.amount_dealer),
        amount_customer: form.amount_customer === "" ? undefined : Number(form.amount_customer),
      };
      if (job) Object.assign(payload, { job_id: job.id, job_name: job.canonical_name, builder: job.builder, customer_name: job.customer_name });
      const res = await base44.functions.invoke("issue_purchase_order", payload);
      const data = res?.data ?? res;
      if (!data?.po_number) throw new Error(data?.error || "PO was not issued");
      const linkNote = data.job_update && !data.job_update.ok ? ` (job link failed: ${data.job_update.error})` : "";
      setResult({ ok: !linkNote, text: `Issued ${data.po_number}${linkNote}` });
      setForm(EMPTY_FORM);
      setOwnerConfirmed(false);
      setPrefillState("unselected");
      setJobFilter("");
      setShowForm(false);
      load();
    } catch (e) {
      setResult({ ok: false, text: String(e?.message || e) });
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text };

  return (
    <div className="flex flex-col" style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }}>
      <header className="shrink-0 px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-5" style={{ background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))", color: "var(--gf-sidebar-text-on)" }}>
        <div className="flex items-center gap-3">
          <ClipboardList className="h-7 w-7" style={{ color: "var(--gf-brass-300)" }} strokeWidth={1.8} strokeLinecap="round" />
          <h1 className="font-heading text-[30px] font-bold" style={{ color: "var(--gf-sidebar-text-on)", letterSpacing: "-0.03em" }}>Purchase Orders</h1>
        </div>
        <p className="mt-2 text-[13px] max-w-[680px]" style={{ color: "var(--gf-sidebar-muted)" }}>
          YA Windows and Doors PO numbers for material orders. Each new PO takes the next YA-#### number
          and is added to the linked job's PO list. Numbers are never reused.
        </p>
      </header>

      <div className="px-[26px] max-[699px]:px-[18px] py-6 flex flex-col gap-6 max-w-[1080px]">
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
          <button onClick={() => setShowForm((v) => !v)} className="self-start inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-[8px]"
            style={{ border: `1px solid ${C.border}`, color: C.text }}>
            <Plus className="h-4 w-4" />Issue a PO
          </button>
          {showForm && (
            <div className="grid grid-cols-2 max-[699px]:grid-cols-1 gap-2 rounded-[12px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
              <input value={jobFilter} placeholder="Filter jobs (name, ID, BFS PO, OE, YA PO)"
                onChange={(e) => setJobFilter(e.target.value)}
                className="text-[13px] px-3 py-2 rounded-[8px]" style={inputStyle} />
              <select value={form.job_id} onChange={(e) => selectJob(e.target.value)}
                className="text-[13px] px-3 py-2 rounded-[8px]" style={inputStyle}>
                <option value="">No job linked</option>
                {jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>{[j.canonical_name || j.id, j.builder].filter(Boolean).join(" - ")}</option>
                ))}
              </select>
              {form.job_id && prefillState !== "ready" && (
                <p className="col-span-2 max-[699px]:col-span-1 text-[12px]" role="status" style={{ color: C.textMuted }}>
                  {prefillState === "ambiguous"
                    ? "More than one confirmed Job Setup Sheet matches this job. No vendor or amount was prefilled."
                    : "No confirmed Job Setup Sheet matches this job. Enter only owner-reviewed vendor and price details."}
                </p>
              )}
              {prefillState === "ready" && (
                <p className="col-span-2 max-[699px]:col-span-1 text-[12px]" role="status" style={{ color: C.accentText }}>
                  Drafted from the job's single confirmed Job Setup Sheet. Review every value before issuing.
                </p>
              )}
              {[
                ["vendor", "Vendor (e.g. AMSCO)"],
                ["vendor_quote_ref", "Vendor quote ref (e.g. 3517590)"],
                ["amount_dealer", "Dealer amount"],
                ["amount_customer", "Customer amount"],
              ].map(([key, ph]) => (
                <input key={key} value={form[key]} placeholder={ph}
                  onChange={(e) => {
                    const v = key.startsWith("amount_") ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value;
                    setForm((f) => ({ ...f, [key]: v }));
                  }}
                  className="text-[13px] px-3 py-2 rounded-[8px]" style={inputStyle} />
              ))}
              <input value={form.notes} placeholder="Notes"
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="text-[13px] px-3 py-2 rounded-[8px] col-span-2 max-[699px]:col-span-1" style={inputStyle} />
              <label className="col-span-2 max-[699px]:col-span-1 flex items-start gap-2 text-[12px]" style={{ color: C.textSecondary }}>
                <input type="checkbox" checked={ownerConfirmed} onChange={(e) => setOwnerConfirmed(e.target.checked)} className="mt-0.5" />
                I reviewed the job, vendor, quote reference, and amounts. Issue this PO only when I submit.
              </label>
              <button onClick={issue} disabled={!canSubmitPurchaseOrder({ saving, jobId: form.job_id, ownerConfirmed })} className="text-[13px] font-semibold px-3 py-2 rounded-[8px] col-span-2 max-[699px]:col-span-1 disabled:opacity-60"
                style={{ backgroundColor: C.accent, color: "#fff" }}>{saving ? "Issuing..." : "Issue PO number"}</button>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
