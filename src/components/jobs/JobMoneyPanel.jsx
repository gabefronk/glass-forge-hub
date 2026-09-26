import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Landmark } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { C } from "@/lib/feeUI";
import { aggregateJobMoney, canLoadJobMoney } from "@/lib/jobMoneyPanel";

const money = (value) => value === null || value === undefined
  ? "—"
  : Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
const date = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US") : "No date";

function Metric({ label, value, note }) {
  return <div className="rounded-lg p-3" style={{ background: C.cardAlt, border: `1px solid ${C.rowBorder}` }}>
    <div className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: C.textMuted }}>{label}</div>
    <div className="mt-1 text-[17px] font-semibold" style={{ color: C.text }}>{money(value)}</div>
    <div className="mt-0.5 text-[10px] leading-snug" style={{ color: C.textFaint }}>{note}</div>
  </div>;
}

function RecordLink({ to, children }) {
  return <Link to={to} className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: C.accentText }}>
    {children}<ExternalLink className="h-3 w-3" />
  </Link>;
}

export default function JobMoneyPanel({ jobId, memberIds }) {
  const { user } = useAuth();
  const owner = canLoadJobMoney(user);
  const memberKey = (memberIds || []).filter(Boolean).sort().join(",");
  const [state, setState] = useState({ loading: owner, error: "", data: null });

  useEffect(() => {
    let active = true;
    if (!owner) {
      setState({ loading: false, error: "", data: null });
      return () => { active = false; };
    }
    setState({ loading: true, error: "", data: null });
    // Include duplicate records of this job so money filed under any of them shows here.
    const ids = [...new Set([jobId, ...(String(memberKey || "").split(",").filter(Boolean))])];
    const byJob = ids.length > 1 ? { job_id: { $in: ids } } : { job_id: jobId };
    Promise.all([
      base44.entities.JobBudgets.filter(byJob, "-created_date", 200),
      base44.entities.PurchaseOrders.filter(byJob, "-created_date", 500),
      base44.entities.FeeLines.filter(byJob, "-job_date", 5000),
    ]).then(([budgets, purchaseOrders, feeLines]) => {
      if (active) setState({ loading: false, error: "", data: aggregateJobMoney(ids, { budgets, purchaseOrders, feeLines }) });
    }).catch(() => {
      if (active) setState({ loading: false, error: "Financial records could not be loaded.", data: null });
    });
    return () => { active = false; };
  }, [jobId, owner, memberKey]);

  // Intentionally render nothing for non-owners: no request, amount, placeholder,
  // or hint that private pricing exists reaches a crew login.
  if (!owner) return null;

  const data = state.data;
  return <section aria-label="Owner money panel" className="mt-5 overflow-hidden rounded-[14px] card-shadow" style={{ background: C.card, border: `1px solid ${C.border}` }}>
    <div className="px-4 py-3" style={{ background: C.headerBg, borderBottom: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2"><Landmark className="h-4 w-4" style={{ color: C.accentText }} /><h2 className="font-heading text-[16px] font-bold" style={{ color: C.text }}>Money · owner only</h2></div>
      <p className="mt-1 text-[11px]" style={{ color: C.textMuted }}>Read-only source records. Estimates, billing, and confirmed payments stay separate.</p>
    </div>
    <div className="space-y-4 p-4">
      {state.loading && <p className="text-[12px]" style={{ color: C.textMuted }}>Loading private financial records…</p>}
      {state.error && <p role="alert" className="text-[12px]" style={{ color: "#A43432" }}>{state.error}</p>}
      {data && <>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Budget cost estimate" value={data.totals.budgetCost} note="JobBudgets workbook math" />
          <Metric label="Budget customer sell" value={data.totals.budgetSell} note="Estimate / entered sell, not cash" />
          <Metric label="PO dealer amount" value={data.totals.poDealer} note="Ordered amount; not proof of payment" />
          <Metric label="PO customer amount" value={data.totals.poCustomer} note="PO amount; not an invoice receipt" />
          <Metric label="Fees recorded" value={data.totals.feeRecorded} note="FeeLines using invoicing math" />
          <Metric label="Fees confirmed paid" value={data.totals.feePaid} note="Only FeeLines marked paid to YA" />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[12px] font-bold" style={{ color: C.text }}>Budget / estimate sources</h3><RecordLink to="/job-budgets">All budgets</RecordLink></div>
          {data.budgets.length ? data.budgets.map((row) => <div key={row.id} className="mb-2 rounded-lg p-2.5 text-[11px]" style={{ border: `1px solid ${C.rowBorder}` }}>
            <div className="font-semibold" style={{ color: C.text }}>{row.title || row.id}</div>
            <div style={{ color: C.textMuted }}>Cost estimate {money(row.displayComputed.total_cost_overhead)} · customer sell {money(row.displayComputed.actual_total_sell)} · {row.status || "no status"}</div>
            {row.source_pdf_url && <a href={row.source_pdf_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-semibold" style={{ color: C.accentText }}>Source quote PDF<ExternalLink className="h-3 w-3" /></a>}
          </div>) : <p className="text-[11px]" style={{ color: C.textMuted }}>No linked JobBudgets records.</p>}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[12px] font-bold" style={{ color: C.text }}>Purchase order sources</h3><RecordLink to="/purchase-orders">All POs</RecordLink></div>
          {data.purchaseOrders.length ? data.purchaseOrders.map((row) => <div key={row.id} className="mb-2 rounded-lg p-2.5 text-[11px]" style={{ border: `1px solid ${C.rowBorder}` }}>
            <div className="font-semibold" style={{ color: C.text }}>{row.po_number || row.id} · {row.vendor || "Vendor not recorded"}</div>
            <div style={{ color: C.textMuted }}>Dealer {money(row.amount_dealer)} · customer {money(row.amount_customer)} · status {row.status || "not recorded"}</div>
            <div className="mt-1 font-medium" style={{ color: C.amber }}>PO status does not indicate payment.</div>
          </div>) : <p className="text-[11px]" style={{ color: C.textMuted }}>No linked PurchaseOrders records.</p>}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[12px] font-bold" style={{ color: C.text }}>Invoicing sources</h3><RecordLink to="/">Open invoicing</RecordLink></div>
          <p className="mb-2 text-[11px]" style={{ color: C.textMuted }}>Billed {money(data.totals.feeBilled)} · confirmed paid {money(data.totals.feePaid)}. Payment is shown only from “paid to YA.”</p>
          {data.feeLines.length ? data.feeLines.map((row) => <div key={row.id} className="mb-2 rounded-lg p-2.5 text-[11px]" style={{ border: `1px solid ${C.rowBorder}` }}>
            <div className="font-semibold" style={{ color: C.text }}>{row.line_description || "Fee line"} · {money(row.fee_amt)}</div>
            <div style={{ color: C.textMuted }}>{date(row.job_date)} · {row.billed_to_bfs ? "billed to BFS" : "not billed to BFS"} · {row.paid_to_ya ? `paid to YA${row.paid_date ? ` ${date(row.paid_date)}` : ""}` : "payment not recorded"}</div>
          </div>) : <p className="text-[11px]" style={{ color: C.textMuted }}>No linked FeeLines records.</p>}
        </div>
      </>}
    </div>
  </section>;
}
