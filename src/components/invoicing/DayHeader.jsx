import { formatMoney } from "@/lib/feeMath";

export default function DayHeader({ date, lineCount, dayFee, isLargest, allSelected, onSelectDay }) {
  const d = new Date(date + "T00:00:00");
  const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div style={{ marginTop: "16px", marginBottom: "4px", backgroundColor: "transparent" }}>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg"
        style={{
          minHeight: "32px", padding: "6px 10px",
          backgroundColor: "#F8F9F6", border: "1px solid #DDE0DA",
          boxShadow: "inset 3px 0 0 #146556",
        }}
      >
        <span className="text-[12px] font-semibold" style={{ color: "#182422", whiteSpace: "nowrap" }}>
          {dateLabel}
        </span>
        <span className="text-[11px]" style={{ color: "#53615B", whiteSpace: "nowrap" }}>
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
        <button
          onClick={onSelectDay}
          className="text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap"
          style={{ border: allSelected ? "1px solid #C7E4D2" : "1px solid #DDE0DA", backgroundColor: allSelected ? "#EAF5EE" : "#FFFFFF", color: allSelected ? "#166447" : "#53615B", cursor: "pointer" }}
        >
          {allSelected ? "Deselect" : "Select day"}
        </button>
        <div style={{ flex: "1 1 0%", minWidth: 0 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap" }}>
          <span className="text-[10px]" style={{ color: "#53615B" }}>Day fee</span>
          <span className="font-mono-num-bold text-[13px]" style={{ color: isLargest ? "#166447" : "#53615B" }}>
            ${formatMoney(dayFee)}
          </span>
        </div>
      </div>
    </div>
  );
}