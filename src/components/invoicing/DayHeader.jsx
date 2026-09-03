import { formatMoney } from "@/lib/feeMath";

export default function DayHeader({ date, lineCount, dayFee, isLargest, allSelected, onSelectDay }) {
  const d = new Date(date + "T00:00:00");
  const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div
      style={{
        marginTop: "26px",
        marginBottom: "8px",
        position: "sticky",
        top: "68px",
        zIndex: 20,
        backgroundColor: "#EEF1F6",
      }}
    >
      <div
        className="card-shadow"
        style={{
          height: "46px",
          borderRadius: "14px",
          backgroundColor: "#FFFFFF",
          border: "1px solid #DDE3EC",
          boxShadow: "inset 3px 0 0 #2A5EA8, 0 1px 2px rgba(19,26,38,.05), 0 6px 16px -10px rgba(19,26,38,.14)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: "12px",
        }}
      >
        <span
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: ".01em",
            color: "#131A26",
            whiteSpace: "nowrap",
          }}
        >
          {dateLabel}
        </span>
        <span
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "11px",
            color: "#616D81",
            whiteSpace: "nowrap",
          }}
        >
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
        <button
          onClick={onSelectDay}
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: ".01em",
            padding: "4px 10px",
            borderRadius: "99px",
            border: allSelected ? "1px solid #C3D4EE" : "1px solid #DDE3EC",
            cursor: "pointer",
            backgroundColor: allSelected ? "#E7EEFA" : "#F6F8FC",
            color: allSelected ? "#1E4A85" : "#535E72",
            whiteSpace: "nowrap",
          }}
        >
          {allSelected ? "Deselect day" : "Select day"}
        </button>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "10px",
            letterSpacing: ".01em",
            color: "#616D81",
            whiteSpace: "nowrap",
          }}
        >
          Day fee
        </span>
        <span
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "14.5px",
            fontWeight: 700,
            color: isLargest ? "#1E4A85" : "#535E72",
            whiteSpace: "nowrap",
          }}
        >
          ${formatMoney(dayFee)}
        </span>
      </div>
    </div>
  );
}