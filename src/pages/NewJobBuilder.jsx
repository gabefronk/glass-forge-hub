import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Check, UploadCloud, Building2, MapPin, User, Calendar,
  FileText, DollarSign, CheckCircle2, Pencil, Loader2,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import { C } from "@/lib/feeUI";
import { money, percent, buttonClass, primaryStyle, secondaryStyle, Field } from "@/components/budgets/ProcurementForms";
import SaleWonBanner from "@/components/new-job/SaleWonBanner";
import MonthAchievement from "@/components/new-job/MonthAchievement";
import { base44 } from "@/api/base44Client";
import { findMatchWarnings } from "@/lib/newJob";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import JobMatchWarningDialog from "@/components/jobs/JobMatchWarningDialog";
import { createWizardBudgetSaver, wizardRequestKey } from "@/lib/newJobBudgetDraft";
import NewJobOwnerGate from "@/components/new-job/NewJobOwnerGate";

const SALES_TAX_RATE = 0.0745;
const newWizardId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const BUILDER_PRESETS = [
  { key: "shelby", name: "Shelby Homes", contact: "Camden Brien", phone: "801-555-0142", email: "camden@shelbyhomes.com", billing: "Net 30", leadWeeks: 4, blurb: "Production · vinyl package" },
  { key: "cadence", name: "Cadence Homes", contact: "Marisa Lloyd", phone: "385-555-0190", email: "marisa@cadencehomes.com", billing: "Net 45", leadWeeks: 5, blurb: "Production · vinyl & patio" },
  { key: "other", name: "Someone else", contact: "", phone: "", email: "", billing: "", leadWeeks: 4, blurb: "Custom or one-off" },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const addWeeks = (dateStr, weeks) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
};

// Auto-suggest a short job code from the job name + builder, e.g.
// "Shelby Homes - 215 Skyridge" + "Shelby Homes" -> "SH215". Editable.
function suggestJobCode(name, builderName) {
  const digits = (String(name || "").match(/\d+/g) || []).join("");
  const prefix = (builderName || "").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
  return digits ? `${prefix}${digits}` : "";
}

const STEPS = [
  { key: "builder", title: "Builder", icon: Building2 },
  { key: "address", title: "Address", icon: MapPin },
  { key: "contact", title: "Site contact", icon: User },
  { key: "leads", title: "Dates", icon: Calendar },
  { key: "quote", title: "Quote", icon: FileText },
  { key: "money", title: "Money", icon: DollarSign },
];

function InlineEdit({ value, onCommit, type = "text", mono = false, placeholder = "—" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const commit = () => { onCommit(draft); setEditing(false); };
  if (editing) {
    return (
      <input
        autoFocus type={type} step={type === "number" ? "any" : undefined} min={type === "number" ? "0" : undefined}
        value={draft} placeholder={placeholder}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); } }}
        className={`w-full min-w-0 rounded-[6px] px-1.5 py-0.5 text-[14px] font-bold outline-none focus:ring-2 ${mono ? "font-ref" : ""}`}
        style={{ color: "#f2eee8", backgroundColor: "rgba(255,255,255,.14)", border: "1px solid rgba(224,201,148,.6)", "--tw-ring-color": "rgba(224,201,148,.5)" }}
      />
    );
  }
  const empty = value === "" || value == null;
  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex w-full min-w-0 items-center gap-1.5 text-left">
      <span className={`truncate ${empty ? "italic" : ""} ${mono ? "font-ref" : ""} text-[13px] font-bold`} style={{ color: empty ? "#8f999b" : "#f2eee8" }}>{empty ? placeholder : value}</span>
      <Pencil size={11} className="shrink-0 opacity-40 transition group-hover:opacity-90" style={{ color: "#e0c994" }} />
    </button>
  );
}

function InlineEditLight({ value, onCommit, type = "text", mono = false, placeholder = "—" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const commit = () => { onCommit(draft); setEditing(false); };
  if (editing) {
    return (
      <input
        autoFocus type={type} step={type === "number" ? "any" : undefined} min={type === "number" ? "0" : undefined}
        value={draft} placeholder={placeholder}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); } }}
        className={`w-full min-w-0 rounded-[6px] px-1.5 py-0.5 text-[13px] font-bold outline-none focus:ring-2 ${mono ? "font-ref" : ""}`}
        style={{ color: "#101617", backgroundColor: "#fff", border: "1px solid #0b3f3b", "--tw-ring-color": "rgba(11,63,59,.4)" }}
      />
    );
  }
  const empty = value === "" || value == null;
  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex w-full min-w-0 items-center gap-1.5 text-left">
      <span className={`truncate ${empty ? "italic" : ""} ${mono ? "font-ref" : ""} text-[12.5px] font-bold`} style={{ color: empty ? "#8a8f93" : "#101617" }}>{empty ? placeholder : value}</span>
      <Pencil size={11} className="shrink-0 opacity-0 transition group-hover:opacity-70" style={{ color: "#0b3f3b" }} />
    </button>
  );
}

function StepShell({ icon: Icon, title, children }) {
  return <SheetCard icon={Icon} tile={TILE.teal} title={title} bodyClassName="px-4 py-3 max-[699px]:px-3">{children}</SheetCard>;
}

function MoneyStat({ label, value, tone }) {
  const color = tone === "profit" ? "#166447" : "#101617";
  return (
    <div className="rounded-[10px] p-3" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
      <div className="text-[10px] font-semibold tracking-[.12em]" style={{ color: "#8a8f93" }}>{label.toUpperCase()}</div>
      <div className="mt-0.5 text-[20px] font-extrabold tabular-nums" style={{ color, letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}

export default function NewJobBuilder() {
  const navigate = useNavigate();
  const [s, setS] = useState(() => ({
    jobName: "",
    jobCode: "",
    windowPO: "",
    mfgOrder: "",
    builderKey: "shelby",
    builderCustom: { contact: "", phone: "", email: "", billing: "", leadWeeks: 4 },
    address: { street: "", city: "", lot: "" },
    contact: { name: "", phone: "", email: "" },
    leads: { orderDate: todayStr(), delivery: addWeeks(todayStr(), 4), install: addWeeks(todayStr(), 5) },
    quote: { vendor: "", quoteNumber: "", units: "", material: "", fileName: "" },
    money: { cost: "", sale: "" },
  }));
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [formError, setFormError] = useState("");
  const [matchWarning, setMatchWarning] = useState(null);
  const [forceCreate, setForceCreate] = useState(false);
  const [leadsTouched, setLeadsTouched] = useState(false);
  const [jobCodeTouched, setJobCodeTouched] = useState(false);
  const [authState, setAuthState] = useState("loading"); // loading | owner | denied
  const [budgetState, setBudgetState] = useState("pending"); // pending | saved | failed | uncertain | conflict | not_allowed
  const [budgetError, setBudgetError] = useState("");
  const [wizardId, setWizardId] = useState(newWizardId);
  const creatingRef = useRef(false);
  const saverRef = useRef(null);
  if (!saverRef.current) saverRef.current = createWizardBudgetSaver({ api: base44.entities.JobBudgets, getUser: () => base44.auth.me(), isOwner: isAgentCenterOwner });
  const set = (patch) => setS(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    let active = true;
    base44.auth.me()
      .then(u => { if (active) setAuthState(isAgentCenterOwner(u) ? "owner" : "denied"); })
      .catch(() => { if (active) setAuthState("denied"); });
    return () => { active = false; };
  }, []);

  // Load existing eligible jobs once for the duplicate guard (owner only).
  useEffect(() => {
    if (authState !== "owner") return;
    let active = true;
    (async () => {
      const out = [];
      let cursor;
      for (;;) {
        const page = await base44.entities.Jobs.filter(
          { is_sample: { $ne: true }, merged_into: { $exists: false } },
          { sort: "-created_date", limit: 1000, cursor, fields: ["id", "canonical_name", "address", "builder", "po_numbers", "stage"] }
        );
        out.push(...(page.items || []));
        if (!page.has_more) break;
        cursor = page.next_cursor;
      }
      if (active) setJobs(out);
    })().catch(() => {});
    return () => { active = false; };
  }, [authState]);

  const builder = BUILDER_PRESETS.find(p => p.key === s.builderKey) || BUILDER_PRESETS[2];
  const builderName = builder.key === "other" ? (s.builderCustom.name || "") : builder.name;
  const builderFields = builder.key === "other" ? s.builderCustom : builder;
  const tax = Math.round((Number(s.money.sale) || 0) * SALES_TAX_RATE * 100) / 100;
  const cost = Number(s.money.cost) || 0;
  const sale = Number(s.money.sale) || 0;
  const profit = sale - cost;
  const profitPct = cost > 0 ? profit / cost : 0;
  const customerTotal = sale + tax;
  const atReview = step === STEPS.length;

  // Auto-suggest a job code from the job name until the user manually edits it.
  useEffect(() => {
    if (jobCodeTouched) return;
    set({ jobCode: suggestJobCode(s.jobName, builderName) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.jobName, builderName]);

  function pickBuilder(key) {
    set({ builderKey: key });
    if (!leadsTouched) {
      const lw = (BUILDER_PRESETS.find(p => p.key === key) || {}).leadWeeks || 4;
      set({ leads: { ...s.leads, delivery: addWeeks(s.leads.orderDate || todayStr(), lw), install: addWeeks(s.leads.orderDate || todayStr(), lw + 1) } });
    }
    if (key === "other") set({ builderCustom: { ...s.builderCustom, name: s.builderCustom.name || "" } });
  }

  const fullAddress = useMemo(() => {
    const head = [s.address.street.trim(), s.address.lot.trim()].filter(Boolean).join(" ");
    return [head, s.address.city.trim()].filter(Boolean).join(", ");
  }, [s.address]);

  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    set({ quote: { ...s.quote, fileName: file ? file.name : s.quote.fileName } });
  }

  function validateRequired() {
    if (!s.jobName.trim()) return "Job name is required.";
    if (!builderName.trim()) return "Builder is required.";
    if (!s.address.street.trim()) return "Address is required.";
    return "";
  }

  async function doCreate() {
    if (authState !== "owner") { setFormError("Only the owner can create jobs from this builder."); return; }
    const err = validateRequired();
    if (err) { setFormError(err); return; }
    if (created?.jobId) { setFormError("This job was already created. Open it instead of submitting twice."); return; }
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true); setFormError(""); setBudgetState("pending"); setBudgetError("");
    try {
      const jobPayload = {
        canonical_name: s.jobName.trim(),
        builder: builderName.trim(),
        address: fullAddress,
        stage: "sold",
        ...(s.windowPO.trim() ? { po_numbers: [s.windowPO.trim()] } : {}),
      };
      const job = await base44.entities.Jobs.create(jobPayload);
      setCreated({ jobId: job.id });
      // Cost / sale go to a JobBudgets draft (admin-only RLS), keyed to this
      // wizard session so a retry reconciles instead of duplicating.
      if (cost > 0 || sale > 0) await saveBudget(job.id);
    } catch (e) {
      setFormError(e?.response?.data?.error || e?.message || "The job could not be created. Please try again.");
    } finally { creatingRef.current = false; setCreating(false); }
  }

  // Save (or reconcile) the draft budget for the already-created job. Used by
  // the initial create and the retry button — never recreates the job.
  async function saveBudget(jobId) {
    setBudgetState("pending"); setBudgetError("");
    const r = await saverRef.current({
      jobId,
      requestKey: wizardRequestKey(wizardId),
      payload: {
        title: `${s.jobName.trim()} - initial budget`,
        status: "draft",
        budget_usage: "draft",
        job_name: s.jobName.trim(),
        builder: builderName.trim(),
        ...(s.quote.vendor ? { manufacturer: s.quote.vendor } : {}),
        ...(s.quote.quoteNumber ? { quote_number: s.quote.quoteNumber } : {}),
        ...(Number(s.quote.units) > 0 ? { openings_qty: Number(s.quote.units) } : {}),
        inputs: { material_true_cost: cost || null, actual_total_sell: sale || null },
      },
    });
    if (r.state === "busy") return;
    setBudgetState(r.state);
    setBudgetError(r.state === "conflict" ? `More than one draft budget matches this job (${r.ids.join(", ")}).` : r.error || "");
  }

  function retryBudget() {
    if (!created?.jobId || authState !== "owner" || budgetState === "pending") return;
    saveBudget(created.jobId);
  }

  function handleCreate() {
    if (created?.jobId) { setFormError("This job was already created. Open it instead of submitting twice."); return; }
    const err = validateRequired();
    if (err) { setFormError(err); return; }
    setFormError("");
    if (forceCreate) { doCreate(); return; }
    const warnings = findMatchWarnings(jobs, { canonical_name: s.jobName, address: fullAddress, po_number: s.windowPO });
    if (warnings.strong.length || warnings.medium.length) {
      setMatchWarning({ strong: warnings.strong, medium: warnings.medium });
      return;
    }
    doCreate();
  }

  function handleOpenExisting() {
    const first = [...(matchWarning?.strong || []), ...(matchWarning?.medium || [])][0];
    setMatchWarning(null);
    if (first) navigate(`/jobs/${first.id}`);
  }
  function handleCreateAnyway() { setMatchWarning(null); setForceCreate(true); doCreate(); }

  if (authState !== "owner") return <NewJobOwnerGate loading={authState === "loading"} />;

  return (
    <PageShell width="max-w-[960px]">
      <Link to="/purchasing" className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: C.text }}><ArrowLeft size={14} /> Purchasing</Link>

      {/* Sticky header — compact, four inline-edit fields */}
      <div className="sticky top-0 z-30 rounded-[14px]" style={{ background: "linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)", boxShadow: "0 12px 30px -20px rgba(10,29,31,.7)" }}>
        <div className="px-4 py-2.5 max-[699px]:px-3">
          <div className="flex items-center gap-2.5">
            <h1 className="m-0 text-[15px] font-bold" style={{ color: "#f2eee8", letterSpacing: "-0.02em" }}>New job</h1>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 lg:grid-cols-4">
            {[
              { label: "Job name", value: s.jobName, key: "jobName", placeholder: "Job name" },
              { label: "Job code", value: s.jobCode, key: "jobCode", mono: true, placeholder: "SH215" },
              { label: "Window PO", value: s.windowPO, key: "windowPO", mono: true, placeholder: "Optional" },
              { label: "Mfg order #", value: s.mfgOrder, key: "mfgOrder", mono: true, placeholder: "Not ordered" },
            ].map(f => (
              <label key={f.key} className="block min-w-0">
                <span className="block text-[9.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>{f.label.toUpperCase()}</span>
                <div className="mt-0.5">
                  <InlineEdit value={f.value} mono={f.mono} placeholder={f.placeholder} onCommit={v => { if (f.key === "jobCode") setJobCodeTouched(true); set({ [f.key]: v }); }} />
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-1">
        {STEPS.concat([{ key: "review", title: "Review", icon: CheckCircle2 }]).map((st, i) => {
          const done = i < step, current = i === step;
          return (
            <div key={st.key} className="flex flex-1 flex-col items-center gap-0.5">
              <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: done || current ? "#0b3f3b" : "#e0dacf" }} />
              <span className="text-[10px] font-semibold" style={{ color: current ? "#0b3f3b" : done ? "#3e5a55" : "#8a8f93" }}>{st.title}</span>
            </div>
          );
        })}
      </div>

      {/* Step content */}
      {!atReview && (() => {
        const st = STEPS[step]; const Icon = st.icon;
        return (
          <StepShell icon={Icon} title={st.title}>
            {step === 0 && (
              <>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {BUILDER_PRESETS.map(p => {
                    const selected = s.builderKey === p.key;
                    return (
                      <button key={p.key} type="button" onClick={() => pickBuilder(p.key)} className="rounded-[10px] p-3 text-left transition" style={{ backgroundColor: selected ? "#eef5f3" : "#ffffff", border: `1.5px solid ${selected ? "#0b3f3b" : "#e0dacf"}`, boxShadow: selected ? "0 0 0 3px rgba(11,63,59,.08)" : "none" }}>
                        <div className="flex items-center justify-between">
                          <Building2 size={16} style={{ color: selected ? "#0b3f3b" : "#8a8f93" }} />
                          {selected && <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: "#0b3f3b" }}><Check size={12} className="text-white" /></span>}
                        </div>
                        <div className="mt-1.5 text-[14px] font-bold" style={{ color: "#101617" }}>{p.name}</div>
                        <div className="text-[11.5px]" style={{ color: "#616a6d" }}>{p.blurb}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 grid gap-2.5 rounded-[10px] p-3 sm:grid-cols-2" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
                  {builder.key === "other"
                    ? <Field label="Builder name" value={s.builderCustom.name || ""} onChange={v => set({ builderCustom: { ...s.builderCustom, name: v } })} />
                    : <div className="text-[12px]" style={{ color: "#566063" }}>Preset values below are editable defaults. Override them for this job as needed.</div>}
                  <Field label="Contact" value={builderFields.contact} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, contact: v } }) : set({})} />
                  <Field label="Phone" value={builderFields.phone} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, phone: v } }) : set({})} />
                  <Field label="Email" value={builderFields.email} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, email: v } }) : set({})} />
                  <Field label="Billing terms" value={builderFields.billing} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, billing: v } }) : set({})} />
                </div>
              </>
            )}

            {step === 1 && (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label="Street address" value={s.address.street} onChange={v => set({ address: { ...s.address, street: v } })} /></div>
                <Field label="City, State" value={s.address.city} onChange={v => set({ address: { ...s.address, city: v } })} />
                <Field label="Lot / unit" value={s.address.lot} onChange={v => set({ address: { ...s.address, lot: v } })} />
                <div className="sm:col-span-2 rounded-[8px] px-3 py-2 text-[12px]" style={{ backgroundColor: "#eef5f3", color: "#082f2c", border: "1px solid #c7e4d2" }}>
                  Lot is matched against existing jobs to catch duplicates. For Daybreak, lot numbers repeat across communities, so the full street address keeps communities from cross-linking.
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Name" value={s.contact.name} onChange={v => set({ contact: { ...s.contact, name: v } })} />
                <Field label="Phone" value={s.contact.phone} onChange={v => set({ contact: { ...s.contact, phone: v } })} />
                <div className="sm:col-span-2"><Field label="Email" value={s.contact.email} onChange={v => set({ contact: { ...s.contact, email: v } })} /></div>
                <div className="sm:col-span-2 text-[11.5px]" style={{ color: "#8a8f93" }}>Saved to the job after creation — link a contact from the job page.</div>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Field label="Order date" type="date" value={s.leads.orderDate} onChange={v => { setLeadsTouched(true); set({ leads: { ...s.leads, orderDate: v } }); }} />
                <Field label="Delivery" type="date" value={s.leads.delivery} onChange={v => { setLeadsTouched(true); set({ leads: { ...s.leads, delivery: v } }); }} />
                <Field label="Install" type="date" value={s.leads.install} onChange={v => { setLeadsTouched(true); set({ leads: { ...s.leads, install: v } }); }} />
                <div className="sm:col-span-3 rounded-[8px] px-3 py-2 text-[12px]" style={{ backgroundColor: "#eef5f3", color: "#082f2c", border: "1px solid #c7e4d2" }}>
                  ~{builderFields.leadWeeks} weeks order-to-delivery (default from the builder preset). Set the mfg order # when you order.
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} className="flex flex-col items-center gap-1.5 rounded-[10px] border-2 border-dashed px-4 py-5 text-center" style={{ borderColor: dragging ? "#0b3f3b" : "#d3cabb", backgroundColor: dragging ? "#eef5f3" : "#f4f1ea" }}>
                  <UploadCloud size={22} style={{ color: "#0b3f3b" }} />
                  <strong className="text-[13px]" style={{ color: "#101617" }}>Drop quote PDF (optional)</strong>
                  <span className="text-[11px]" style={{ color: "#8a8f93" }}>Enter the quote details below, or add the PDF later from the job.</span>
                </div>
                <div className="mt-3 rounded-[10px] p-3" style={{ backgroundColor: "#ffffff", border: "1px solid #e0dacf" }}>
                  <div className="flex items-center gap-2">
                    <FileText size={15} style={{ color: "#0b3f3b" }} />
                    <span className="truncate text-[13px] font-bold" style={{ color: "#101617" }}>{s.quote.fileName || "No file attached"}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                    <div><div className="text-[10px]" style={{ color: "#8a8f93" }}>Vendor</div><input className="mt-0.5 w-full rounded-[6px] px-1.5 py-1 text-[12px] font-bold" style={{ border: "1px solid #d3cabb", color: "#101617" }} value={s.quote.vendor} onChange={e => set({ quote: { ...s.quote, vendor: e.target.value } })} /></div>
                    <div><div className="text-[10px]" style={{ color: "#8a8f93" }}>Quote #</div><input className="mt-0.5 w-full rounded-[6px] px-1.5 py-1 text-[12px] font-bold font-ref" style={{ border: "1px solid #d3cabb", color: "#101617" }} value={s.quote.quoteNumber} onChange={e => set({ quote: { ...s.quote, quoteNumber: e.target.value } })} /></div>
                    <div><div className="text-[10px]" style={{ color: "#8a8f93" }}>Units</div><input type="number" min="0" className="mt-0.5 w-full rounded-[6px] px-1.5 py-1 text-[12px] font-bold" style={{ border: "1px solid #d3cabb", color: "#101617" }} value={s.quote.units} onChange={e => set({ quote: { ...s.quote, units: e.target.value } })} /></div>
                    <div><div className="text-[10px]" style={{ color: "#8a8f93" }}>Material</div><input type="number" min="0" step="any" className="mt-0.5 w-full rounded-[6px] px-1.5 py-1 text-[12px] font-bold" style={{ border: "1px solid #d3cabb", color: "#101617" }} value={s.quote.material} onChange={e => set({ quote: { ...s.quote, material: e.target.value } })} /></div>
                  </div>
                  <button className={buttonClass + " mt-2.5"} style={secondaryStyle} onClick={() => set({ money: { ...s.money, cost: s.quote.material } })}>Use material as my cost</button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div>
                <SaleWonBanner cost={cost} sale={sale} profit={profit} profitPct={profitPct} />
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  <label className="block">
                    <span className="block text-[11px] font-semibold" style={{ color: "#566063" }}>Cost</span>
                    <input type="number" min="0" step="any" value={s.money.cost} onChange={e => set({ money: { ...s.money, cost: e.target.value } })} className="mt-1 w-full rounded-[8px] px-2.5 py-2 text-[16px] font-bold tabular-nums" style={{ border: "1px solid #d3cabb", color: "#101617", backgroundColor: "#fff" }} />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-semibold" style={{ color: "#566063" }}>Sale price</span>
                    <input type="number" min="0" step="any" value={s.money.sale} onChange={e => set({ money: { ...s.money, sale: e.target.value } })} className="mt-1 w-full rounded-[8px] px-2.5 py-2 text-[16px] font-bold tabular-nums" style={{ border: "1px solid #d3cabb", color: "#101617", backgroundColor: "#fff" }} />
                  </label>
                </div>
                <div className="mt-3 rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
                  <div className="flex items-center justify-between"><span style={{ color: "#566063" }}>Sale price</span><strong>{money(sale)}</strong></div>
                  <div className="mt-1 flex items-center justify-between"><span style={{ color: "#566063" }}>Tax (7.45%)</span><strong>{money(tax)}</strong></div>
                  <div className="mt-1 flex items-center justify-between" style={{ borderTop: "1px solid #d3cabb", paddingTop: 6 }}><span style={{ color: "#566063" }}>Customer total</span><strong>{money(customerTotal)}</strong></div>
                  <div className="mt-1 flex items-center justify-between"><span style={{ color: "#566063" }}>Profit</span><strong style={{ color: profit >= 0 ? "#166447" : "#a43432" }}>{money(profit)} · {percent(profitPct)}</strong></div>
                </div>
                <div className="mt-1.5 text-[10.5px] font-medium" style={{ color: "#8a8f93" }}>No auto margin — you set the price; tax is the only thing added. Cost and sale are saved to a draft budget (admin-only).</div>
                <MonthAchievement thisJob={sale} />
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button className={buttonClass} style={secondaryStyle} disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={14} />Back</button>
              <button className={buttonClass} style={primaryStyle} onClick={() => setStep(step + 1)}>{step === STEPS.length - 1 ? "Review" : "Next"}<ArrowRight size={14} /></button>
            </div>
          </StepShell>
        );
      })()}

      {/* Review — every value taps to edit in place */}
      {atReview && !created && (
        <SheetCard icon={CheckCircle2} tile={TILE.teal} title="Review" sub="Tap any value to edit, then create the job." bodyClassName="px-4 py-3 max-[699px]:px-3">
          <SaleWonBanner cost={cost} sale={sale} profit={profit} profitPct={profitPct} />
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Job name", value: s.jobName, onCommit: v => set({ jobName: v }) },
              { label: "Job code", value: s.jobCode, mono: true, onCommit: v => { setJobCodeTouched(true); set({ jobCode: v }); } },
              { label: "Window PO", value: s.windowPO, mono: true, onCommit: v => set({ windowPO: v }) },
              { label: "Mfg order #", value: s.mfgOrder, mono: true, placeholder: "Not ordered", onCommit: v => set({ mfgOrder: v }) },
            ].map(f => (
              <div key={f.label} className="rounded-[10px] p-2.5" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
                <div className="text-[9.5px] font-semibold tracking-[.12em]" style={{ color: "#8a8f93" }}>{f.label.toUpperCase()}</div>
                <div className="mt-0.5"><InlineEditLight value={f.value} mono={f.mono} placeholder={f.placeholder} onCommit={f.onCommit} /></div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <ReviewBlock title="Builder" icon={Building2} fields={[
              { label: "Name", value: builderName },
              { label: "Contact", value: builderFields.contact, onCommit: v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, contact: v } }) : set({}) },
              { label: "Phone", value: builderFields.phone, onCommit: v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, phone: v } }) : set({}) },
              { label: "Email", value: builderFields.email, onCommit: v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, email: v } }) : set({}) },
              { label: "Billing", value: builderFields.billing, onCommit: v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, billing: v } }) : set({}) },
            ]} />
            <ReviewBlock title="Address" icon={MapPin} fields={[
              { label: "Street", value: s.address.street, onCommit: v => set({ address: { ...s.address, street: v } }) },
              { label: "City", value: s.address.city, onCommit: v => set({ address: { ...s.address, city: v } }) },
              { label: "Lot", value: s.address.lot, onCommit: v => set({ address: { ...s.address, lot: v } }) },
            ]} />
            <ReviewBlock title="Site contact" icon={User} fields={[
              { label: "Name", value: s.contact.name, onCommit: v => set({ contact: { ...s.contact, name: v } }) },
              { label: "Phone", value: s.contact.phone, onCommit: v => set({ contact: { ...s.contact, phone: v } }) },
              { label: "Email", value: s.contact.email, onCommit: v => set({ contact: { ...s.contact, email: v } }) },
            ]} />
            <ReviewBlock title="Dates" icon={Calendar} fields={[
              { label: "Order", value: s.leads.orderDate, type: "date", onCommit: v => set({ leads: { ...s.leads, orderDate: v } }) },
              { label: "Delivery", value: s.leads.delivery, type: "date", onCommit: v => set({ leads: { ...s.leads, delivery: v } }) },
              { label: "Install", value: s.leads.install, type: "date", onCommit: v => set({ leads: { ...s.leads, install: v } }) },
            ]} />
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
            <div className="rounded-[10px] p-3" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
              <div className="text-[10px] font-semibold tracking-[.12em]" style={{ color: "#8a8f93" }}>COST</div>
              <div className="mt-0.5"><InlineEditLight value={s.money.cost} type="number" onCommit={v => set({ money: { ...s.money, cost: v } })} /></div>
            </div>
            <div className="rounded-[10px] p-3" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
              <div className="text-[10px] font-semibold tracking-[.12em]" style={{ color: "#8a8f93" }}>SALE</div>
              <div className="mt-0.5"><InlineEditLight value={s.money.sale} type="number" onCommit={v => set({ money: { ...s.money, sale: v } })} /></div>
            </div>
            <MoneyStat label="Profit" value={`${money(profit)} · ${percent(profitPct)}`} tone="profit" />
          </div>

          <MonthAchievement thisJob={sale} />

          <div className="mt-3 rounded-[10px] px-3 py-2 text-[12px]" style={{ backgroundColor: "#faf0da", color: "#6f4e10", border: "1px solid #efdfb7" }}>
            Tax (7.45%): <strong>{money(tax)}</strong> · Customer total: <strong>{money(customerTotal)}</strong>
          </div>

          <div className="mt-3 rounded-[10px] px-3 py-2 text-[11.5px]" style={{ backgroundColor: "#f4f1ea", color: "#566063", border: "1px solid #e0dacf" }}>
            <strong style={{ color: "#34403f" }}>Setup info not saved with the job record:</strong> job code, manufacturer order #, site contact, and order/delivery/install dates are for your reference only. They are not stored on the Jobs record. Add them from the job page after creation (contacts via the Contacts directory, dates as notes or calendar events).
          </div>

          {formError && <p role="alert" className="mt-3 rounded-[10px] border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">{formError}</p>}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
            <button className={buttonClass} style={secondaryStyle} onClick={() => setStep(STEPS.length - 1)}><ArrowLeft size={14} />Back to money</button>
            <button className={buttonClass} style={primaryStyle} disabled={creating || !!created?.jobId} onClick={handleCreate}>
              {creating ? <><Loader2 size={14} className="animate-spin" />Creating…</> : <><Check size={14} />Create job</>}
            </button>
          </div>
          <div className="mt-2 text-[11px]" style={{ color: "#8a8f93" }}>Creates one job record. Cost and sale price are saved to a draft budget you can edit on the job.</div>
        </SheetCard>
      )}

      {/* Success state */}
      {created && (
        <SheetCard icon={CheckCircle2} tile={TILE.teal} title="Job created" bodyClassName="px-4 py-4">
          <div className="rounded-[10px] p-3" style={{ backgroundColor: "#eef5f3", border: "1px solid #c7e4d2" }}>
            <div className="text-[13px] font-bold" style={{ color: "#082f2c" }}>{s.jobName}</div>
            <div className="mt-0.5 text-[12px]" style={{ color: "#3e5a55" }}>{fullAddress || builderName}</div>
            {(cost > 0 || sale > 0) && budgetState === "saved" && <div className="mt-1 text-[12px]" style={{ color: "#3e5a55" }}>Draft budget saved · Cost {money(cost)} · Sale {money(sale)}</div>}
          </div>
          {(cost > 0 || sale > 0) && budgetState === "not_allowed" && (
            <div className="mt-2 rounded-[10px] px-3 py-2 text-[12px]" style={{ backgroundColor: "#faf0da", color: "#6f4e10", border: "1px solid #efdfb7" }}>
              The job was created, but cost/sale pricing was not saved — only the owner can save a draft budget. Open the job and have an owner add the budget there.
            </div>
          )}
          {(cost > 0 || sale > 0) && budgetState === "pending" && !creating && (
            <div className="mt-2 flex items-center gap-1.5 text-[12px]" style={{ color: "#566063" }}><Loader2 size={14} className="animate-spin" />Saving draft budget…</div>
          )}
          {(cost > 0 || sale > 0) && ["failed", "uncertain", "conflict"].includes(budgetState) && (
            <div className="mt-2 rounded-[10px] px-3 py-2 text-[12px]" style={{ backgroundColor: "#fcedec", color: "#a43432", border: "1px solid #f0c9c5" }}>
              {budgetState === "failed" && <div>The job was created, but the draft budget was not saved: {budgetError || "unknown error"}</div>}
              {budgetState === "uncertain" && <div>The job was created, but we could not confirm whether the draft budget saved{budgetError ? ` (${budgetError})` : ""}. Checking again reads current records first and only creates the budget if none exists.</div>}
              {budgetState === "conflict" && <div>The job was created. {budgetError} Review them on the budget page; nothing new was created.</div>}
              <div className="mt-1">Do not create the job again.</div>
              {budgetState !== "conflict" && (
                <button className={buttonClass + " mt-2"} style={secondaryStyle} onClick={retryBudget}>{budgetState === "uncertain" ? "Check again" : "Retry budget save"}</button>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/jobs/${created.jobId}`} className={buttonClass} style={primaryStyle}><Check size={14} />Open the new job</Link>
            <Link to={`/jobs/${created.jobId}/budget-orders`} className={buttonClass} style={secondaryStyle}>Edit budget & orders</Link>
            <Link to="/purchasing/new-job" onClick={() => { setCreated(null); setWizardId(newWizardId()); setForceCreate(false); setFormError(""); setBudgetState("pending"); setBudgetError(""); setS(prev => ({ ...prev, jobName: "", jobCode: "", windowPO: "", mfgOrder: "", address: { street: "", city: "", lot: "" }, contact: { name: "", phone: "", email: "" }, money: { cost: "", sale: "" } })); }} className={buttonClass} style={secondaryStyle}>Create another</Link>
          </div>
        </SheetCard>
      )}

      <JobMatchWarningDialog
        matches={matchWarning || { strong: [], medium: [] }}
        onOpenExisting={handleOpenExisting}
        onCreateAnyway={handleCreateAnyway}
        onCancel={() => setMatchWarning(null)}
      />
    </PageShell>
  );
}

function ReviewBlock({ title, icon: Icon, fields }) {
  return (
    <div className="rounded-[10px] p-3" style={{ backgroundColor: "#ffffff", border: "1px solid #e0dacf" }}>
      <div className="flex items-center gap-1.5">
        <Icon size={14} style={{ color: "#0b3f3b" }} />
        <h3 className="m-0 text-[12.5px] font-bold" style={{ color: "#082f2c" }}>{title}</h3>
      </div>
      <div className="mt-1.5 space-y-1">
        {fields.map(f => (
          <div key={f.label} className="flex items-start gap-2">
            <span className="w-16 shrink-0 pt-1 text-[10.5px] font-semibold" style={{ color: "#8a8f93" }}>{f.label}</span>
            <div className="min-w-0 flex-1"><InlineEditLight value={f.value} type={f.type} mono={f.mono} placeholder={f.placeholder} onCommit={f.onCommit || (() => {})} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}