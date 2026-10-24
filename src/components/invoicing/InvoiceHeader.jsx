import { ChevronLeft, ChevronRight, Lock, MoreHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

// Invoicing header, one row (declutter, Oct 24): title, month picker, Close month, and
// one ⋯ menu holding Month details, Profit & cost details, Refresh from ProBuild and
// Export. The eyebrow, the status line and the separate buttons are gone.
function relativeTime(iso) {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const BAND = "#0B3F3B", TITLE = "#F2EEE8", EDGE = "rgba(242,238,232,.3)", BRASS = "#E0C994";
const control = { height: "36px", borderRadius: "8px", border: `1px solid ${EDGE}`, backgroundColor: "transparent", color: TITLE, display: "inline-flex", alignItems: "center", cursor: "pointer" };
const item = "flex min-h-9 cursor-pointer items-center justify-between gap-6 text-[14px]";

export default function InvoiceHeader({ month, onMonthChange, onExportPdf, exporting, monthClosed, onCloseMonth, closing, onRefresh, refreshing, syncMessage, loadError, onToggleProfit, jobScoped = false }) {
  const [probuildStatus, setProbuildStatus] = useState(null);
  const [details, setDetails] = useState(false);

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
  const isCurrent = month === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const synced = probuildStatus && !probuildStatus.error ? relativeTime(probuildStatus.last_exchanged_at) : "";

  const shift = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const fmtMoney = (v) => (typeof v === "number" ? `$${v.toFixed(2)}` : "—");

  return (
    <div className="mx-auto max-w-[1440px] px-5 pt-5 sm:px-6 lg:px-8 max-[699px]:px-3 max-[699px]:pt-4">
      <div className="rounded-[12px]" style={{ position: "relative", zIndex: 30, backgroundColor: BAND }}>
        <div className="flex flex-wrap items-center gap-4" style={{ minHeight: "60px", padding: "8px 12px 8px 20px" }}>
          <h1 className="m-0 text-[24px] font-bold" style={{ color: TITLE, letterSpacing: "-0.03em", lineHeight: 1.2 }}>Invoicing</h1>

          <div style={{ ...control, cursor: "default" }}>
            <button onClick={() => shift(-1)} aria-label="Previous month" className="min-w-11 sm:min-w-9" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: TITLE, background: "none", border: "none", cursor: "pointer" }}>
              <ChevronLeft style={{ width: "16px", height: "16px" }} strokeWidth={1.8} />
            </button>
            <span className="text-[15px] font-semibold" style={{ color: TITLE, minWidth: "124px", textAlign: "center", whiteSpace: "nowrap" }}>{monthName}</span>
            <button onClick={() => shift(1)} aria-label="Next month" className="min-w-11 sm:min-w-9" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: TITLE, background: "none", border: "none", cursor: "pointer" }}>
              <ChevronRight style={{ width: "16px", height: "16px" }} strokeWidth={1.8} />
            </button>
          </div>

          <div style={{ flex: 1 }} />

          {jobScoped ? null : monthClosed ? (
            <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold" style={{ ...control, cursor: "default", padding: "0 12px", color: BRASS, borderColor: BRASS }}>
              <Lock style={{ width: "14px", height: "14px" }} strokeWidth={1.8} /> Closed
            </span>
          ) : (
            <button onClick={onCloseMonth} disabled={closing} className="text-[14px] font-semibold" style={{ ...control, padding: "0 14px", color: BRASS, borderColor: BRASS, cursor: closing ? "wait" : "pointer" }}>
              {closing ? "Closing…" : "Close month"}
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="More invoicing actions" style={{ ...control, width: "36px", justifyContent: "center" }}>
                <MoreHorizontal style={{ width: "18px", height: "18px" }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[260px] p-1">
              <DropdownMenuItem className={item} onSelect={() => setDetails((v) => !v)}>Month details</DropdownMenuItem>
              <DropdownMenuItem className={item} onSelect={() => onToggleProfit?.()}>Profit &amp; cost details</DropdownMenuItem>
              <DropdownMenuItem className={item} disabled={refreshing} onSelect={() => onRefresh()}>
                <span>{refreshing ? "Refreshing…" : jobScoped ? "Reload job" : "Refresh from ProBuild"}</span>
                {synced && <span style={{ color: "#566063" }}>{synced}</span>}
              </DropdownMenuItem>
              <DropdownMenuItem className={item} disabled={exporting} onSelect={() => onExportPdf()}>{exporting ? "Generating…" : "Export ready lines (PDF)"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {details && (
          <div className="flex flex-wrap items-start justify-between gap-4 text-[14px]" style={{ padding: "4px 20px 16px", color: "#C3CBCC", borderTop: "1px solid rgba(242,238,232,.18)" }}>
            <dl className="grid gap-x-6 gap-y-1 pt-3" style={{ gridTemplateColumns: "auto 1fr" }}>
              {isCurrent && <><dt>Month closes</dt><dd style={{ color: TITLE }}>in {daysLeft} {daysLeft === 1 ? "day" : "days"}</dd></>}
              <dt>Snapshot</dt>
              <dd style={{ color: TITLE }}>{monthClosed ? `Closed ${new Date(monthClosed.closed_at).toLocaleString()} by ${monthClosed.closed_by} · ${fmtMoney(monthClosed.invoiced_subtotal ?? monthClosed.total_fee)} invoiced (${monthClosed.invoiced_line_count ?? monthClosed.line_count} lines)` : "Not closed yet"}</dd>
              {probuildStatus && !probuildStatus.error && <>
                <dt>ProBuild team</dt><dd style={{ color: TITLE }}>{probuildStatus.team_id || "—"}</dd>
                <dt>Last ProBuild sync</dt><dd style={{ color: TITLE }}>{probuildStatus.last_exchanged_at ? new Date(probuildStatus.last_exchanged_at).toLocaleString() : "never"}</dd>
                <dt>Last report audit</dt><dd style={{ color: TITLE }}>{probuildStatus.last_audit_at ? new Date(probuildStatus.last_audit_at).toLocaleString() : "never"}</dd>
              </>}
            </dl>
            <button onClick={() => setDetails(false)} aria-label="Close month details" style={{ ...control, width: "36px", justifyContent: "center", marginTop: "8px" }}><X style={{ width: "16px", height: "16px" }} /></button>
          </div>
        )}

        {(syncMessage || loadError) && (
          <div style={{ padding: "0 20px 14px" }}>
            {loadError && <p role="alert" className="text-[14px]" style={{ color: "#F1B9B3" }}>{loadError}</p>}
            {syncMessage && !loadError && <p role="status" className="text-[14px]" style={{ color: "#C3CBCC" }}>{syncMessage}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
