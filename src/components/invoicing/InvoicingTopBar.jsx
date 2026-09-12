import { Search, ChevronLeft, ChevronRight, Lock } from "lucide-react";
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

export default function InvoicingTopBar({ month, onMonthChange, search, onSearchChange, readyCount, onSelectAllReady, searchRef, onExportPdf, exporting, monthClosed, onCloseMonth, closing }) {
  const [probuildStatus, setProbuildStatus] = useState(null);

  useEffect(() => {
    base44.functions.invoke("probuildStatus", {}).then(res => setProbuildStatus(res.data)).catch(() => {});
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

  return (
    <div
      style={{
        position: "relative",
        zIndex: 30,
        backgroundColor: "rgba(238,241,246,.96)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid #DDE3EC",
      }}
    >
      <div
        className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-4 py-4 sm:px-6 xl:px-10"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", flexShrink: 0 }}>
          <span
            style={{
              fontFamily: "'Archivo',sans-serif",
              fontSize: "9.5px",
              letterSpacing: ".01em",
              color: "#616D81",
              whiteSpace: "nowrap",
            }}
          >
            Invoicing · Monthly close
          </span>
          <span
            style={{
              fontFamily: "'Archivo',sans-serif",
              fontSize: "19px",
              fontWeight: 700,
              color: "#131A26",
              letterSpacing: "-.02em",
              whiteSpace: "nowrap",
            }}
          >
            Invoicing
          </span>
        </div>

        <div className="hidden sm:block" style={{ width: "1px", height: "32px", backgroundColor: "#DDE3EC", flexShrink: 0 }} />

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button
              onClick={() => shift(-1)}
              aria-label="Previous month"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                backgroundColor: "#F6F8FC",
                border: "1px solid #DDE3EC",
                color: "#535E72",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <ChevronLeft style={{ width: "14px", height: "14px" }} />
            </button>
            <span
              style={{
                fontFamily: "'Archivo',sans-serif",
                fontSize: "13.5px",
                fontWeight: 600,
                color: "#131A26",
                minWidth: "112px",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {monthName}
            </span>
            <button
              onClick={() => shift(1)}
              aria-label="Next month"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                backgroundColor: "#F6F8FC",
                border: "1px solid #DDE3EC",
                color: "#535E72",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <ChevronRight style={{ width: "14px", height: "14px" }} />
            </button>
          </div>
          {isCurrent && daysLeft > 0 && (
            <span
              style={{
                fontFamily: "'Archivo',sans-serif",
                fontSize: "9.5px",
                fontWeight: 600,
                letterSpacing: ".01em",
                padding: "3px 8px",
                borderRadius: "99px",
                backgroundColor: "#FCF5E9",
                border: "1px solid #EEDAB4",
                color: "#8A5A10",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              Closes in {daysLeft} days
            </span>
          )}
        </div>

        <div className="hidden xl:block" style={{ flex: 1 }} />

        {probuildStatus && !probuildStatus.error && (
          <div
            className="max-w-full"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "99px",
              backgroundColor: "#F6F8FC",
              border: "1px solid #DDE3EC",
              flexShrink: 0,
            }}
            title={`Probuild team ID: ${probuildStatus.team_id}\nLast token exchange: ${probuildStatus.last_exchanged_at || "never"}\nLast audit run: ${probuildStatus.last_audit_at || "never"}`}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "99px",
                backgroundColor: "#3B82F6",
              }}
            />
            <span
              style={{
                fontFamily: "'Archivo',sans-serif",
                fontSize: "9.5px",
                fontWeight: 500,
                letterSpacing: ".01em",
                color: "#616D81",
                whiteSpace: "nowrap",
              }}
            >
              Probuild · {probuildStatus.team_id?.slice(0, 8)}… · Sync {relativeTime(probuildStatus.last_exchanged_at)}
            </span>
          </div>
        )}

        <button
          onClick={onExportPdf}
          disabled={exporting}
          className="min-h-10"
          style={{
            height: "36px",
            borderRadius: "10px",
            backgroundColor: "#FFFFFF",
            color: "#131A26",
            fontFamily: "'Archivo',sans-serif",
            fontSize: "13px",
            fontWeight: 500,
            padding: "0 14px",
            border: "1px solid #DDE3EC",
            cursor: exporting ? "wait" : "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {exporting ? "Generating\u2026" : "Export PDF"}
        </button>

        {monthClosed ? (
          <div
            className="max-w-full"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "0 12px",
              height: "36px",
              borderRadius: "10px",
              backgroundColor: "#E7EEFA",
              border: "1px solid #C3D4EE",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            title={`Closed ${new Date(monthClosed.closed_at).toLocaleString()}\nBy ${monthClosed.closed_by}\nInvoiced: $${(monthClosed.invoiced_subtotal ?? monthClosed.total_fee)?.toFixed(2)} (${monthClosed.invoiced_line_count ?? monthClosed.line_count} ready)\nEarned: $${monthClosed.earned_total?.toFixed(2)} (${monthClosed.earned_line_count} lines)\nTotal rows: ${monthClosed.total_rows}`}
          >
            <Lock style={{ width: "12px", height: "12px", color: "#1E4A85" }} />
            <span style={{ fontFamily: "'Archivo',sans-serif", fontSize: "10px", fontWeight: 600, letterSpacing: ".01em", color: "#1E4A85" }}>
              Closed · ${(monthClosed.invoiced_subtotal ?? monthClosed.total_fee)?.toFixed(2)}
            </span>
          </div>
        ) : (
          <button
            onClick={onCloseMonth}
            disabled={closing}
            className="min-h-10"
            style={{
              height: "36px",
              borderRadius: "10px",
              backgroundColor: "#FFFFFF",
              color: "#131A26",
              fontFamily: "'Archivo',sans-serif",
              fontSize: "13px",
              fontWeight: 500,
              padding: "0 14px",
              border: "1px solid #DDE3EC",
              cursor: closing ? "wait" : "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {closing ? "Closing\u2026" : "Close month"}
          </button>
        )}

        <div className="relative flex w-full min-w-0 items-center sm:w-auto sm:flex-1 sm:basis-[220px]">
          <Search style={{ position: "absolute", left: "12px", width: "14px", height: "14px", color: "#77839A", pointerEvents: "none" }} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search lines and jobs"
            aria-label="Search lines and jobs"
            style={{
              width: "100%",
              minWidth: 0,
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#FFFFFF",
              border: "1px solid #DDE3EC",
              color: "#131A26",
              fontSize: "13px",
              fontFamily: "'Archivo',sans-serif",
              paddingLeft: "34px",
              paddingRight: "40px",
              outline: "none",
            }}
          />
          <span
            style={{
              position: "absolute",
              right: "10px",
              fontFamily: "'Archivo',sans-serif",
              fontSize: "10px",
              color: "#77839A",
              border: "1px solid #DDE3EC",
              borderRadius: "4px",
              padding: "1px 4px",
              pointerEvents: "none",
            }}
          >
            ⌘K
          </span>
        </div>

        <button
          onClick={onSelectAllReady}
          className="w-full sm:w-auto"
          style={{
            height: "40px",
            borderRadius: "10px",
            backgroundColor: "#2A5EA8",
            color: "#FFFFFF",
            fontFamily: "'Archivo',sans-serif",
            fontSize: "13px",
            fontWeight: 600,
            padding: "0 16px",
            border: "1px solid #1E4A85",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Select all ready{readyCount > 0 ? ` (${readyCount})` : ""}
        </button>
      </div>
    </div>
  );
}