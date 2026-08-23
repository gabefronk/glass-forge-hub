import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { Bug, RefreshCw, AlertTriangle, Search } from "lucide-react";
import PostsHistogram from "@/components/matchdebug/PostsHistogram";

const STATUS_STYLE = {
  ok: { color: "#6EE7C0", bg: "rgba(110,231,192,.14)", label: "OK" },
  missing_photos: { color: "#FF8A7A", bg: "rgba(255,138,122,.14)", label: "MISSING PHOTOS" },
  missing_notes: { color: "#FF8A7A", bg: "rgba(255,138,122,.14)", label: "MISSING NOTES" },
  missing_all: { color: "#FF8A7A", bg: "rgba(255,138,122,.18)", label: "MISSING ALL" },
  no_source_data: { color: "#FFB54B", bg: "rgba(255,181,71,.14)", label: "NO SOURCE DATA" },
  pending: { color: "#FFB54B", bg: "rgba(255,181,71,.14)", label: "PENDING (GRACE)" },
  pre_compliance: { color: "rgba(255,255,255,.42)", bg: "rgba(255,255,255,.06)", label: "PRE-COMPLIANCE" },
};

const OFFSET_LABELS = { 0: "Exact (0)", 1: "Next day (+1)", "-1": "Day before (-1)", null: "Unmatched" };

export default function MatchDebug() {
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = new Date(today.getTime() - 21 * 86400000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [rerunResult, setRerunResult] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then((me) => { if (me) setUser(me); }).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke("matchDebug", { start_date: startDate, end_date: endDate });
      setData(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") load();
  }, [user]); // eslint-disable-line

  const rerunAudit = async () => {
    setRerunLoading(true);
    setRerunResult(null);
    try {
      const result = await base44.functions.invoke("auditFieldReports", {
        start_date: startDate,
        end_date: endDate,
        force: true,
      });
      setRerunResult(result);
      await load();
    } finally {
      setRerunLoading(false);
    }
  };

  if (user && user.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3" style={{ color: C.amber }} />
          <p className="text-[14px]" style={{ color: C.textMuted }}>Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-10">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <Bug className="h-5 w-5" style={{ color: C.accent }} />
          <h1 className="font-heading text-[20px] font-semibold" style={{ color: C.text, letterSpacing: "-0.03em" }}>Match Debug</h1>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-full px-3 py-1.5 text-[12px] font-mono" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text }} />
            <span className="text-[12px]" style={{ color: C.textMuted }}>→</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-full px-3 py-1.5 text-[12px] font-mono" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text }} />
            <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
              <Search className="h-3.5 w-3.5" />{loading ? "Loading..." : "Load"}
            </button>
            <button onClick={rerunAudit} disabled={rerunLoading} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark }}>
              <RefreshCw className={`h-3.5 w-3.5 ${rerunLoading ? "animate-spin" : ""}`} />{rerunLoading ? "Re-running..." : "Re-run audit"}
            </button>
          </div>
        </div>

        {/* Re-run result */}
        {rerunResult && (
          <div className="rounded-[14px] px-4 py-3 mb-4" style={{ backgroundColor: "rgba(110,231,192,.10)", border: `1px solid rgba(110,231,192,.25)` }}>
            <div className="text-[13px] font-medium" style={{ color: C.accent }}>
              Re-run complete: {rerunResult.events_evaluated} events evaluated across {rerunResult.dates_audited?.length || 0} dates
            </div>
            {rerunResult.offset_distribution && (
              <div className="text-[12px] mt-1" style={{ color: C.textSecondary }}>
                Offsets — exact: {rerunResult.offset_distribution['0'] || 0} · +1: {rerunResult.offset_distribution['1'] || 0} · -1: {rerunResult.offset_distribution['-1'] || 0} · unmatched: {rerunResult.offset_distribution['null'] || 0}
              </div>
            )}
          </div>
        )}

        {/* Summary row */}
        {data?.summary && (
          <>
            <div className="grid grid-cols-2 min-[700px]:grid-cols-5 gap-3 mb-4">
              <SummaryCard label="Events evaluated" value={data.summary.events_evaluated} />
              <SummaryCard label="Photos + notes" value={data.summary.matched_ok} valueColor={C.accent} />
              <SummaryCard label="Photos, no notes" value={data.summary.matched_missing_notes} valueColor="#FF8A7A" />
              <SummaryCard label="Notes, no photos" value={data.summary.matched_missing_photos} valueColor="#FF8A7A" />
              <SummaryCard label="No match found" value={data.summary.no_match} valueColor="#FF8A7A" />
            </div>
            {data.summary.pre_compliance > 0 && (
              <div className="text-[11px] mb-3 font-mono" style={{ color: C.textMuted }}>
                {data.summary.pre_compliance} pre-compliance event(s) in range — suppressed on Today tab, shown here for matcher tuning
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <ScanCard label="Offset -1 (day before)" value={data.offset_distribution['-1'] || 0} valueColor={C.amber} />
              <ScanCard label="Offset 0 (exact)" value={data.offset_distribution['0'] || 0} valueColor={C.accent} />
              <ScanCard label="Offset +1 (next day)" value={data.offset_distribution['1'] || 0} valueColor={C.accent} />
            </div>
          </>
        )}

        {/* Histogram */}
        {data?.histogram && <PostsHistogram data={data.histogram} />}

        {/* Project scan */}
        {data?.project_scan && !data.project_scan.error && (
          <div className="grid grid-cols-4 gap-3 mb-5 mt-4">
            <ScanCard label="Projects total" value={data.project_scan.total} />
            <ScanCard label="Skipped (deleted)" value={data.project_scan.deleted} valueColor={data.project_scan.deleted > 0 ? C.textSecondary : undefined} />
            <ScanCard label="Skipped (modified)" value={data.project_scan.skipped_modified} valueColor={C.amber} />
            <ScanCard label="Qualifying" value={data.project_scan.qualifying} valueColor={C.accent} />
          </div>
        )}
        {data?.project_scan?.error && (
          <div className="rounded-[14px] px-4 py-3 mb-4 flex items-center gap-2" style={{ backgroundColor: "rgba(255,138,122,.10)", border: `1px solid rgba(255,138,122,.25)` }}>
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "#FF8A7A" }} />
            <span className="text-[12px]" style={{ color: "#FF8A7A" }}>Project scan failed: {data.project_scan.error}</span>
          </div>
        )}

        {/* Per-event list grouped by date */}
        {data?.events_by_date && (
          <div className="mt-4">
            {data.events_by_date.map((dayGroup) => (
              <div key={dayGroup.date} className="mb-4">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: C.textMuted }}>
                    {new Date(dayGroup.date + 'T00:00:00').toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                  <span className="font-mono-num text-[11px]" style={{ color: C.textFaint }}>{dayGroup.events.length} event(s)</span>
                </div>
                <div className="rounded-[16px] overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                  {dayGroup.events.map((ev, i) => {
                    const style = STATUS_STYLE[ev.report_status_raw] || STATUS_STYLE.pending;
                    const isPreCompliance = ev.report_status === "pre_compliance";
                    return (
                      <div key={ev.event_id} className="px-5 py-3" style={{ borderTop: i > 0 ? `1px solid ${C.rowBorder}` : "none" }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap shrink-0" style={{ backgroundColor: style.bg, color: style.color }}>
                            {style.label}
                          </span>
                          {isPreCompliance && (
                            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap shrink-0" style={{ backgroundColor: "rgba(255,255,255,.06)", color: C.textMuted }}>
                              SUPPRESSED
                            </span>
                          )}
                          {ev.report_date_offset !== null && ev.report_date_offset !== undefined && (
                            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap shrink-0" style={{ backgroundColor: ev.report_date_offset === -1 ? "rgba(255,181,71,.14)" : "rgba(110,231,192,.10)", color: ev.report_date_offset === -1 ? "#FFB54B" : C.accent }}>
                              {OFFSET_LABELS[ev.report_date_offset]}
                            </span>
                          )}
                          <span className="text-[13px] font-medium" style={{ color: C.text }}>{ev.job_name}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 ml-1 flex-wrap">
                          {ev.address && <span className="text-[11px]" style={{ color: C.textMuted }}>{ev.address}</span>}
                          <span className="font-mono text-[10px]" style={{ color: C.textFaint }}>
                            {ev.match_method ? ev.match_method.toUpperCase() : "—"}{ev.match_confidence != null ? ` · ${(ev.match_confidence * 100).toFixed(0)}%` : ""}
                          </span>
                          {ev.matched_post_count > 0 && (
                            <span className="font-mono text-[10px]" style={{ color: C.textFaint }}>{ev.matched_post_count} post(s)</span>
                          )}
                          {ev.days_late > 0 && (
                            <span className="font-mono text-[10px]" style={{ color: "#FF8A7A" }}>{ev.days_late}d late</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {data.events_by_date.length === 0 && (
              <div className="rounded-[16px] px-5 py-10 text-center text-[13px]" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.textMuted }}>
                No calendar events in this range.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, valueColor }) {
  return (
    <div className="rounded-[14px] p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="mono-label-sm mb-1.5">{label}</div>
      <div className="font-mono-num-bold text-[24px]" style={{ color: valueColor || C.text, letterSpacing: "-0.025em" }}>{value}</div>
    </div>
  );
}

function ScanCard({ label, value, valueColor }) {
  return (
    <div className="rounded-[14px] p-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="mono-label-sm mb-1">{label}</div>
      <div className="font-mono-num-bold text-[20px]" style={{ color: valueColor || C.text }}>{value}</div>
    </div>
  );
}