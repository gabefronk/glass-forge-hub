import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DollarSign, FileUp, Pencil, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { C } from "@/lib/feeUI";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import { moneyOrDash, percentOrDash } from "@/lib/jobProfitability";
import { laborMargin, validateLaborEntry } from "../../../base44/shared/jobLaborEntry.js";

// Two ways to put money on a job, both for managers and up (crews never see this card):
//   1. Quick labor — what you charged the builder for the install and what the crew cost.
//      Two numbers, saved to the job's cost inputs; the margin shows right away and the
//      Invoicing profitability panel + Job Setup sheet pick it up.
//   2. Upload a vendor quote PDF — the full Job Budgets path (cost basis, sell targets,
//      Drive filing), already linked to this job so nothing needs matching.
const canUse = (user) => user?.role === "admin" || user?.role === "manager";
const call = async (body) => {
  const r = await base44.functions.invoke("jobBudgetIngest", body);
  const data = r?.data;
  if (data && typeof data === "object" && data.error) { const e = new Error(data.error); e.fields = data.fields; throw e; }
  return data || {};
};
const btn = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50";
const btnNeutral = { backgroundColor: "#FFFFFF", color: "var(--gf-ink)", border: "1px solid var(--gf-border)" };
const btnPrimary = { backgroundColor: "var(--gf-teal-600)", color: "#f2eee8", border: "1px solid var(--gf-teal-700)" };
const field = { border: `1px solid ${C.border}`, color: C.text };
const cell = "min-w-0 border-r px-4 py-3 last:border-r-0 max-[1100px]:[&:nth-child(2n)]:border-r-0";
const label = "text-[10.5px] font-bold uppercase tracking-[.12em]";
const monthLabel = (m) => (m && /^\d{4}-\d{2}$/.test(m) ? new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "");

export default function JobCostCard({ jobId }) {
  const { user } = useAuth();
  const allowed = canUse(user);
  const [state, setState] = useState({ loading: true, labor: null, budget: null, error: "" });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ installation_revenue: "", actual_labor_cost: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!allowed || !jobId) return;
    const mine = ++seq.current;
    try {
      const r = await call({ action: "job_costs", job_id: jobId });
      if (mine === seq.current) setState({ loading: false, labor: r.labor || null, budget: r.budget || null, error: "" });
    } catch (e) { if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: e.message || "Costs could not load." })); }
  }, [jobId, allowed]);
  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  if (!allowed) return null;
  const { labor, budget } = state;

  const openEdit = () => {
    setForm({ installation_revenue: labor?.installation_revenue ?? "", actual_labor_cost: labor?.actual_labor_cost ?? "", notes: labor?.notes || "" });
    setNotice(""); setEditing(true);
  };
  const preview = laborMargin(form.installation_revenue === "" ? null : form.installation_revenue, form.actual_labor_cost === "" ? null : form.actual_labor_cost);
  const check = validateLaborEntry(form);

  const save = async (e) => {
    e.preventDefault();
    if (!check.ok) return;
    setSaving(true); setNotice("");
    try {
      const r = await call({ action: "set_labor", job_id: jobId, installation_revenue: form.installation_revenue, actual_labor_cost: form.actual_labor_cost, notes: form.notes });
      setState((s) => ({ ...s, labor: r.labor || s.labor, error: "" }));
      setEditing(false);
      setNotice(r.profit != null ? `Saved. Labor margin ${moneyOrDash(r.profit)} (${percentOrDash(r.margin_pct)}).` : "Saved.");
    } catch (err) { setState((s) => ({ ...s, error: err.message || "Could not save." })); }
    finally { setSaving(false); }
  };

  const upload = async (files) => {
    const file = [...(files || [])].find((f) => /\.pdf$/i.test(f.name));
    if (!file) { setState((s) => ({ ...s, error: "Choose a PDF." })); return; }
    setUploading(file.name); setNotice(""); setState((s) => ({ ...s, error: "" }));
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const r = await call({ action: "process", file_url, file_name: file.name, job_id: jobId });
      if (r.status === "filed") setNotice(`Budget built from ${file.name} and filed to Drive.`);
      else setNotice(`${file.name} needs a look: ${r.reason || r.match_reason || "the quote could not be read fully"}. It is on the Job Budgets page.`);
      await load();
    } catch (err) { setState((s) => ({ ...s, error: err.message || "Upload failed." })); }
    finally { setUploading(""); }
  };

  const right = (
    <>
      <button type="button" className={btn} style={btnNeutral} disabled={!!uploading} onClick={() => fileInput.current?.click()} title="Upload a vendor quote PDF: cost basis, sell targets and Drive filing, already linked to this job">
        <FileUp className="h-3.5 w-3.5" />{uploading ? "Reading…" : "Quote PDF"}
      </button>
      <input ref={fileInput} type="file" accept="application/pdf" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      {!editing ? <button type="button" className={btn} style={btnPrimary} onClick={openEdit}><Pencil className="h-3.5 w-3.5" />{labor ? "Edit labor" : "Quick labor"}</button> : null}
    </>
  );

  return (
    <SheetCard icon={DollarSign} tile={TILE.green} title="Cost & sell" sub={labor?.month ? `labor · ${monthLabel(labor.month)}` : "install price vs. crew cost"} right={right} bodyClassName="overflow-hidden rounded-b-[14px]">
      {state.error ? <p role="alert" className="m-0 px-4 py-2 text-[12.5px]" style={{ backgroundColor: "var(--gf-error-bg)", color: "var(--gf-error)" }}>{state.error}</p> : null}
      {notice ? <p role="status" className="m-0 px-4 py-2 text-[12.5px]" style={{ backgroundColor: "var(--gf-teal-050)", color: C.accentText }}>{notice}</p> : null}
      {editing ? (
        <form onSubmit={save} className="px-4 py-4" aria-label="Quick labor entry">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: C.textSecondary }}>Charged the builder for install
              <input inputMode="decimal" value={form.installation_revenue} onChange={(e) => setForm((f) => ({ ...f, installation_revenue: e.target.value }))} placeholder="e.g. 1850" className="min-h-11 rounded-[9px] bg-white px-3 text-[14px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]" style={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: C.textSecondary }}>What the crew cost you
              <input inputMode="decimal" value={form.actual_labor_cost} onChange={(e) => setForm((f) => ({ ...f, actual_labor_cost: e.target.value }))} placeholder="e.g. 900" className="min-h-11 rounded-[9px] bg-white px-3 text-[14px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]" style={field} />
            </label>
          </div>
          <label className="mt-3 flex flex-col gap-1 text-[12px] font-semibold" style={{ color: C.textSecondary }}>Note (optional)
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="2 guys, 1 day" maxLength={500} className="min-h-11 rounded-[9px] bg-white px-3 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]" style={field} />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" className={btn} style={btnPrimary} disabled={saving || !check.ok}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className={btn} style={btnNeutral} onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" />Cancel</button>
            <span className="text-[12.5px]" style={{ color: C.textMuted }}>{preview.profit != null ? `Margin ${moneyOrDash(preview.profit)} · ${percentOrDash(preview.margin_pct)}` : "Enter at least one number"}</span>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-4 max-[1100px]:grid-cols-2" style={{ borderColor: C.rowBorder }}>
          <div className={cell} style={{ borderColor: C.rowBorder }}>
            <div className={label} style={{ color: C.textMuted }}>Install charged</div>
            <div className="mt-1 text-[16px] font-bold tabular-nums" style={{ color: C.text }}>{state.loading ? "…" : moneyOrDash(labor?.installation_revenue ?? null)}</div>
          </div>
          <div className={cell} style={{ borderColor: C.rowBorder }}>
            <div className={label} style={{ color: C.textMuted }}>Crew cost</div>
            <div className="mt-1 text-[16px] font-bold tabular-nums" style={{ color: C.text }}>{state.loading ? "…" : moneyOrDash(labor?.actual_labor_cost ?? null)}</div>
          </div>
          <div className={cell} style={{ borderColor: C.rowBorder }}>
            <div className={label} style={{ color: C.textMuted }}>Labor margin</div>
            <div className="mt-1 text-[16px] font-bold tabular-nums" style={{ color: labor?.profit != null && labor.profit < 0 ? "var(--gf-error)" : C.accentText }}>{state.loading ? "…" : labor?.profit != null ? `${moneyOrDash(labor.profit)} · ${percentOrDash(labor.margin_pct)}` : "—"}</div>
            {labor?.notes ? <div className="mt-0.5 truncate text-[11.5px]" style={{ color: C.textMuted }} title={labor.notes}>{labor.notes}</div> : null}
          </div>
          <div className={cell} style={{ borderColor: C.rowBorder }}>
            <div className={label} style={{ color: C.textMuted }}>Material (quote)</div>
            {state.loading ? <div className="mt-1 text-[16px] font-bold">…</div> : budget ? (
              <>
                <div className="mt-1 text-[16px] font-bold tabular-nums" style={{ color: C.text }}>{moneyOrDash(budget.material_cost)} <span className="text-[12px] font-medium" style={{ color: C.textMuted }}>→ {moneyOrDash(budget.material_sell)}</span></div>
                <div className="mt-0.5 truncate text-[11.5px]" style={{ color: C.textMuted }}>{[budget.vendor, budget.quote_number].filter(Boolean).join(" · ") || budget.file_name}{budget.status === "needs_review" ? " · needs review" : ""} · <Link to="/job-budgets" className="hover:underline" style={{ color: C.accentText }}>Job Budgets</Link></div>
              </>
            ) : <div className="mt-1 text-[12.5px]" style={{ color: C.textMuted }}>No quote yet — drop one with “Quote PDF”.</div>}
          </div>
        </div>
      )}
    </SheetCard>
  );
}
