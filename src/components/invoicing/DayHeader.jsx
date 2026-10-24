import { formatMoney } from "@/lib/feeMath";
import { GRID_CLASS, WIDE_ONLY, CheckBox } from "./LineRow";

// Day subtotal row (shown when the grid is sorted by date): the day, its line count, and
// its labor and fee under the Labor and Fee columns. The checkbox selects the day.
const BAND = "#F3EEE4";

export default function DayHeader({ date, lineCount, dayLabor, dayFee, selection, onSelectDay, showStatus }) {
  const d = new Date(date + "T00:00:00");
  const dateLabel = Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const lines = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
  const band = { backgroundColor: BAND, borderBottom: "1px solid #D6CCBA" };
  const box = <CheckBox state={selection} onClick={onSelectDay} label={selection === "all" ? `Clear ${dateLabel}` : `Select every line on ${dateLabel}`} />;
  return (
    <>
      <div role="row" className={`hidden items-center ${GRID_CLASS}`} style={{ ...band, minHeight: "36px" }}>
        {box}
        <span className="whitespace-nowrap text-[14px] font-semibold" style={{ padding: "0 10px", color: "#101617", gridColumn: "span 2" }}>
          {dateLabel} <span className="font-normal" style={{ color: "#566063" }}>· {lines}</span>
        </span>
        <span className={WIDE_ONLY} />
        <span className={WIDE_ONLY} />
        <span className="font-mono-num-bold text-right text-[14px]" style={{ padding: "0 10px", color: "#101617" }}>${formatMoney(dayLabor)}</span>
        <span className="font-mono-num-bold text-right text-[14px] font-bold" style={{ padding: "0 10px", color: "#101617" }}>${formatMoney(dayFee)}</span>
        {showStatus && <span />}
      </div>
      <div className="flex items-center gap-2 md:hidden" style={{ ...band, minHeight: "40px", paddingRight: "12px" }}>
        {box}
        <span className="text-[14px] font-semibold" style={{ color: "#101617" }}>{dateLabel}</span>
        <span className="text-[14px]" style={{ color: "#566063" }}>{lines}</span>
        <span style={{ flex: "1 1 0%" }} />
        <span className="font-mono-num-bold text-[14px] font-bold" style={{ color: "#101617" }}>${formatMoney(dayFee)}</span>
      </div>
    </>
  );
}
