import { Search } from "lucide-react";

// One control per choice (Oct 24): Show, View and Sort are dropdowns instead of rows
// of buttons. Show uses the same buckets as the money bar (invoiceMoneyBar.js), so a
// filter's count always matches the lines it lists.
const SHOW = [
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

const selectStyle = { height: "34px", borderRadius: "var(--r-control)", border: "1px solid var(--gf-check)", backgroundColor: "var(--gf-card)", color: "var(--gf-ink)", fontSize: "13px", fontWeight: 600, padding: "0 28px 0 10px", cursor: "pointer" };

function Dropdown({ label, value, onChange, children, width }) {
  return (
    <label className="inline-flex items-center gap-1.5" style={{ flexShrink: 0 }}>
      <span className="text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: "var(--gf-ink-3)" }}>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width }}>{children}</select>
    </label>
  );
}

export default function InvoiceToolbar({ search, onSearchChange, searchRef, view, onViewChange, filter, onFilterChange, filterCounts, sort, onSortChange, lineCount, readyCount, onSelectAllReady, invoicesMode = false }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" style={{ minHeight: "52px", padding: "8px 16px", borderBottom: "2px solid var(--gf-ink-4)", backgroundColor: "#F3EEE4" }}>
      <div className="relative w-full sm:w-auto" style={{ flexShrink: 0, maxWidth: "280px" }}>
        <Search style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", width: "15px", height: "15px", color: "var(--gf-placeholder)", pointerEvents: "none" }} strokeWidth={1.8} strokeLinecap="round" />
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search lines and jobs"
          aria-label="Search lines and jobs"
          style={{ width: "100%", minWidth: 0, height: "34px", borderRadius: "var(--r-control)", backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-check)", color: "var(--gf-ink)", fontSize: "13px", fontFamily: "var(--font-body)", paddingLeft: "33px", paddingRight: "38px", outline: "none" }}
        />
        <span style={{ position: "absolute", right: "9px", top: "50%", transform: "translateY(-50%)", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--gf-placeholder)", border: "1px solid var(--gf-check)", borderRadius: "4px", padding: "1px 4px", pointerEvents: "none" }}>⌘K</span>
      </div>

      {!invoicesMode && (
        <Dropdown label="Show" value={filter} onChange={onFilterChange}>
          {SHOW.map((f) => <option key={f.key} value={f.key}>{f.label} ({filterCounts[f.key] || 0})</option>)}
        </Dropdown>
      )}

      <Dropdown label="View" value={view} onChange={onViewChange}>
        {VIEWS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
      </Dropdown>

      {!invoicesMode && (
        <Dropdown label="Sort" value={sort} onChange={onSortChange}>
          <option value="date">Date</option>
          <option value="fee">Fee</option>
        </Dropdown>
      )}

      <span style={{ flex: "1 1 auto" }} />

      {!invoicesMode && (<>
        <span className="hidden lg:inline" style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--gf-ink-3)", whiteSpace: "nowrap" }}>{lineCount} lines</span>
        <button
          onClick={onSelectAllReady}
          disabled={!readyCount}
          className="whitespace-nowrap disabled:opacity-50"
          style={{ fontSize: "13px", fontWeight: 600, borderRadius: "var(--r-button)", padding: "7px 14px", backgroundColor: "var(--gf-teal-600)", border: "none", color: "#F4F1EA", cursor: "pointer", flexShrink: 0 }}
        >
          Select ready{readyCount > 0 ? ` (${readyCount})` : ""}
        </button>
      </>)}
    </div>
  );
}
