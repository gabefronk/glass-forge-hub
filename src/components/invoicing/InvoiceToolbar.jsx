import { Search, ChevronDown, Check } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

// Toolbar on one line (declutter, Oct 24): search, Show and View. Each dropdown carries its
// label inside the button and Show carries the counts, which use the same buckets as the
// money strip. Sorting moved to the column headers; Select ready moved to the header
// checkbox (Show → Ready, then check it).
export const SHOW = [
  { key: "all", label: "All lines" },
  { key: "ready", label: "Ready to invoice" },
  { key: "needs_review", label: "Needs decision" },
  { key: "zero_confirm", label: "$0 to confirm" },
  { key: "needs_report", label: "Waiting on report" },
  { key: "billed", label: "Billed" },
];
const VIEWS = [
  { key: "lines", label: "Lines" },
  { key: "jobs", label: "By job" },
  { key: "invoices", label: "Invoices" },
];

const button = { height: "36px", borderRadius: "8px", border: "1px solid #9A9080", backgroundColor: "#FFFFFF", color: "#101617", fontSize: "14px", padding: "0 10px 0 12px", display: "inline-flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0 };

function Dropdown({ label, options, value, onChange, counts }) {
  const current = options.find((o) => o.key === value) || options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={`${label}: ${current.label}`} style={button}>
          <span style={{ color: "#566063", fontWeight: 500 }}>{label}</span>
          <span style={{ fontWeight: 600 }}>{current.label}</span>
          {counts && <span className="tabular-nums" style={{ color: "#566063", fontWeight: 500 }}>{counts[current.key] || 0}</span>}
          <ChevronDown style={{ width: "16px", height: "16px", color: "#566063" }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[230px] p-1">
        {options.map((o) => (
          <DropdownMenuItem key={o.key} onSelect={() => onChange(o.key)} className="flex min-h-9 cursor-pointer items-center gap-2 text-[14px]">
            <Check style={{ width: "15px", height: "15px", visibility: o.key === value ? "visible" : "hidden", color: "#0B3F3B" }} />
            <span className="flex-1" style={{ fontWeight: o.key === value ? 600 : 400 }}>{o.label}</span>
            {counts && <span className="tabular-nums" style={{ color: "#566063" }}>{counts[o.key] || 0}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function InvoiceToolbar({ search, onSearchChange, searchRef, view, onViewChange, filter, onFilterChange, filterCounts, invoicesMode = false }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto max-[699px]:flex-wrap" style={{ padding: "12px", borderBottom: "1px solid #D6CCBA" }}>
      <div className="relative max-[699px]:w-full" style={{ flex: "1 1 260px", maxWidth: "440px", minWidth: "200px" }}>
        <Search style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", width: "16px", height: "16px", color: "#6B7276", pointerEvents: "none" }} strokeWidth={1.8} />
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search jobs, POs, work"
          aria-label="Search jobs, POs and work"
          style={{ width: "100%", height: "36px", borderRadius: "8px", backgroundColor: "#F4F1EA", border: "1px solid #9A9080", color: "#101617", fontSize: "14px", fontFamily: "var(--font-body)", paddingLeft: "34px", paddingRight: "10px", outline: "none" }}
        />
      </div>
      {!invoicesMode && <Dropdown label="Show" options={SHOW} value={filter} onChange={onFilterChange} counts={filterCounts} />}
      <Dropdown label="View" options={VIEWS} value={view} onChange={onViewChange} />
    </div>
  );
}
