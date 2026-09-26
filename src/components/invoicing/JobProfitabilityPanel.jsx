import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, CircleDollarSign } from "lucide-react";
import { aggregateProfitSplitSummaries, calculateJobProfitability, moneyOrDash, percentOrDash } from "@/lib/jobProfitability";

const C = { ink: "#182422", muted: "#53615B", line: "#DDE0DA", soft: "#F5F6F3", good: "#166447", warn: "#8A5A10" };

function StatusDot({ done, label }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]" style={{ color: done ? C.good : C.muted }}><span style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: done ? C.good : "#BDC5BF" }} />{label}</span>;
}

function MoneyCell({ label, value, estimated }) {
  return <div className="min-w-[96px]"><div className="text-[10px] uppercase" style={{ color: C.muted }}>{label}</div><div className="font-mono-num-bold text-[13px]" style={{ color: value == null ? C.muted : C.ink }}>{moneyOrDash(value)}{estimated ? " est." : ""}</div></div>;
}

function DetailPair({ label, children }) {
  return <div><dt className="text-[11px]" style={{ color: C.muted }}>{label}</dt><dd className="mt-0.5 text-[12px]" style={{ color: C.ink }}>{children}</dd></div>;
}

function costStatus(job) {
  if (!job.provisional) return { label: "costs complete", color: C.good };
  const count = job.missing_inputs.length;
  return { label: `${count} cost input${count === 1 ? "" : "s"} missing`, color: C.warn };
}

function SplitTotalsStrip({ records }) {
  const totals = aggregateProfitSplitSummaries(records);
  if (!totals.count) return null;
  const items = [
    ["customer sell", totals.customer_sell],
    ["Y.A. cost basis", totals.ya_cost_basis],
    ["product profit", totals.product_profit],
    ["Y.A. share", totals.ya_share],
    ["Glass Forge share", totals.glass_forge_share],
    ["invoice amt", totals.invoice_amount],
  ];
  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-3 xl:grid-cols-6" style={{ borderBottom: `1px solid ${C.line}`, backgroundColor: "#FBFCFA" }}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <div className="truncate text-[10px] uppercase" style={{ color: C.muted }}>{label}</div>
          <div className="font-mono-num-bold text-[13px]" style={{ color: label === "Glass Forge share" ? C.good : C.ink }}>{moneyOrDash(value)}</div>
        </div>
      ))}
      <div className="sm:col-span-3 xl:col-span-6 text-[11px]" style={{ color: totals.missing_inputs.length ? C.warn : C.muted }}>
        {totals.count} profit-split job{totals.count === 1 ? "" : "s"} in the current filter · product profit split only{totals.missing_inputs.length ? ` · missing ${totals.missing_inputs.join(", ")}` : ""}
      </div>
    </div>
  );
}

function SourceLines({ job }) {
  if (job.lines.length <= 1 && !(job.profit_split?.lines?.length)) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-md" style={{ border: `1px solid ${C.line}` }}>
      <table className="min-w-[760px] w-full border-collapse text-[11px]">
        <thead style={{ backgroundColor: "#FBFCFA", color: C.muted }}>
          <tr className="text-left uppercase">
            <th className="px-3 py-2 font-medium">Source line</th>
            <th className="px-3 py-2 text-right font-medium">Sell</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            <th className="px-3 py-2 text-right font-medium">Product profit</th>
            <th className="px-3 py-2 text-right font-medium">Y.A. share</th>
            <th className="px-3 py-2 text-right font-medium">GF share</th>
            <th className="px-3 py-2 text-right font-medium">Invoice</th>
          </tr>
        </thead>
        <tbody>
          {(job.profit_split?.lines || []).map((line) => (
            <tr key={line.id} style={{ borderTop: `1px solid ${C.line}` }}>
              <td className="px-3 py-2"><span className="block font-medium" style={{ color: C.ink }}>{line.job_name}</span><span style={{ color: C.muted }}>{line.source_label}{line.calendar_event_id ? ` · ${line.calendar_event_id}` : ""}</span></td>
              <td className="px-3 py-2 text-right font-mono-num">{moneyOrDash(line.customer_sell)}</td>
              <td className="px-3 py-2 text-right font-mono-num">{moneyOrDash(line.ya_cost_basis)}</td>
              <td className="px-3 py-2 text-right font-mono-num">{moneyOrDash(line.product_profit)}</td>
              <td className="px-3 py-2 text-right font-mono-num">{moneyOrDash(line.ya_share)}</td>
              <td className="px-3 py-2 text-right font-mono-num-bold" style={{ color: C.good }}>{moneyOrDash(line.glass_forge_share)}</td>
              <td className="px-3 py-2 text-right font-mono-num">{moneyOrDash(line.invoice_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function JobProfitabilityPanel({ rows, jobs, quotes, costInputs, reportStatusMap, supersededSet }) {
  const [expandedList, setExpandedList] = useState(false);
  const [open, setOpen] = useState(new Set());
  const records = useMemo(() => calculateJobProfitability({ rows, jobs, quotes, costInputs, reportStatusMap, supersededSet }), [rows, jobs, quotes, costInputs, reportStatusMap, supersededSet]);
  const visible = expandedList ? records : records.slice(0, 8);
  const provisionalCount = records.filter((r) => r.provisional).length;
  if (!records.length) return null;

  const toggle = (key) => setOpen((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  return (
    <section className="mt-5 overflow-hidden" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: C.ink }}><CircleDollarSign size={17} />Job profitability</div>
          <p className="mt-1 max-w-4xl text-[12px] leading-relaxed" style={{ color: C.muted }}>Invoice readiness follows completion evidence and FeeLine billing. Profitability uses separate product, labor, material and overhead inputs.</p>
        </div>
        <div className="text-[11px]" style={{ color: C.muted }}>{records.length} jobs · {provisionalCount} with cost gaps</div>
      </div>

      <SplitTotalsStrip records={records} />

      <div className="divide-y" style={{ borderColor: C.line }}>
        {visible.map((job) => {
          const isOpen = open.has(job.key);
          const status = costStatus(job);
          return (
            <article key={job.key}>
              <button type="button" onClick={() => toggle(job.key)} className="grid w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left sm:grid-cols-[22px_minmax(0,1.5fr)_minmax(0,2fr)]" style={{ border: 0, backgroundColor: "transparent", cursor: "pointer" }}>
                <span style={{ color: C.muted }}>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold" style={{ color: C.ink }}>{job.name}</span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: C.muted }}>
                    <span>{job.route_label}</span>
                    <StatusDot done={job.completion_chain.evidence_received} label="evidence" />
                    <StatusDot done={job.completion_chain.ready_to_invoice} label="ready" />
                    <StatusDot done={job.completion_chain.billing_email_sent} label="billing sent" />
                  </span>
                </span>
                <span className="col-start-2 grid min-w-0 grid-cols-2 gap-3 sm:col-start-auto sm:grid-cols-4">
                  <MoneyCell label="total job profit" value={job.total_job_profit} />
                  <MoneyCell label="Y.A. profit" value={job.ya_windows_profit} />
                  <MoneyCell label="Glass Forge profit" value={job.glass_forge_profit} />
                  <span className="min-w-0"><span className="block text-[10px] uppercase" style={{ color: C.muted }}>status</span><span className="block truncate text-[12px] font-medium" style={{ color: status.color }}>{status.label}</span></span>
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 sm:pl-12">
                  <div className="grid gap-4 rounded-md p-3 sm:grid-cols-2 lg:grid-cols-4" style={{ backgroundColor: C.soft, border: `1px solid ${C.line}` }}>
                    <DetailPair label="Customer sell price">{moneyOrDash(job.customer_revenue)}</DetailPair>
                    <DetailPair label="Y.A. cost basis">{moneyOrDash(job.product_cost)}</DetailPair>
                    <DetailPair label="Total product profit">{moneyOrDash(job.product_profit)}</DetailPair>
                    <DetailPair label="Split percentage">{percentOrDash(job.product_split_pct)}</DetailPair>
                    <DetailPair label="Glass Forge product share">{moneyOrDash(job.glass_forge_profit_share)}</DetailPair>
                    <DetailPair label="Y.A. product share">{moneyOrDash(job.ya_profit_share)}</DetailPair>
                    <DetailPair label="Invoice amount/status">{moneyOrDash(job.invoice_fee_total)} · {job.completion_chain.billed_or_paid ? "billed/paid" : job.completion_chain.ready_to_invoice ? "ready" : "not ready"}</DetailPair>
                    <DetailPair label="Install revenue">{moneyOrDash(job.installation_revenue)}</DetailPair>
                    <DetailPair label="Install labor cost">{moneyOrDash(job.installation_labor_cost)}{job.installation_labor_estimated ? " estimated" : ""}</DetailPair>
                    <DetailPair label="Install material cost">{moneyOrDash(job.installation_material_cost)}</DetailPair>
                    <DetailPair label="Install profit">{moneyOrDash(job.installation_profit)}</DetailPair>
                    <DetailPair label="Allocated overhead">{moneyOrDash(job.allocated_overhead)}</DetailPair>
                    <DetailPair label="EBIT contribution">{moneyOrDash(job.ebit_contribution)}</DetailPair>
                  </div>
                  <SourceLines job={job} />
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px]" style={{ color: C.muted }}>
                    <span>Material source: {job.material_source?.source_label || "not linked"}</span>
                    {job.planned_material_cost != null && <span>Roll plan: {job.material_roll_use.toFixed(2)} roll{job.material_roll_use === 1 ? "" : "s"} · {job.material_roll_mode === "whole_roll" ? "whole-roll purchase" : "fractional use"}</span>}
                    {job.missing_inputs.length > 0 && <span style={{ color: C.warn }}><AlertTriangle className="mr-1 inline" size={13} />Missing: {job.missing_inputs.join(", ")}</span>}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {records.length > 8 && <button type="button" onClick={() => setExpandedList((v) => !v)} className="min-h-11 w-full text-[13px] font-medium" style={{ border: 0, borderTop: `1px solid ${C.line}`, backgroundColor: C.soft, color: C.good }}>{expandedList ? "Show fewer jobs" : `Show all ${records.length} jobs`}</button>}
    </section>
  );
}
