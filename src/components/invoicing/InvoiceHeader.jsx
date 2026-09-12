import { ChevronLeft, ChevronRight, Lock, RefreshCw, Download, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

function relativeTime(iso) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function InvoiceHeader({ month, onMonthChange, onExportPdf, exporting, monthClosed, onCloseMonth, closing, onRefresh, refreshing, syncMessage, loadError }) {
  const [probuildStatus, setProbuildStatus] = useState(null);

  useEffect(() => {
    const refresh = () => base44.functions.invoke("probuildStatus", {}).then(res => setProbuildStatus(res.data)).catch(() => {});
    refresh();
    window.addEventListener("billing-updated", refresh);
    return () => window.removeEventListener("billing-updated", refresh);
  }, []);

  const [y, m] = month.split("-").map(Number);
  const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const today = new Date();
  const lastDay = new Date(y, m, 0, 23, 59, 59);
  const daysLeft = Math.max(0, Math.ceil((lastDay - today) / 86400000));
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const isCurrent = month === currentMonth;

  const shift = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  // Status line: combine "Closes in N days" and "ProBuild synced Xm ago" (existing values)
  const statusParts = [];
  if (isCurrent && daysLeft > 0) statusParts.push(`Closes in ${daysLeft} days`);
  if (probuildStatus && !probuildStatus.error) statusParts.push(`ProBuild synced ${relativeTime(probuildStatus.last_exchanged_at)}`);
  const statusLine = statusParts.join(" · ");

  return (
    <div style={{ position: "relative", zIndex: 30, backgroundColor: "var(--gf-card)", borderBottom: "1px solid var(--gf-border)" }}>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-5 px-5 sm:px-6 lg:px-8" style={{ minHeight: "68px", paddingTop: "12px", paddingBottom: "12px" }}>
        {/* Left: title + status line */}
        <div className="flex flex-col" style={{ flexShrink: 0 }}>
          <span className="text-[20px] font-semibold" style={{ color: "var(--gf-ink)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>Invoicing</span>
          {statusLine && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span style={{ width: "6px", height: "6px", borderRadius: "99px", backgroundColor: "var(--gf-sync)", flexShrink: 0 }} />
              <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>{statusLine}</span>
            </div>
          )}
        </div>

        {/* Month stepper */}
        <div className="flex items-center" style={{ flexShrink: 0 }}>
          <div className="flex items-center" style={{ height: "34px", borderRadius: "var(--r-button)", backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border-2)", boxShadow: "var(--shadow-control)" }}>
            <button onClick={() => shift(-1)} aria-label="Previous month" style={{ width: "32px", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid var(--gf-hairline)", color: "var(--gf-ink-2)", cursor: "pointer", backgroundColor: "transparent" }}>
              <ChevronLeft style={{ width: "16px", height: "16px" }} strokeWidth={1.8} strokeLinecap="round" />
            </button>
            <span className="text-[13.5px] font-semibold" style={{ color: "var(--gf-ink)", minWidth: "110px", textAlign: "center", whiteSpace: "nowrap" }}>
              {monthName}
            </span>
            <button onClick={() => shift(1)} aria-label="Next month" style={{ width: "32px", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderLeft: "1px solid var(--gf-hairline)", color: "var(--gf-ink-2)", cursor: "pointer", backgroundColor: "transparent" }}>
              <ChevronRight style={{ width: "16px", height: "16px" }} strokeWidth={1.8} strokeLinecap="round" />
            </button>
          </div>
        </div>

        {/* ProBuild details — keep for extra info (Team ID, audit run, etc.) */}
        {probuildStatus && !probuildStatus.error && (
          <details className="hidden md:block" style={{ flexShrink: 0 }}>
            <summary className="cursor-pointer list-none" style={{ padding: "5px 10px", borderRadius: "var(--r-chip)", backgroundColor: "var(--gf-field)", border: "1px solid var(--gf-border)", color: "var(--gf-ink-3)", fontSize: "11px", fontWeight: 500 }}>
              Details
            </summary>
            <div className="mt-1.5 rounded-lg p-3 text-[11px]" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", color: "var(--gf-ink-3)", lineHeight: 1.5, whiteSpace: "nowrap" }}>
              <div>Team ID: <span className="font-mono-num">{probuildStatus.team_id || "—"}</span></div>
              <div>Last token exchange: {probuildStatus.last_exchanged_at ? new Date(probuildStatus.last_exchanged_at).toLocaleString() : "never"}</div>
              <div>Last audit run: {probuildStatus.last_audit_at ? new Date(probuildStatus.last_audit_at).toLocaleString() : "never"}</div>
            </div>
          </details>
        )}

        <div style={{ flex: 1 }} />

        {/* Actions */}
        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
          <button onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? "Refreshing" : "Refresh"} title="Refresh" style={{ height: "34px", borderRadius: "var(--r-button)", backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border-2)", boxShadow: "var(--shadow-control)", color: "var(--gf-ink-4)", fontSize: "13px", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 12px", whiteSpace: "nowrap", flexShrink: 0, cursor: refreshing ? "wait" : "pointer" }}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} strokeLinecap="round" style={{ animation: refreshing ? "spin 1s linear infinite" : undefined }} />
            <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
          <button onClick={onExportPdf} disabled={exporting} aria-label={exporting ? "Generating" : "Export"} title="Export" style={{ height: "34px", borderRadius: "var(--r-button)", backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border-2)", boxShadow: "var(--shadow-control)", color: "var(--gf-ink-4)", fontSize: "13px", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 12px", whiteSpace: "nowrap", flexShrink: 0, cursor: exporting ? "wait" : "pointer" }}>
            <Download className="h-4 w-4" strokeWidth={1.8} strokeLinecap="round" />
            <span className="hidden sm:inline">{exporting ? "Generating…" : "Export"}</span>
          </button>
          {monthClosed ? (
            <div className="flex items-center gap-1.5" style={{ padding: "0 12px", height: "34px", borderRadius: "var(--r-button)", backgroundColor: "var(--gf-teal-050)", border: "1px solid var(--gf-teal-halo)", whiteSpace: "nowrap", flexShrink: 0 }} title={`Closed ${new Date(monthClosed.closed_at).toLocaleString()}\nBy ${monthClosed.closed_by}\nInvoiced: $${(monthClosed.invoiced_subtotal ?? monthClosed.total_fee)?.toFixed(2)} (${monthClosed.invoiced_line_count ?? monthClosed.line_count} ready)\nEarned: $${monthClosed.earned_total?.toFixed(2)} (${monthClosed.earned_line_count} lines)\nTotal rows: ${monthClosed.total_rows}`}>
              <Lock style={{ width: "14px", height: "14px", color: "var(--gf-teal-600)" }} strokeWidth={1.8} strokeLinecap="round" />
              <span className="text-[12px] font-semibold" style={{ color: "var(--gf-teal-800)" }}>
                Closed · ${(monthClosed.invoiced_subtotal ?? monthClosed.total_fee)?.toFixed(2)}
              </span>
            </div>
          ) : (
            <button onClick={onCloseMonth} disabled={closing} aria-label={closing ? "Closing" : "Close month"} title="Close month" style={{ height: "34px", borderRadius: "var(--r-button)", background: "linear-gradient(180deg, var(--gf-teal-500), var(--gf-teal-600))", color: "#F4F1EA", fontSize: "13px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 14px", whiteSpace: "nowrap", flexShrink: 0, boxShadow: "0 1px 2px rgba(11,63,59,.35), inset 0 1px 0 rgba(255,255,255,.12)", cursor: closing ? "wait" : "pointer" }}>
              <FileText className="h-4 w-4" strokeWidth={1.8} strokeLinecap="round" />
              <span className="hidden sm:inline">{closing ? "Closing…" : "Close month"}</span>
            </button>
          )}
        </div>
      </div>

      {(syncMessage || loadError) && (
        <div className="mx-auto max-w-[1440px] px-5 pb-3 sm:px-6 lg:px-8">
          {loadError && <p role="alert" className="text-[13px]" style={{ color: "#A43432" }}>{loadError}</p>}
          {syncMessage && !loadError && <p role="status" className="text-[13px]" style={{ color: "var(--gf-ink-3)" }}>{syncMessage}</p>}
        </div>
      )}
    </div>
  );
}