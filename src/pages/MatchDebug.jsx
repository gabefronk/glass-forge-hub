import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { Bug, RefreshCw, AlertTriangle, Search } from "lucide-react";

const STATUS_STYLE = {
  ok: { color: "#6EE7C0", bg: "rgba(110,231,192,.14)", label: "OK" },
  missing_photos: { color: "#FF8A7A", bg: "rgba(255,138,122,.14)", label: "MISSING PHOTOS" },
  missing_notes: { color: "#FF8A7A", bg: "rgba(255,138,122,.14)", label: "MISSING NOTES" },
  missing_all: { color: "#FF8A7A", bg: "rgba(255,138,122,.18)", label: "MISSING ALL" },
  no_source_data: { color: C.amber, bg: "rgba(255,181,71,.14)", label: "NO SOURCE DATA" },
  pending: { color: "rgba(255,255,255,.42)", bg: "rgba(255,255,255,.06)", label: "PENDING" },
};

export default function MatchDebug() {
  const [date, setDate] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [rerunResult, setRerunResult] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then((me) => { if (me) setUser(me); }).catch(() => {});
  }, []);

  const load = async (d) => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke("matchDebug", { date: d || date });
      setData(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") load(date);
  }, [user]); // eslint-disable-line

  const rerunAudit = async () => {
    setRerunLoading(true);
    setRerunResult(null);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 14 * 86400000);
      const result = await base44.functions.invoke("auditFieldReports", {
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        force: true,
      });
      setRerunResult(result);
      await load(date);
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
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <Bug className="h-5 w-5" style={{ color: C.accent }} />
          <h1 className="font-heading text-[20px] font-semibold" style={{ color: C.text, letterSpacing: "-0.03em" }}>Match Debug</h1>
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-full px-3 py-1.5 text-[12px] font-mono"
              style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text }}
            />
            <button
              onClick={() => load(date)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium whitespace-nowrap"
              style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}
            >
              <Search className="h-3.5 w-3.5" />
              {loading ? "Loading..." : "Load"}
            </button>
            <button
              onClick={rerunAudit}
              disabled={rerunLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap"
              style={{ backgroundColor: C.accent, color: C.accentDark }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${rerunLoading ? "animate-spin" : ""}`} />
              {rerunLoading ? "Re-running..." : "Re-run audit (14 days)"}
            </button>
          </div>
        </div>

        {rerunResult && (
          <div className="rounded-[14px] px-4 py-3 mb-4" style={{ backgroundColor: "rgba(110,231,192,.10)", border: `1px solid rgba(110,231,192,.25)` }}>
            <div className="text-[13px] font-medium" style={{ color: C.accent }}>
              Re-run complete: {rerunResult.events_evaluated} events evaluated across {rerunResult.dates_audited?.length || 0} dates
            </div>
            {(rerunResult.date_summaries || []).filter((d) => d.result === "no_source_data").length > 0 && (
              <div className="text-[12px] mt-1" style={{ color: C.amber }}>
                No source data: {rerunResult.date_summaries.filter((d) => d.result === "no_source_data").map((d) => d.date).join(", ")}
              </div>
            )}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <SummaryCard label="Calendar events" value={data.events_count} />
              <SummaryCard label="Field reports" value={data.reports_available} valueColor={data.reports_available === 0 ? "#FF8A7A" : C.accent} />
              <SummaryCard label="Projects" value={data.projects_available} />
            </div>

            {data.reports_available === 0 && (
              <div className="rounded-[14px] px-4 py-3 mb-4 flex items-center gap-2" style={{ backgroundColor: "rgba(255,138,122,.10)", border: `1px solid rgba(255,138,122,.25)` }}>
                <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "#FF8A7A" }} />
                <span className="text-[13px]" style={{ color: "#FF8A7A" }}>No FieldReports ingested for this date — Probuild sync likely failed.</span>
              </div>
            )}

            <div className="rounded-[16px] overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              {data.events.map((ev, i) => {
                const style = STATUS_STYLE[ev.final_status] || STATUS_STYLE.pending;
                return (
                  <div key={ev.event_id} className="px-5 py-4" style={{ borderTop: i > 0 ? `1px solid ${C.rowBorder}` : "none" }}>
                    <div className="flex items-start gap-3 mb-2">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap shrink-0" style={{ backgroundColor: style.bg, color: style.color }}>
                        {style.label}
                      </span>
                      <span className="text-[14px] font-medium" style={{ color: C.text }}>{ev.raw_name}</span>
                    </div>
                    <div className="grid grid-cols-1 min-[700px]:grid-cols-2 gap-x-6 gap-y-1.5 ml-1">
                      <Detail label="Alpha tokens" value={ev.alpha_tokens.join(" ") || "—"} />
                      <Detail label="Lot tokens" value={ev.lot_tokens.join(" ") || "—"} />
                      <Detail label="Address" value={ev.address || "—"} />
                      <Detail label="Resolved project" value={ev.resolved_project ? `${ev.resolved_project.name} (${ev.resolved_project.score.toFixed(3)})` : "none"} />
                      <Detail label="Post found" value={ev.post_found ? `Yes · ${ev.post_count} post(s) · ${ev.note_length} chars · ${ev.attachment_count} attachments` : "No"} />
                      <Detail label="Why" value={ev.reason} />
                    </div>
                    {ev.top_candidates.length > 0 && (
                      <div className="mt-2 ml-1">
                        <div className="mono-label-sm mb-1">Top candidates</div>
                        <div className="flex flex-wrap gap-2">
                          {ev.top_candidates.map((c, ci) => (
                            <span key={ci} className="font-mono text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: C.cardAlt, color: C.textSecondary }}>
                              {c.name} · {c.score.toFixed(3)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {data.events.length === 0 && (
                <div className="px-5 py-10 text-center text-[13px]" style={{ color: C.textMuted }}>No calendar events for this date.</div>
              )}
            </div>
          </>
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

function Detail({ label, value }) {
  return (
    <div>
      <span className="mono-label-sm mr-2">{label}:</span>
      <span className="text-[12px]" style={{ color: C.textSecondary }}>{value}</span>
    </div>
  );
}