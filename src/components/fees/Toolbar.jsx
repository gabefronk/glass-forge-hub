import { Plus } from "lucide-react";
import { C, workType, billingTier } from "@/lib/feeUI";

const LEGEND_ITEMS = [
  { key: "install", label: "Install" },
  { key: "service", label: "Service" },
  { key: "zero", label: "Zero $" },
  { key: "split", label: "Profit split" },
  { key: "gabe", label: "Gabe" },
  { key: "mine", label: "Mine" },
];

function matchesLegend(row, key) {
  switch (key) {
    case "install": return workType(row) === "install";
    case "service": return workType(row) === "service";
    case "zero": return workType(row) === "zero";
    case "split": return row.fee_type === "profit_split";
    case "gabe": return billingTier(row) === "gabe";
    case "mine": return billingTier(row) === "mine";
    default: return true;
  }
}

export default function Toolbar({ filter, onFilterChange, legendFilter, onLegendFilterChange,
  rows, selectedCount, onClearSelection, onBulkSetSelected, onAddSplit }) {

  const counts = LEGEND_ITEMS.map((item) => ({
    ...item,
    count: rows.filter((r) => matchesLegend(r, item.key)).length,
  })).filter((item) => item.count > 0);

  return (
    <div className="px-[26px] max-[699px]:px-[18px] pt-4">
      {/* Filter row */}
      <div className="flex items-center gap-3 mb-3 overflow-x-auto obsidian-scroll" style={{ scrollbarWidth: "none" }}>
        {/* Main filters */}
        <div className="flex items-center gap-1.5 shrink-0">
          {["all", "unpaid", "uninvoiced"].map((f) => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className="px-3 py-1.5 rounded-full text-[12px] font-medium capitalize whitespace-nowrap transition-colors"
              style={
                filter === f
                  ? { backgroundColor: C.accent, color: C.accentDark }
                  : { backgroundColor: "rgba(255,255,255,.06)", border: `1px solid ${C.border}`, color: C.textSecondary }
              }
            >
              {f === "all" ? "All" : f === "unpaid" ? "Unpaid" : "Uninvoiced"}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-5 w-px shrink-0" style={{ backgroundColor: C.border }} />

        {/* Legend chips */}
        <div className="flex items-center gap-1.5 shrink-0">
          {counts.map((item) => {
            const active = legendFilter === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onLegendFilterChange(active ? null : item.key)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors"
                style={
                  active
                    ? { backgroundColor: C.accent18, color: C.accent }
                    : { backgroundColor: "rgba(255,255,255,.06)", border: `1px solid ${C.border}`, color: C.textSecondary }
                }
              >
                {item.label}
                <span className="font-mono-num text-[11px]" style={{ opacity: 0.7 }}>{item.count}</span>
              </button>
            );
          })}
        </div>

        {/* Line count */}
        <span className="ml-auto font-mono-num text-[12px] whitespace-nowrap shrink-0" style={{ color: C.textMuted }}>
          {rows.length} lines
        </span>
      </div>

      {/* Bulk selection bar */}
      {selectedCount > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-[12px] mb-3"
          style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.border}` }}
        >
          <span className="font-mono-num text-[13px] font-semibold whitespace-nowrap" style={{ color: C.accent }}>
            {selectedCount} selected
          </span>
          <div className="h-4 w-px" style={{ backgroundColor: C.border }} />
          <BulkBtn label="Mark billed" onClick={() => onBulkSetSelected("billed_to_bfs", true)} />
          <BulkBtn label="Mark paid" onClick={() => onBulkSetSelected("paid_to_ya", true)} />
          <BulkBtn label="Mark invoiced" onClick={() => onBulkSetSelected("invoiced_to_ya", true)} />
          <button
            onClick={onClearSelection}
            className="text-[12px] font-medium whitespace-nowrap transition-opacity hover:opacity-100 ml-auto"
            style={{ color: C.textMuted, opacity: 0.7 }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function BulkBtn({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-[12px] font-medium whitespace-nowrap transition-colors hover:text-white"
      style={{ color: C.textSecondary }}
    >
      {label}
    </button>
  );
}