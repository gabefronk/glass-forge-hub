import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { PageShell, PageHero, HeroStat, heroBtn, heroPrimary } from "@/components/PageShell";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import { RefreshCw, AlertTriangle, Link2, DollarSign, CheckCircle2, Sparkles, ArrowUpRight } from "lucide-react";

const REASON_LABELS = {
  no_job_link: "No job linked",
  lot_mismatch: "Lot disagrees with linked job",
  community_mismatch: "Community disagrees with linked job",
  linked_job_not_found: "Linked job no longer exists",
  customer_clash: "Builder/customer disagrees with linked job",
};

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Deep link to the Invoicing page scoped to the line's job + month. The Invoicing
// page reads `month` and `job_id` query params; this does not change its behavior.
function lineLink(row) {
  const month = row.invoice_month || (row.job_date || "").slice(0, 7);
  const p = new URLSearchParams({ month });
  const jobId = row.current_job_id || row.job_id || row.suggested_job_id;
  if (jobId) p.set("job_id", jobId);
  return `/?${p.toString()}`;
}

function SectionCard({ icon: Icon, tile, title, sub, count, children }) {
  return (
    <SheetCard icon={Icon} tile={tile} title={title} sub={sub} className="mt-4" bodyClassName="px-5 max-[699px]:px-4">
      <div className="flex items-center gap-2 pb-3">
        <span className="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: "var(--gf-field)", color: "var(--gf-ink-2)" }}>
          {count} {count === 1 ? "line" : "lines"}
        </span>
      </div>
      {children}
    </SheetCard>
  );
}

function LineRow({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5 border-t" style={{ borderColor: "var(--gf-hairline)" }}>
      {children}
    </div>
  );
}

function LineIdChip({ id }) {
  return <span className="font-ref text-[11px]" style={{ color: "var(--gf-ink-3)" }}>{id}</span>;
}

export default function InvoicingAgent() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await base44.functions.invoke("invoicingAgentWorklist", { month });
      const body = res?.data ?? res;
      if (body && body.error) throw new Error(body.error);
      setData(body);
    } catch (e) {
      setError(e?.message || "Could not load the agent worklist.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { if (user?.role === "admin") load(); }, [load, user?.role]);

  // Admin-only. Crew (Israel, role 'user') must never see pricing.
  if (user?.role !== "admin") {
    return (
      <PageShell>
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: "var(--gf-border)", backgroundColor: "var(--gf-card)" }}>
          <p className="text-[15px] font-medium" style={{ color: "var(--gf-ink)" }}>This view is admin only.</p>
        </div>
      </PageShell>
    );
  }

  const c = data?.counts || { needs_pricing: 0, needs_job_link: 0, pricing_conflicts: 0, ready_to_bill: 0 };
  const ready = data?.ready_to_bill || { count: 0, subtotal: 0, labor_total: 0 };

  return (
    <PageShell width="max-w-[1280px]">
      <PageHero
        eyebrow="Invoicing Agent · v1"
        title="Agent worklist"
        sub="Read-only flags for the current month plus the prior month's open lines. The agent never writes — it only lists what needs a human look."
        chip="flag & list only"
        actions={
          <>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value || new Date().toISOString().slice(0, 7))}
              className="rounded-[9px] px-3 text-[13px] font-medium"
              style={{ height: 38, backgroundColor: "rgba(255,255,255,.08)", color: "var(--gf-sidebar-text-on)", border: "1px solid rgba(255,255,255,.16)" }}
            />
            <button onClick={load} disabled={loading} className={heroBtn} style={heroPrimary}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} strokeWidth={1.8} />
              {loading ? "Analyzing…" : "Refresh"}
            </button>
          </>
        }
      >
        <div className="flex flex-wrap gap-3">
          <HeroStat label="Needs pricing" value={c.needs_pricing} tone="brass" />
          <HeroStat label="Needs job link" value={c.needs_job_link} />
          <HeroStat label="Pricing conflicts" value={c.pricing_conflicts} />
          <HeroStat label="Ready to bill" value={ready.count} sub={`$${money(ready.subtotal)} fee`} />
        </div>
      </PageHero>

      {error && (
        <div className="rounded-xl border p-4 text-[14px]" style={{ borderColor: "var(--gf-error-border)", backgroundColor: "var(--gf-error-bg)", color: "var(--gf-error)" }}>
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: "var(--gf-border)", borderTopColor: "var(--gf-teal-600)" }} />
        </div>
      ) : (
        <>
          {/* Needs pricing */}
          <SectionCard icon={DollarSign} tile={TILE.sand} title="Needs pricing" sub="No labor amount and no explicit no-charge note. Crew (Israel) ProBuild lines use Send for Review — Hub-side only." count={c.needs_pricing}>
            {data.needs_pricing.length === 0 ? <EmptyState /> : data.needs_pricing.map((r) => (
              <LineRow key={r.line_id}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={lineLink(r)} className="text-[14px] font-semibold hover:underline" style={{ color: "var(--gf-ink)" }}>{r.job_name_raw || r.job_name_norm || "(untitled)"}</Link>
                    <LineIdChip id={r.line_id} />
                  </div>
                  <div className="text-[12.5px] truncate" style={{ color: "var(--gf-ink-2)" }}>{r.line_description || r.job_date}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--gf-field)", color: "var(--gf-ink-3)" }}>{r.source}</span>
                  {r.crew_line && (
                    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--gf-amber-050)", color: "var(--gf-amber-700)" }}>
                      {r.sent_for_review ? "sent for review" : "crew · send for review"}
                    </span>
                  )}
                  <Link to={lineLink(r)} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: "var(--gf-teal-600)" }}>Open<ArrowUpRight className="h-3.5 w-3.5" /></Link>
                </div>
              </LineRow>
            ))}
          </SectionCard>

          {/* Needs job link */}
          <SectionCard icon={Link2} tile={TILE.slate} title="Needs job link" sub="No link, a missing link, or the lot/community clashes with the linked job. A single clear survivor is suggested; otherwise candidates are listed." count={c.needs_job_link}>
            {data.needs_job_link.length === 0 ? <EmptyState /> : data.needs_job_link.map((r) => (
              <LineRow key={r.line_id}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={lineLink(r)} className="text-[14px] font-semibold hover:underline" style={{ color: "var(--gf-ink)" }}>{r.job_name_raw || r.job_name_norm || "(untitled)"}</Link>
                    <LineIdChip id={r.line_id} />
                  </div>
                  <div className="text-[12.5px]" style={{ color: "var(--gf-error)" }}>{REASON_LABELS[r.reason] || r.reason}</div>
                  {r.current_job_name && <div className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>linked: {r.current_job_name}</div>}
                </div>
                <div className="min-w-[220px] flex-1">
                  {r.suggested_job_id ? (
                    <div className="text-[12.5px]">
                      <span style={{ color: "var(--gf-ink-3)" }}>suggest → </span>
                      <Link to={`/jobs/${r.suggested_job_id}`} className="font-semibold hover:underline" style={{ color: "var(--gf-teal-600)" }}>{r.suggested_job_name}</Link>
                    </div>
                  ) : r.candidates.length ? (
                    <div className="text-[12.5px]" style={{ color: "var(--gf-ink-3)" }}>
                      <span>{r.candidates.length} candidate{r.candidates.length === 1 ? "" : "s"}: </span>
                      {r.candidates.map((cand, i) => (
                        <span key={cand.job_id}>
                          <Link to={`/jobs/${cand.job_id}`} className="font-medium hover:underline" style={{ color: "var(--gf-teal-600)" }}>{cand.job_name || cand.job_id}</Link>
                          {i < r.candidates.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12.5px]" style={{ color: "var(--gf-ink-3)" }}>no clear existing match</div>
                  )}
                </div>
                <Link to={lineLink(r)} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: "var(--gf-teal-600)" }}>Open<ArrowUpRight className="h-3.5 w-3.5" /></Link>
              </LineRow>
            ))}
          </SectionCard>

          {/* Pricing conflicts */}
          <SectionCard icon={AlertTriangle} tile={TILE.sand} title="Pricing conflicts" sub="Two lines for the same job and same visit date with different amounts. Never summed, folded or superseded — both amounts shown." count={c.pricing_conflicts}>
            {data.pricing_conflicts.length === 0 ? <EmptyState /> : data.pricing_conflicts.map((g) => (
              <div key={g.job_id + g.job_date} className="py-3 border-t" style={{ borderColor: "var(--gf-hairline)" }}>
                <div className="flex flex-wrap items-center gap-2 pb-1.5">
                  <Link to={`/jobs/${g.job_id}`} className="text-[14px] font-semibold hover:underline" style={{ color: "var(--gf-ink)" }}>{g.job_name}</Link>
                  <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>{g.job_date}</span>
                  <span className="text-[11px] font-medium rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--gf-amber-050)", color: "var(--gf-amber-700)" }}>
                    {g.amounts.map((a) => "$" + money(a)).join(" vs ")}
                  </span>
                </div>
                {g.lines.map((l) => (
                  <div key={l.line_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 pl-3">
                    <span className="font-mono-num-bold text-[14px]" style={{ color: "var(--gf-ink)" }}>${money(l.labor_amt)}</span>
                    <span className="text-[11px] font-medium rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--gf-field)", color: "var(--gf-ink-3)" }}>{l.source}</span>
                    <LineIdChip id={l.line_id} />
                    <span className="text-[12px] truncate" style={{ color: "var(--gf-ink-2)" }}>{l.line_description}</span>
                    {l.superseded_by && <span className="text-[11px]" style={{ color: "var(--gf-ink-3)" }}>· superseded</span>}
                  </div>
                ))}
              </div>
            ))}
          </SectionCard>

          {/* Ready to bill */}
          <SectionCard icon={CheckCircle2} tile={TILE.teal} title="Ready to bill" sub="Open lines with labor, a clean job link, no conflict, no report block and not superseded." count={ready.count}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1">
              <span className="font-mono-num-bold text-[22px]" style={{ color: "var(--gf-teal-700)" }}>${money(ready.subtotal)}</span>
              <span className="text-[13px]" style={{ color: "var(--gf-ink-2)" }}>fee · {ready.count} {ready.count === 1 ? "line" : "lines"}</span>
              <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>· ${money(ready.labor_total)} labor</span>
            </div>
            <div className="pt-2">
              <Link to={`/?month=${encodeURIComponent(month)}`} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: "var(--gf-teal-600)" }}>
                Open Invoicing for {month}<ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </SectionCard>

          <p className="pt-1 text-[12px] flex items-center gap-1.5" style={{ color: "var(--gf-ink-3)" }}>
            <Sparkles className="h-3.5 w-3.5" /> The agent only reads and displays. It never writes, bills, merges, supersedes or notifies.
          </p>
        </>
      )}
    </PageShell>
  );
}

function EmptyState() {
  return <div className="py-6 text-[13px]" style={{ color: "var(--gf-ink-3)" }}>Nothing in this section.</div>;
}