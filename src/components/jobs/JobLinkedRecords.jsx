import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Link2, PanelsTopLeft, Truck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { C } from "@/lib/feeUI";

// Owner-only: window quotes and vendor orders filed against this job (or any of its
// duplicate records), so the job page is the one place to reach every linked record.
const QUOTE_STATUS = { draft: "Draft", queued: "Queued", running: "Pricing", needs_details: "Needs details", needs_sign_in: "Needs sign-in", failed: "Failed", ready: "Priced" };
const ORDER_STATUS = { ordered: "Ordered", eta_set: "ETA set", ach_link_received: "ACH link in", paid: "Paid", reconciled: "Reconciled" };
const money = (v) => (v === null || v === undefined || v === "") ? "" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" });

function Chip({ children, tone = "neutral" }) {
  const t = tone === "good" ? C.tagBillable : tone === "warn" ? C.tagReview : C.tagNoCharge;
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap" style={{ background: t.bg, color: t.text, border: `1px solid ${t.border}` }}>{children}</span>;
}

export default function JobLinkedRecords({ jobId, memberIds, sourceQuoteId }) {
  const { user } = useAuth();
  const owner = isAgentCenterOwner(user);
  const memberKey = (memberIds || []).filter(Boolean).sort().join(",");
  const [state, setState] = useState({ loading: owner, error: "", quotes: [], orders: [] });

  useEffect(() => {
    let active = true;
    if (!owner) return () => { active = false; };
    const ids = [...new Set([jobId, ...memberKey.split(",").filter(Boolean)])];
    const byJob = ids.length > 1 ? { job_id: { $in: ids } } : { job_id: jobId };
    setState((s) => ({ ...s, loading: true, error: "" }));
    Promise.all([
      base44.entities.QuoteRequests.filter(byJob, "-updated_date", 25),
      sourceQuoteId ? base44.entities.QuoteRequests.filter({ id: sourceQuoteId }, "-updated_date", 1).catch(() => []) : Promise.resolve([]),
      base44.entities.VendorOrders.filter(byJob, "-created_date", 50),
    ]).then(([linked, source, orders]) => {
      if (!active) return;
      const quotes = [...new Map([...linked, ...source].map((q) => [q.id, q])).values()];
      setState({ loading: false, error: "", quotes, orders });
    }).catch(() => { if (active) setState({ loading: false, error: "Linked quotes and orders could not be loaded.", quotes: [], orders: [] }); });
    return () => { active = false; };
  }, [jobId, owner, memberKey, sourceQuoteId]);

  if (!owner) return null;
  const { loading, error, quotes, orders } = state;

  return (
    <section aria-labelledby="job-linked-heading" className="mt-5 overflow-hidden rounded-[14px] card-shadow" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="px-4 py-3" style={{ background: C.headerBg, borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2"><Link2 className="h-4 w-4" style={{ color: C.accentText }} /><h2 id="job-linked-heading" className="font-heading text-[16px] font-bold" style={{ color: C.text }}>Quotes &amp; orders</h2></div>
        <p className="mt-1 text-[11px]" style={{ color: C.textMuted }}>Window quotes and vendor orders linked to this job.</p>
      </div>
      <div className="p-4 space-y-4">
        {error && <p role="alert" className="text-[13px]" style={{ color: "var(--gf-error)" }}>{error}</p>}
        {loading && <p className="text-[12px]" style={{ color: C.textMuted }}>Loading…</p>}
        {!loading && !error && (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: C.textMuted }}><PanelsTopLeft className="h-3.5 w-3.5" />Window quotes</h3>
                <Link to="/window-quotes?new=1" className="text-[11px] font-semibold hover:underline" style={{ color: C.accentText }}>New quote</Link>
              </div>
              {!quotes.length && <p className="text-[12px]" style={{ color: C.textFaint }}>No window quotes linked yet.</p>}
              <ul className="space-y-1.5">
                {quotes.map((q) => (
                  <li key={q.id}>
                    <Link to={`/window-quotes?quote=${encodeURIComponent(q.id)}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--gf-hover)]" style={{ border: `1px solid ${C.rowBorder}` }}>
                      <span className="min-w-0 truncate text-[13px] font-medium" style={{ color: C.text }}>{q.title || q.request_id || "Window quote"}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {q.sales_status === "won" ? <Chip tone="good">Won</Chip> : <Chip tone={q.worker_status === "failed" || q.worker_status === "needs_details" ? "warn" : "neutral"}>{QUOTE_STATUS[q.worker_status] || "Open"}</Chip>}
                        <ArrowUpRight className="h-3.5 w-3.5" style={{ color: C.textMuted }} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: C.textMuted }}><Truck className="h-3.5 w-3.5" />Vendor orders</h3>
                <Link to="/job-budgets" className="text-[11px] font-semibold hover:underline" style={{ color: C.accentText }}>Job Budgets</Link>
              </div>
              {!orders.length && <p className="text-[12px]" style={{ color: C.textFaint }}>No vendor orders linked yet.</p>}
              <ul className="space-y-1.5">
                {orders.map((o) => (
                  <li key={o.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ border: `1px solid ${C.rowBorder}` }}>
                    <span className="min-w-0 text-[13px]" style={{ color: C.text }}><span className="font-medium">{o.vendor || "Vendor"}</span>{o.order_number ? <span style={{ color: C.textMuted }}> · #{o.order_number}</span> : null}{o.eta_date ? <span style={{ color: C.textMuted }}> · ETA {o.eta_date}</span> : null}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[12px] font-semibold" style={{ color: C.text }}>{money(o.amount)}<Chip tone={o.status === "reconciled" || o.status === "paid" ? "good" : "neutral"}>{ORDER_STATUS[o.status] || o.status || "Open"}</Chip></span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
