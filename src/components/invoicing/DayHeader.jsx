import { formatMoney } from "@/lib/feeMath";

export default function DayHeader({ date, lineCount, dayFee, isLargest, allSelected, onSelectDay }) {
  const d = new Date(date + "T00:00:00");
  const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();

  return (
    <div
      style={{
        marginTop: "26px",
        marginBottom: "8px",
        position: "sticky",
        top: "68px",
        zIndex: 20,
        backgroundColor: "#050606",
      }}
    >
      <div
        style={{
          height: "46px",
          borderRadius: "12px",
          backgroundColor: "#171B1A",
          border: "1px solid rgba(255,255,255,.10)",
          boxShadow: "inset 3px 0 0 #6EE7C0, 0 14px 26px -16px rgba(0,0,0,.9)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: "12px",
        }}
      >
        <span
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: ".14em",
            color: "#fff",
            whiteSpace: "nowrap",
          }}
        >
          {dateLabel}
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "11px",
            color: "rgba(255,255,255,.36)",
            whiteSpace: "nowrap",
          }}
        >
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
        <button
          onClick={onSelectDay}
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: ".05em",
            padding: "4px 10px",
            borderRadius: "99px",
            border: "none",
            cursor: "pointer",
            backgroundColor: allSelected ? "rgba(110,231,192,.14)" : "rgba(255,255,255,.06)",
            color: allSelected ? "#6EE7C0" : "rgba(255,255,255,.5)",
            whiteSpace: "nowrap",
          }}
        >
          {allSelected ? "Deselect day" : "Select day"}
        </button>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "10px",
            letterSpacing: ".15em",
            color: "rgba(255,255,255,.34)",
            whiteSpace: "nowrap",
          }}
        >
          DAY FEE
        </span>
        <span
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "14.5px",
            fontWeight: 600,
            color: isLargest ? "#6EE7C0" : "rgba(255,255,255,.6)",
            whiteSpace: "nowrap",
          }}
        >
          ${formatMoney(dayFee)}
        </span>
      </div>
    </div>
  );
}