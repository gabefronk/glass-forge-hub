import { Search, ChevronLeft, ChevronRight, Lock, RefreshCw, Download, FileText } from "lucide-react";
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

export default function InvoiceHeader({ month, onMonthChange, search, onSearchChange, readyCount, onSelectAllReady, searchRef, onExportPdf, exporting, monthClosed, onCloseMonth, closing, onRefresh, refreshing, syncMessage, loadError }) {
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

  const btnBase = {
    height: "40px",
    borderRadius: "8px",
    fontFamily: "'Archivo',sans-serif",
    fontSize: "13px",
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "0 14px",
    whiteSpace: "nowrap",
    flexShrink: 0,
    cursor: "pointer",
  };

  return (
    <div style={{ position: "relative", zIndex: 30, backgroundColor: "#FFFFFF", borderBottom: "1px solid #DDE0DA" }}>
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 xl:px-10">
        {/* Title + month picker */}
        <div className="flex items-center gap-3" style={{ flexShrink: 0 }}>
          <div className="flex flex-col" style={{ gap: "1px" }}>
            <span className="text-[11px] font-medium" style={{ color: "#53615B", letterSpacing: "0.02em" }}>Invoicing · Monthly close</span>
            <span className="text-[20px] font-bold" style={{ color: "#182422", letterSpacing: "-0.02em" }}>Invoicing</span>
          </div>
        </div>

        <div className="hidden sm:block" style={{ width: "1px", height: "32px", backgroundColor: "#DDE0DA", flexShrink: 0 }} />

        {/* Month picker */}
        <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
          <button onClick={() => shift(-1)} aria-label="Previous month" style={{ ...btnBase, width: "40px", padding: 0, justifyContent: "center", backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#53615B" }}>
            <ChevronLeft style={{ width: "16px", height: "16px" }} />
          </button>
          <span className="text-[14px] font-semibold" style={{ color: "#182422", minWidth: "120px", textAlign: "center", whiteSpace: "nowrap" }}>
            {monthName}
          </span>
          <button onClick={() => shift(1)} aria-label="Next month" style={{ ...btnBase, width: "40px", padding: 0, justifyContent: "center", backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#53615B" }}>
            <ChevronRight style={{ width: "16px", height: "16px" }} />
          </button>
          {isCurrent && daysLeft > 0 && (
            <span className="ml-1 text-[11px] font-semibold" style={{ padding: "3px 8px", borderRadius: "99px", backgroundColor: "#FFF3DF", border: "1px solid #F0DBA8", color: "#89511A", whiteSpace: "nowrap" }}>
              Closes in {daysLeft} days
            </span>
          )}
        </div>

        {/* Source freshness */}
        {probuildStatus && !probuildStatus.error && (
          <div className="hidden md:flex items-center gap-1.5" style={{ padding: "5px 10px", borderRadius: "99px", backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", flexShrink: 0 }} title={`Probuild team ID: ${probuildStatus.team_id}\nLast token exchange: ${probuildStatus.last_exchanged_at || "never"}\nLast audit run: ${probuildStatus.last_audit_at || "never"}`}>
            <span style={{ width: "6px", height: "6px", borderRadius: "99px", backgroundColor: "#166447" }} />
            <span className="text-[11px] font-medium" style={{ color: "#53615B", whiteSpace: "nowrap" }}>
              ProBuild · {probuildStatus.team_id?.slice(0, 8)}… · sync {relativeTime(probuildStatus.last_exchanged_at)}
            </span>
          </div>
        )}

        <div className="hidden xl:block" style={{ flex: 1 }} />

        {/* Actions group */}
        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
          <button onClick={onRefresh} disabled={refreshing} className="min-h-10" style={{ ...btnBase, backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#182422", cursor: refreshing ? "wait" : "pointer" }}>
            <RefreshCw className="h-3.5 w-3.5" style={{ animation: refreshing ? "spin 1s linear infinite" : undefined }} />
            <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
          <button onClick={onExportPdf} disabled={exporting} className="min-h-10" style={{ ...btnBase, backgroundColor: "#FFFFFF", border: "1px solid #DDE0DA", color: "#182422", cursor: exporting ? "wait" : "pointer" }}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{exporting ? "Generating…" : "Export"}</span>
          </button>
          {monthClosed ? (
            <div className="flex items-center gap-1.5" style={{ padding: "0 12px", height: "40px", borderRadius: "8px", backgroundColor: "#EAF5EE", border: "1px solid #C7E4D2", whiteSpace: "nowrap", flexShrink: 0 }} title={`Closed ${new Date(monthClosed.closed_at).toLocaleString()}\nBy ${monthClosed.closed_by}\nInvoiced: $${(monthClosed.invoiced_subtotal ?? monthClosed.total_fee)?.toFixed(2)} (${monthClosed.invoiced_line_count ?? monthClosed.line_count} ready)\nEarned: $${monthClosed.earned_total?.toFixed(2)} (${monthClosed.earned_line_count} lines)\nTotal rows: ${monthClosed.total_rows}`}>
              <Lock style={{ width: "13px", height: "13px", color: "#166447" }} />
              <span className="text-[12px] font-semibold" style={{ color: "#166447" }}>
                Closed · ${(monthClosed.invoiced_subtotal ?? monthClosed.total_fee)?.toFixed(2)}
              </span>
            </div>
          ) : (
            <button onClick={onCloseMonth} disabled={closing} className="min-h-10" style={{ ...btnBase, backgroundColor: "#FFFFFF", border: "1px solid #DDE0DA", color: "#182422", cursor: closing ? "wait" : "pointer" }}>
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{closing ? "Closing…" : "Close month"}</span>
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative flex w-full min-w-0 items-center sm:w-auto sm:flex-1 sm:basis-[220px]">
          <Search style={{ position: "absolute", left: "12px", width: "15px", height: "15px", color: "#8A958F", pointerEvents: "none" }} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search lines and jobs"
            aria-label="Search lines and jobs"
            style={{ width: "100%", minWidth: 0, height: "40px", borderRadius: "8px", backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#182422", fontSize: "14px", fontFamily: "'Archivo',sans-serif", paddingLeft: "36px", paddingRight: "40px", outline: "none" }}
          />
          <span style={{ position: "absolute", right: "10px", fontFamily: "'Archivo',sans-serif", fontSize: "10px", color: "#8A958F", border: "1px solid #DDE0DA", borderRadius: "4px", padding: "1px 4px", pointerEvents: "none" }}>⌘K</span>
        </div>

        <button onClick={onSelectAllReady} className="w-full sm:w-auto" style={{ ...btnBase, backgroundColor: "#146556", border: "1px solid #104E44", color: "#FFFFFF", fontWeight: 600, justifyContent: "center", cursor: "pointer" }}>
          Select all ready{readyCount > 0 ? ` (${readyCount})` : ""}
        </button>
      </div>

      {(syncMessage || loadError) && (
        <div className="mx-auto max-w-[1180px] px-4 pb-3 sm:px-6 xl:px-10">
          {loadError && <p role="alert" className="text-[13px]" style={{ color: "#A43432" }}>{loadError}</p>}
          {syncMessage && !loadError && <p role="status" className="text-[13px]" style={{ color: "#53615B" }}>{syncMessage}</p>}
        </div>
      )}
    </div>
  );
}