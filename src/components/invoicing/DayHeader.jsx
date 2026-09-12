import { formatMoney } from "@/lib/feeMath";

export default function DayHeader({ date, lineCount, dayFee, isLargest, allSelected, onSelectDay }) {
  const d = new Date(date + "T00:00:00");
  const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div
      className="flex items-center"
      style={{
        marginTop: "4px",
        height: "36px",
        backgroundColor: "var(--gf-card-band)",
        borderTop: "1px solid var(--gf-hairline)",
        borderBottom: "1px solid var(--gf-hairline)",
        padding: "0 16px",
        gap: "12px",
      }}
    >
      <span className="text-[12.5px] font-semibold" style={{ color: "var(--gf-ink)", whiteSpace: "nowrap" }}>
        {dateLabel}
      </span>
      <span className="text-[12px]" style={{ color: "var(--gf-ink-3)", whiteSpace: "nowrap" }}>
        {lineCount} {lineCount === 1 ? "line" : "lines"}
      </span>
      <button
        onClick={onSelectDay}
        className="text-[11px] font-medium hover:underline"
        style={{ color: allSelected ? "var(--gf-teal-600)" : "var(--gf-ink-3)", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", padding: 0 }}
      >
        {allSelected ? "Deselect" : "Select day"}
      </button>
      <div style={{ flex: "1 1 0%", minWidth: 0 }} />
      <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100px", justifyContent: "flex-end", whiteSpace: "nowrap" }}>
        <span className="text-[11.5px]" style={{ color: "var(--gf-ink-3)" }}>Day fee</span>
        <span className="text-[12.5px] font-semibold font-mono-num" style={{ color: isLargest ? "var(--gf-teal-600)" : "var(--gf-ink)" }}>
          ${formatMoney(dayFee)}
        </span>
      </div>
    </div>
  );
}