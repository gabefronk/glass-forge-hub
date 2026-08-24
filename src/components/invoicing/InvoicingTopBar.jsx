import { Search, ChevronLeft, ChevronRight } from "lucide-react";

export default function InvoicingTopBar({ month, onMonthChange, search, onSearchChange, readyCount, onSelectAllReady, searchRef }) {
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
        position: "sticky",
        top: 0,
        zIndex: 50,
        backgroundColor: "rgba(5,6,6,.96)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255,255,255,.08)",
      }}
    >
      <div
        className="max-[699px]:px-[18px]"
        style={{ maxWidth: "1180px", margin: "0 auto", padding: "0 40px", height: "68px", display: "flex", alignItems: "center", gap: "20px" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          <span
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "9.5px",
              letterSpacing: ".18em",
              color: "rgba(255,255,255,.4)",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Invoicing · Monthly Close
          </span>
          <span
            style={{
              fontFamily: "'Inter Tight',sans-serif",
              fontSize: "19px",
              fontWeight: 600,
              color: "#fff",
              letterSpacing: "-.02em",
              whiteSpace: "nowrap",
            }}
          >
            Invoicing
          </span>
        </div>

        <div style={{ width: "1px", height: "32px", backgroundColor: "rgba(255,255,255,.10)" }} />

        <div className="max-[699px]:hidden" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button
              onClick={() => shift(-1)}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "99px",
                backgroundColor: "rgba(255,255,255,.05)",
                border: "none",
                color: "rgba(255,255,255,.62)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronLeft style={{ width: "14px", height: "14px" }} />
            </button>
            <span
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: "13.5px",
                fontWeight: 500,
                color: "#fff",
                minWidth: "112px",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {monthName}
            </span>
            <button
              onClick={() => shift(1)}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "99px",
                backgroundColor: "rgba(255,255,255,.05)",
                border: "none",
                color: "rgba(255,255,255,.62)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronRight style={{ width: "14px", height: "14px" }} />
            </button>
          </div>
          {isCurrent && daysLeft > 0 && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: "9.5px",
                fontWeight: 600,
                letterSpacing: ".1em",
                padding: "3px 8px",
                borderRadius: "99px",
                backgroundColor: "rgba(255,138,122,.14)",
                color: "#FF8A7A",
                whiteSpace: "nowrap",
              }}
            >
              Closes in {daysLeft} days
            </span>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <div className="max-[699px]:hidden" style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Search style={{ position: "absolute", left: "12px", width: "14px", height: "14px", color: "rgba(255,255,255,.34)", pointerEvents: "none" }} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search lines and jobs"
            style={{
              width: "250px",
              height: "36px",
              borderRadius: "99px",
              backgroundColor: "rgba(255,255,255,.05)",
              border: "1px solid rgba(255,255,255,.07)",
              color: "#fff",
              fontSize: "13px",
              fontFamily: "'Inter Tight',sans-serif",
              paddingLeft: "34px",
              paddingRight: "40px",
              outline: "none",
            }}
          />
          <span
            style={{
              position: "absolute",
              right: "10px",
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "10px",
              color: "rgba(255,255,255,.34)",
              border: "1px solid rgba(255,255,255,.10)",
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
          style={{
            height: "36px",
            borderRadius: "99px",
            backgroundColor: "#6EE7C0",
            color: "#0A0C0C",
            fontFamily: "'Inter Tight',sans-serif",
            fontSize: "13px",
            fontWeight: 600,
            padding: "0 16px",
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: "0 0 0 6px rgba(110,231,192,.08)",
          }}
        >
          Select all ready{readyCount > 0 ? ` (${readyCount})` : ""}
        </button>
      </div>
    </div>
  );
}