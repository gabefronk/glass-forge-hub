const FILTERS = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "needs_review", label: "Needs review" },
  { key: "needs_report", label: "Needs a report" },
  { key: "billed", label: "Billed" },
];

export default function InvoiceToolbar({ view, onViewChange, filter, onFilterChange, filterCounts, sort, onSortChange, hideZeros, onHideZerosChange, lineCount, readyCount, onSelectAllReady }) {
  return (
    <div className="min-w-0" style={{ display: "flex", alignItems: "center", gap: "12px", paddingBottom: "12px", borderBottom: "1px solid #DDE0DA", flexWrap: "wrap" }}>
      {/* Lines / Jobs segmented toggle */}
      <div style={{ display: "inline-flex", backgroundColor: "#F0F1ED", borderRadius: "8px", padding: "3px", flexShrink: 0, border: "1px solid #DDE0DA" }}>
        {["lines", "jobs"].map((v) => (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            style={{
              padding: "6px 16px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              fontFamily: "'Archivo',sans-serif",
              fontSize: "13px",
              fontWeight: 600,
              backgroundColor: view === v ? "#FFFFFF" : "transparent",
              color: view === v ? "#182422" : "#53615B",
              whiteSpace: "nowrap",
              textTransform: "capitalize",
              boxShadow: view === v ? "0 1px 2px rgba(24,36,34,.06)" : "none",
            }}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex min-w-0 flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const isWarning = f.key === "needs_report";
          const isReview = f.key === "needs_review";
          const isReady = f.key === "ready";
          const isBilled = f.key === "billed";
          const activeBg = isWarning ? "#FCEDEC" : isReview ? "#FFF3DF" : isReady ? "#EAF5EE" : isBilled ? "#F0F1ED" : "#E6F0EC";
          const activeText = isWarning ? "#A43432" : isReview ? "#89511A" : isReady ? "#166447" : isBilled ? "#53615B" : "#104E44";
          const activeBorder = isWarning ? "#F0C9C5" : isReview ? "#F0DBA8" : isReady ? "#C7E4D2" : isBilled ? "#DDE0DA" : "#C7E4D2";
          return (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              style={{
                padding: "6px 12px",
                borderRadius: "99px",
                border: active ? `1px solid ${activeBorder}` : "1px solid #DDE0DA",
                cursor: "pointer",
                fontFamily: "'Archivo',sans-serif",
                fontSize: "13px",
                fontWeight: 500,
                backgroundColor: active ? activeBg : "#FFFFFF",
                color: active ? activeText : "#53615B",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {f.label}
              <span style={{ fontFamily: "'Archivo',sans-serif", fontSize: "11px", fontWeight: 600 }}>{filterCounts[f.key] || 0}</span>
            </button>
          );
        })}
      </div>

      <div style={{ flex: "1 1 0%", minWidth: 0 }} />

      {/* Sort toggle */}
      <button
        onClick={() => onSortChange(sort === "date" ? "fee" : "date")}
        style={{
          fontFamily: "'Archivo',sans-serif",
          fontSize: "12px",
          fontWeight: 600,
          color: "#53615B",
          border: "1px solid #DDE0DA",
          borderRadius: "99px",
          padding: "6px 12px",
          cursor: "pointer",
          backgroundColor: "#FFFFFF",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        Sort: {sort === "date" ? "date" : "fee ↓"}
      </button>

      {/* Hide $0 switch */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        <button
          onClick={onHideZerosChange}
          role="switch"
          aria-label="Hide zero dollar lines"
          aria-checked={hideZeros}
          style={{ width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "8px", border: "none", cursor: "pointer", backgroundColor: "transparent", flexShrink: 0 }}
        >
          <span aria-hidden="true" style={{ position: "relative", width: "34px", height: "19px", borderRadius: "99px", backgroundColor: hideZeros ? "#146556" : "#DDE0DA", transition: "background-color .2s" }}>
            <span style={{ position: "absolute", top: "2px", left: hideZeros ? "17px" : "2px", width: "15px", height: "15px", borderRadius: "99px", backgroundColor: "#fff", transition: "left .2s" }} />
          </span>
        </button>
        <span style={{ fontSize: "13px", color: "#53615B", whiteSpace: "nowrap" }}>Hide $0</span>
        <span className="max-[699px]:hidden" style={{ fontFamily: "'Archivo',sans-serif", fontSize: "12px", color: "#53615B", whiteSpace: "nowrap" }}>{lineCount} lines</span>
      </div>

      {/* Select ready — bulk action with list controls */}
      <button
        onClick={onSelectAllReady}
        className="text-[13px] font-semibold rounded-full px-3.5 py-2 whitespace-nowrap"
        style={{ backgroundColor: "#146556", border: "1px solid #104E44", color: "#FFFFFF", cursor: "pointer", flexShrink: 0 }}
      >
        Select ready{readyCount > 0 ? ` (${readyCount})` : ""}
      </button>
    </div>
  );
}