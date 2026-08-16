import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { C, workType, billingTier } from "@/lib/feeUI";
import { cn } from "@/lib/utils";

const LEGEND_ITEMS = [
  { key: "install", label: "Install labor", dot: C.tagBillable.bg, border: C.accent },
  { key: "service", label: "Service labor", dot: C.tagCal.bg, border: C.tagCal.text },
  { key: "zero", label: "Zero $", dot: C.tagNoCharge.bg, border: C.tagNoCharge.text },
  { key: "split", label: "Profit Split", dot: C.tagSplit.bg, border: "#f59e0b" },
  { key: "gabe", label: "Gabe", dot: C.tagCal.bg, border: C.tagCal.text },
  { key: "mine", label: "Mine", dot: C.tagBillable.bg, border: C.accent },
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
    <div className="px-4 sm:px-8 pt-4">
      {/* Main toolbar row */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* Segmented control */}
        <div className="flex items-center rounded-lg p-0.5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
          {["all", "unpaid", "uninvoiced"].map((f) => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors whitespace-nowrap"
              style={
                filter === f
                  ? { backgroundColor: C.accentDark, color: "#eef2f0" }
                  : { color: C.text, opacity: 0.68 }
              }
            >
              {f === "all" ? "All" : f === "unpaid" ? "Unpaid" : "Uninvoiced"}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-6 w-px" style={{ backgroundColor: C.border }} />

        {/* Legend chips */}
        <div className="flex flex-wrap items-center gap-2">
          {counts.map((item) => {
            const active = legendFilter === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onLegendFilterChange(active ? null : item.key)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap"
                style={
                  active
                    ? { borderColor: C.accent, backgroundColor: C.accent12, color: C.accentText }
                    : { borderColor: C.border, backgroundColor: "transparent", color: C.text, opacity: 0.72 }
                }
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.dot, border: `1px solid ${item.border}` }} />
                {item.label}
                <span className="tabular-nums font-semibold" style={{ opacity: 0.8 }}>{item.count}</span>
              </button>
            );
          })}
        </div>

        {/* Right: add split */}
        <div className="ml-auto">
          {onAddSplit && (
            <Button size="sm" variant="outline" onClick={onAddSplit} style={{ borderColor: C.border }}>
              <Plus className="h-4 w-4 mr-1" /> Add profit-split job
            </Button>
          )}
        </div>
      </div>

      {/* Bulk selection bar */}
      {selectedCount > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-lg mb-3"
          style={{ backgroundColor: C.accentDark, color: "#eef2f0" }}
        >
          <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
            {selectedCount} line{selectedCount === 1 ? "" : "s"} selected
          </span>
          <div className="h-4 w-px" style={{ backgroundColor: "#3a4a47" }} />
          <BulkBtn label="Mark billed" onClick={() => onBulkSetSelected("billed_to_bfs", true)} />
          <BulkBtn label="Mark paid" onClick={() => onBulkSetSelected("paid_to_ya", true)} />
          <BulkBtn label="Mark invoiced" onClick={() => onBulkSetSelected("invoiced_to_ya", true)} />
          <button
            onClick={onClearSelection}
            className="text-xs font-medium uppercase tracking-wide whitespace-nowrap transition-opacity hover:opacity-100"
            style={{ opacity: 0.7, marginLeft: "auto" }}
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
      className="text-xs font-medium uppercase tracking-wide whitespace-nowrap transition-opacity hover:opacity-100"
      style={{ opacity: 0.85 }}
    >
      {label}
    </button>
  );
}