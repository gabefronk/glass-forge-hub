import { Search, ChevronDown } from "lucide-react";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "needs_review", label: "Needs review" },
  { key: "needs_report", label: "Needs a report" },
  { key: "billed", label: "Billed" },
];

export default function InvoiceToolbar({ search, onSearchChange, searchRef, view, onViewChange, filter, onFilterChange, filterCounts, sort, onSortChange, hideZeros, onHideZerosChange, lineCount, readyCount, onSelectAllReady }) {
  return (
    <div className="flex flex-wrap items-center gap-1" style={{ minHeight: "48px", padding: "5px 16px", borderBottom: "1px solid var(--gf-hairline)" }}>
      {/* Search */}
      <div className="relative w-full sm:w-auto" style={{ flexShrink: 0, maxWidth: "300px" }}>
        <Search style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", width: "16px", height: "16px", color: "var(--gf-placeholder)", pointerEvents: "none" }} strokeWidth={1.8} strokeLinecap="round" />
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search lines and jobs"
          aria-label="Search lines and jobs"
          style={{ width: "100%", minWidth: 0, height: "36px", borderRadius: "var(--r-control)", backgroundColor: "var(--gf-field)", border: "1px solid var(--gf-border)", color: "var(--gf-ink)", fontSize: "13px", fontFamily: "var(--font-body)", paddingLeft: "36px", paddingRight: "40px", outline: "none" }}
        />
        <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--gf-placeholder)", border: "1px solid var(--gf-border)", borderRadius: "4px", padding: "1px 4px", pointerEvents: "none" }}>⌘K</span>
      </div>

      {/* Hairline divider */}
      <div className="hidden sm:block" style={{ width: "1px", height: "24px", backgroundColor: "var(--gf-hairline)", flexShrink: 0 }} />

      {/* Filter chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto inv-toolbar-scroll" style={{ flex: "1 1 auto", minWidth: 0 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              style={{
                height: "30px",
                padding: "0 12px",
                borderRadius: "7px",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: 500,
                backgroundColor: active ? "var(--gf-ink)" : "transparent",
                color: active ? "#F4F1EA" : "var(--gf-ink-2)",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "var(--gf-field)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              {f.label}
              <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", fontWeight: 600, color: active ? "var(--gf-brass-300)" : "inherit" }}>{filterCounts[f.key] || 0}</span>
            </button>
          );
        })}
      </div>

      {/* Right group */}
      <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
        {/* Lines / Jobs segmented toggle */}
        <div style={{ display: "inline-flex", backgroundColor: "var(--gf-field)", borderRadius: "var(--r-control)", padding: "3px", flexShrink: 0, border: "1px solid var(--gf-border)" }}>
          {["lines", "jobs"].map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              style={{
                padding: "5px 14px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: 600,
                backgroundColor: view === v ? "var(--gf-card)" : "transparent",
                color: view === v ? "var(--gf-ink)" : "var(--gf-ink-2)",
                whiteSpace: "nowrap",
                textTransform: "capitalize",
                boxShadow: view === v ? "var(--shadow-control)" : "none",
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Hide $0 switch */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <button
            onClick={onHideZerosChange}
            role="switch"
            aria-label="Hide zero dollar lines"
            aria-checked={hideZeros}
            style={{ width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-control)", border: "none", cursor: "pointer", backgroundColor: "transparent", flexShrink: 0 }}
          >
            <span aria-hidden="true" style={{ position: "relative", width: "32px", height: "18px", borderRadius: "99px", backgroundColor: hideZeros ? "var(--gf-teal-600)" : "var(--gf-check)", transition: "background-color .2s" }}>
              <span style={{ position: "absolute", top: "2px", left: hideZeros ? "16px" : "2px", width: "14px", height: "14px", borderRadius: "99px", backgroundColor: "#fff", transition: "left .2s" }} />
            </span>
          </button>
          <span className="hidden md:inline" style={{ fontSize: "13px", color: "var(--gf-ink-2)", whiteSpace: "nowrap" }}>Hide $0</span>
        </div>

        {/* Sort toggle */}
        <button
          onClick={() => onSortChange(sort === "date" ? "fee" : "date")}
          className="inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:bg-[var(--gf-field)]"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--gf-ink-2)",
            border: "1px solid var(--gf-border)",
            borderRadius: "var(--r-control)",
            padding: "6px 12px",
            cursor: "pointer",
            backgroundColor: "var(--gf-card)",
            flexShrink: 0,
          }}
        >
          {sort === "date" ? "Date" : "Fee"}
          <ChevronDown style={{ width: "14px", height: "14px" }} strokeWidth={1.8} strokeLinecap="round" />
        </button>

        {/* Line count */}
        <span className="hidden lg:inline" style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--gf-ink-3)", whiteSpace: "nowrap" }}>{lineCount} lines</span>

        {/* Select ready — bulk action */}
        <button
          onClick={onSelectAllReady}
          className="whitespace-nowrap transition-opacity"
          style={{ fontSize: "13px", fontWeight: 600, borderRadius: "var(--r-button)", padding: "6px 14px", backgroundColor: "var(--gf-teal-600)", border: "none", color: "#F4F1EA", cursor: "pointer", flexShrink: 0 }}
        >
          Select ready{readyCount > 0 ? ` (${readyCount})` : ""}
        </button>
      </div>
    </div>
  );
}