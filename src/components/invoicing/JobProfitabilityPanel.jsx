import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, MailCheck } from "lucide-react";
import { calculateJobProfitability, moneyOrDash, percentOrDash } from "@/lib/jobProfitability";

const C = {
  ink: "#182422",
  muted: "#53615B",
  line: "#DDE0DA",
  soft: "#F5F6F3",
  good: "#166447",
  warn: "#8A5A10",
};

function Step({ done, icon: Icon, label }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium" style={{ border: `1px solid ${done ? "#C7DED4" : C.line}`, backgroundColor: done ? "#E8F3EE" : "#FFFFFF", color: done ? C.good : C.muted }}>
      <Icon size={13} />{label}
    </span>
  );
}

function Metric({ label, value, muted }) {
  return <div><div className="text-[11px]" style={{ color: C.muted }}>{label}</div><div className="font-mono-num-bold text-[13px]" style={{ color: muted ? C.muted : C.ink }}>{value}</div></div>;
}

export default function JobProfitabilityPanel({ rows, jobs, quotes, costInputs, reportStatusMap, supersededSet }) {
  const [expanded, setExpanded] = useState(false);
  const records = useMemo(() => calculateJobProfitability({ rows, jobs, quotes, costInputs, reportStatusMap, supersededSet }), [rows, jobs, quotes, costInputs, reportStatusMap, supersededSet]);
  const visible = expanded ? records : records.slice(0, 5);
  const provisionalCount = records.filter((r) => r.provisional).length;
  const unmatchedMaterial = records.filter((r) => !r.material_source && (r.input?.quote_request_id || r.input?.quote_number || r.job_id)).length;

  if (!records.length) return null;

  return (
    <section className="mt-5 overflow-hidden" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: C.ink }}><CircleDollarSign size={17} />Job profitability</div>
          <p className="mt-1 max-w-4xl text-[12px] leading-relaxed" style={{ color: C.muted }}>Completion and invoice readiness stay evidence-driven. Profitability is a separate estimate until cost inputs, roll assumptions and overhead are complete.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]" style={{ color: C.muted }}>
          <span>{records.length} jobs</span>
          <span>{provisionalCount} provisional</span>
          {unmatchedMaterial > 0 && <span style={{ color: C.warn }}>{unmatchedMaterial} material link review</span>}
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: C.line }}>
        {visible.map((job) => (
          <article key={job.key} className="px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)]">
              <div className="min-w-0">
                <div className="break-words text-[14px] font-semibold" style={{ color: C.ink }}>{job.name}</div>
                <div className="mt-1 text-[12px]" style={{ color: C.muted }}>{job.route_label}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Step done={job.completion_chain.evidence_received} icon={CheckCircle2} label="evidence received" />
                  <Step done={job.completion_chain.ready_to_invoice} icon={CheckCircle2} label="ready to invoice" />
                  <Step done={job.completion_chain.billing_email_sent} icon={MailCheck} label="billing sent" />
                </div>
                <div className="mt-3 text-[11px] leading-relaxed" style={{ color: job.provisional ? C.warn : C.muted }}>
                  {job.provisional ? <><AlertTriangle className="mr-1 inline" size={13} />Provisional: {job.missing_inputs.join(", ")}</> : "Cost inputs complete for this first-pass model."}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Customer revenue" value={moneyOrDash(job.customer_revenue)} />
                <Metric label="Product cost" value={moneyOrDash(job.product_cost)} muted={job.product_cost == null} />
                <Metric label="Product profit" value={moneyOrDash(job.product_profit)} muted={job.product_profit == null} />
                <Metric label="Product contribution" value={moneyOrDash(job.product_profit_contribution)} muted={job.product_profit_contribution == null} />
                <Metric label="Install revenue" value={moneyOrDash(job.installation_revenue)} />
                <Metric label="Install labor cost" value={`${moneyOrDash(job.installation_labor_cost)}${job.installation_labor_estimated ? " est." : ""}`} muted={job.installation_labor_cost == null} />
                <Metric label="Install material" value={moneyOrDash(job.installation_material_cost)} muted={job.installation_material_cost == null} />
                <Metric label="Install profit" value={moneyOrDash(job.installation_profit)} muted={job.installation_profit == null} />
                <Metric label="Gross profit" value={moneyOrDash(job.total_gross_profit)} muted={job.total_gross_profit == null} />
                <Metric label="Gross margin" value={percentOrDash(job.gross_margin)} muted={job.gross_margin == null} />
                <Metric label="Overhead" value={moneyOrDash(job.allocated_overhead)} muted={job.allocated_overhead == null} />
                <Metric label="EBIT contribution" value={moneyOrDash(job.ebit_contribution)} muted={job.ebit_contribution == null} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: C.muted }}>
              <span>Material source: {job.material_source?.source_label || "missing or unmatched"}</span>
              {job.planned_material_cost != null && <span>Roll plan: {job.material_roll_use.toFixed(2)} roll{job.material_roll_use === 1 ? "" : "s"} · {job.material_roll_mode === "whole_roll" ? "whole-roll purchase" : "fractional use"}</span>}
              {job.installation_labor_estimated && <span>Labor fallback: worker days × $200</span>}
            </div>
          </article>
        ))}
      </div>
      {records.length > 5 && <button type="button" onClick={() => setExpanded((v) => !v)} className="min-h-11 w-full text-[13px] font-medium" style={{ border: 0, borderTop: `1px solid ${C.line}`, backgroundColor: C.soft, color: C.good }}>{expanded ? "Show fewer jobs" : `Show all ${records.length} jobs`}</button>}
    </section>
  );
}
