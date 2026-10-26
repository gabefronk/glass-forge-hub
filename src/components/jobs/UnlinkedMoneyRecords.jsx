import { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { computeLaborAmt, formatMoney } from "@/lib/feeMath";
import JobPicker from "@/components/invoicing/JobPicker";
import { unlinkedMoneyGroups } from "@/lib/unlinkedMoney";

const money = (n) => `$${formatMoney(Number(n) || 0)}`;
const jobName = (j) => j?.canonical_name || j?.name || j?.id || "";

// Money records must belong to a job so budgets, purchasing and invoices roll up together.
// Lists billing lines, POs and budgets with no job, and POs with no budget. Links are manual
// picks only; records that already have a link are never changed here. Shop purchases have
// no job on purpose and are left out. refreshSignal reloads after a bulk link.
export default function UnlinkedMoneyRecords({ refreshSignal = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [lines, pos, budgets, jobs] = await Promise.all([
        base44.entities.FeeLines.list("-job_date", 5000),
        base44.entities.PurchaseOrders.list("-created_date", 1000),
        base44.entities.JobBudgets.list("-created_date", 1000),
        base44.entities.Jobs.list("canonical_name", 5000),
      ]);
      setData({ lines, pos, budgets, jobs });
    } catch (e) { setError(`Records could not be loaded. ${e?.message || ""}`.trim()); }
  }, []);
  useEffect(() => { load(); }, [load, refreshSignal]);

  const groups = useMemo(() => (data ? unlinkedMoneyGroups(data) : null), [data]);

  const link = async (entity, id, patch, list, label) => {
    setBusy(true); setError("");
    // A billing line picked by the owner is a confident match: the job hold clears, a pricing
    // or service review keeps it held (same rule as ingest).
    if (entity === "FeeLines") {
      const row = data.lines.find((r) => r.id === id) || {};
      patch = { ...patch, match_confidence: "high", needs_review: !!row.needs_review && (!!row.pricing_review_reason || row.service_review_status === "review") };
    }
    try {
      await base44.entities[entity].update(id, patch);
      setData((d) => ({ ...d, [list]: d[list].map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      setPicking(null);
    } catch (e) { setError(`${label} was not linked. ${e?.message || ""}`.trim()); }
    setBusy(false);
  };

  if (error && !data) return <p role="alert" className="text-sm" style={{ color: "#A43432" }}>{error}</p>;
  if (!groups) return <p className="text-sm" style={{ color: C.textMuted }}>Loading money records…</p>;

  const card = (key, title, sub, extra, onPick, current) => (
    <article key={key} className="rounded-lg p-3" style={{ border: `1px solid ${C.rowBorder}` }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium break-words" style={{ color: C.text }}>{title}</div>
          <div className="mt-0.5 text-[13px]" style={{ color: C.textMuted }}>{sub}</div>
        </div>
        {picking !== key && extra}
      </div>
      {picking === key && <div className="mt-2">{current}</div>}
      {picking !== key && onPick && <button type="button" disabled={busy} onClick={() => setPicking(key)} className="mt-2 min-h-9 rounded-lg border px-3 text-[13px] font-semibold" style={{ color: C.accentText }}>Link to job</button>}
    </article>
  );

  const section = (title, sub, items) => (
    <section className="rounded-[14px] bg-white p-5 card-shadow" style={{ border: `1px solid ${C.border}` }}>
      <h2 className="text-[16px] font-bold" style={{ color: C.text }}>{title} ({items.length})</h2>
      <p className="mt-1 text-[13px]" style={{ color: C.textMuted }}>{sub}</p>
      <div className="mt-4 max-h-[560px] space-y-3 overflow-y-auto">{items.length ? items : <p className="text-sm" style={{ color: C.textMuted }}>Nothing to link.</p>}</div>
    </section>
  );

  const picker = (entity, row, list, label) => (
    <JobPicker jobs={data.jobs} currentJobId={row.job_id || null} onCancel={() => setPicking(null)}
      onConfirm={(job) => link(entity, row.id, entity === "FeeLines" ? { job_id: job.id, job_name_norm: jobName(job) } : { job_id: job.id, job_name: jobName(job) }, list, label)} />
  );

  return (
    <div className="flex flex-col gap-5">
      {error && <p role="alert" className="rounded-[14px] bg-white p-3 text-sm" style={{ border: `1px solid ${C.border}`, color: "#A43432" }}>{error}</p>}
      <div className="grid gap-5 xl:grid-cols-2">
        {section("Billing lines with no job", "Unbilled billable lines from the calendar and ProBuild. Linked lines count toward the job's money.",
          groups.lines.map((r) => card(`fl:${r.id}`, r.job_name_raw || r.line_description || "(untitled)", `${r.job_date || ""} · ${money(computeLaborAmt(r))} labor${r.po_number ? ` · PO ${r.po_number}` : ""}`, null, true, picker("FeeLines", r, "lines", "Billing line"))))}
        {section("POs with no job", "Purchase orders not tied to any job.",
          groups.posNoJob.map((p) => card(`po:${p.id}`, `PO ${p.po_number || p.id}${p.vendor ? ` · ${p.vendor}` : ""}`, `${p.job_name || p.customer_name || "No job name"} · dealer ${money(p.amount_dealer)} · ${p.status || "no status"}`, null, true, picker("PurchaseOrders", p, "pos", "PO"))))}
        {section("POs with no budget", "The PO's job is known, but the PO is not tied to one of that job's budgets.",
          groups.posNoBudget.map((p) => {
            const options = data.budgets.filter((b) => b.job_id === p.job_id && !b.deleted_at);
            return card(`pb:${p.id}`, `PO ${p.po_number || p.id}${p.vendor ? ` · ${p.vendor}` : ""}`, `${jobName(data.jobs.find((j) => j.id === p.job_id)) || p.job_name || ""} · dealer ${money(p.amount_dealer)}`,
              options.length ? (
                <select aria-label="Budget for this PO" disabled={busy} defaultValue="" onChange={(e) => e.target.value && link("PurchaseOrders", p.id, { budget_id: e.target.value }, "pos", "PO")} className="min-h-9 max-w-[16rem] rounded-lg border border-slate-300 bg-white px-2 text-[13px]">
                  <option value="">Choose budget…</option>
                  {options.map((b) => <option key={b.id} value={b.id}>{b.title || b.quote_name || b.quote_number || b.id}</option>)}
                </select>
              ) : <span className="text-[13px]" style={{ color: C.textMuted }}>This job has no budget yet</span>, false, null);
          }))}
        {section("Budgets with no job", "Quotes/budgets not tied to a job.",
          groups.budgets.map((b) => card(`b:${b.id}`, b.title || b.quote_name || b.id, `${b.vendor || b.manufacturer || ""}${b.quote_number ? ` · Quote ${b.quote_number}` : ""}`, null, true, picker("JobBudgets", b, "budgets", "Budget"))))}
      </div>
    </div>
  );
}
