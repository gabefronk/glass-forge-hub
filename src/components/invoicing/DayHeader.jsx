import { formatMoney } from "@/lib/feeMath";

export default function DayHeader({ date, lineCount, dayFee, isLargest, allSelected, onSelectDay }) {
  const d = new Date(date + "T00:00:00");
  const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div style={{ marginTop: "20px", marginBottom: "6px", backgroundColor: "transparent" }}>
      <div
        className="flex items-center gap-3 rounded-xl"
        style={{
          minHeight: "40px", padding: "8px 12px",
          backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA",
          boxShadow: "inset 3px 0 0 #146556",
        }}
      >
        <span className="text-[13px] font-semibold" style={{ color: "#182422", whiteSpace: "nowrap" }}>
          {dateLabel}
        </span>
        <span className="text-[12px]" style={{ color: "#53615B", whiteSpace: "nowrap" }}>
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
        <button
          onClick={onSelectDay}
          className="text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap"
          style={{ border: allSelected ? "1px solid #C7E4D2" : "1px solid #DDE0DA", backgroundColor: allSelected ? "#EAF5EE" : "#FFFFFF", color: allSelected ? "#166447" : "#53615B", cursor: "pointer" }}
        >
          {allSelected ? "Deselect day" : "Select day"}
        </button>
        <div style={{ flex: 1 }} />
        <span className="text-[11px]" style={{ color: "#53615B", whiteSpace: "nowrap" }}>Day fee</span>
        <span className="font-mono-num-bold text-[14px]" style={{ color: isLargest ? "#166447" : "#53615B", whiteSpace: "nowrap" }}>
          ${formatMoney(dayFee)}
        </span>
      </div>
    </div>
  );
}