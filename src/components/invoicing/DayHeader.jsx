import { Check } from "lucide-react";
import { formatMoney } from "@/lib/feeMath";
import { UNBILLED_GRID, GRID_WIDE } from "@/lib/feeUI";

// Day subtotal row of the Invoicing lines grid: the day, its line count, and its labor
// and fee subtotals under the Labor and Fee columns (groupLines in invoiceGrid.js). The
// checkbox selects or clears the whole day. Same cells as a line row, so the figures
// line up with the columns above them.
const BAND = "#F3EEE4";

export default function DayHeader({ date, lineCount, dayLabor, dayFee, isLargest, allSelected, onSelectDay }) {
  const d = new Date(date + "T00:00:00");
  const dateLabel = Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const lines = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
  const box = (
    <button
      onClick={onSelectDay}
      aria-label={allSelected ? `Clear ${dateLabel}` : `Select every line on ${dateLabel}`}
      title={allSelected ? "Clear this day" : "Select this day"}
      aria-pressed={allSelected}
      style={{ width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", padding: 0 }}
    >
      <span aria-hidden="true" style={{ width: "16px", height: "16px", borderRadius: "4.5px", border: allSelected ? "none" : "1.5px solid var(--gf-check)", backgroundColor: allSelected ? "var(--gf-teal-600)" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {allSelected && <Check style={{ width: "11px", height: "11px", color: "#FFFFFF" }} strokeWidth={3} />}
      </span>
    </button>
  );
  const band = { backgroundColor: BAND, borderTop: "1px solid var(--gf-hairline)", borderBottom: "1px solid var(--gf-hairline)" };
  const feeColor = isLargest ? "var(--gf-teal-800)" : "var(--gf-ink)";

  return (
    <>
      <div role="row" className={`hidden ${UNBILLED_GRID}`} style={{ ...band, minHeight: "30px", padding: "3px 12px" }}>
        {box}
        <span className="whitespace-nowrap text-[12.5px] font-bold" style={{ color: "var(--gf-ink)", gridColumn: "span 2" }}>
          {dateLabel} <span className="font-medium" style={{ color: "var(--gf-placeholder)" }}>· {lines}</span>
        </span>
        <span />
        <span className={GRID_WIDE} />
        <span className={GRID_WIDE} />
        <span className="font-mono-num-bold text-right text-[12.5px]" style={{ color: "var(--gf-ink)" }}>${formatMoney(dayLabor)}</span>
        <span />
        <span className="font-mono-num-bold text-right text-[12.5px]" style={{ color: feeColor }}>${formatMoney(dayFee)}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--gf-placeholder)" }}>Day subtotal</span>
        <span className={GRID_WIDE} />
        <span />
      </div>
      <div className="flex items-center gap-2 md:hidden" style={{ ...band, minHeight: "34px", padding: "2px 10px 2px 11px" }}>
        {box}
        <span className="text-[12.5px] font-bold" style={{ color: "var(--gf-ink)" }}>{dateLabel}</span>
        <span className="text-[12px]" style={{ color: "var(--gf-placeholder)" }}>{lines}</span>
        <span style={{ flex: "1 1 0%" }} />
        <span className="font-mono-num text-[12px]" style={{ color: "var(--gf-ink-2)" }}>${formatMoney(dayLabor)} labor</span>
        <span className="font-mono-num-bold text-[12.5px]" style={{ color: feeColor }}>${formatMoney(dayFee)}</span>
      </div>
    </>
  );
}
