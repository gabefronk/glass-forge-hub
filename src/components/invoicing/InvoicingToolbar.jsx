const FILTERS = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "needs_report", label: "Needs a report" },
  { key: "billed", label: "Billed" },
];

export default function InvoicingToolbar({ view, onViewChange, filter, onFilterChange, filterCounts, sort, onSortChange, hideZeros, onHideZerosChange, lineCount }) {
  return (
    <div
      className="inv-toolbar-scroll max-[699px]:overflow-x-auto"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        paddingBottom: "12px",
        borderBottom: "1px solid rgba(255,255,255,.08)",
        flexWrap: "nowrap",
      }}
    >
      {/* Lines / Jobs segmented toggle */}
      <div style={{ display: "inline-flex", backgroundColor: "rgba(255,255,255,.05)", borderRadius: "99px", padding: "3px", flexShrink: 0 }}>
        {["lines", "jobs"].map((v) => (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            style={{
              padding: "6px 16px",
              borderRadius: "99px",
              border: "none",
              cursor: "pointer",
              fontFamily: "'Inter Tight',sans-serif",
              fontSize: "13px",
              fontWeight: 600,
              backgroundColor: view === v ? "#fff" : "transparent",
              color: view === v ? "#000" : "rgba(255,255,255,.62)",
              whiteSpace: "nowrap",
              textTransform: "capitalize",
            }}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Filter chips */}
      <div className="inv-toolbar-scroll" style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const isCoral = f.key === "needs_report";
          return (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              style={{
                padding: "6px 12px",
                borderRadius: "99px",
                border: "1px solid rgba(255,255,255,.07)",
                cursor: "pointer",
                fontFamily: "'Inter Tight',sans-serif",
                fontSize: "12.5px",
                fontWeight: 500,
                backgroundColor: active ? (isCoral ? "rgba(255,138,122,.14)" : "rgba(255,255,255,.09)") : "transparent",
                color: active ? (isCoral ? "#FF8A7A" : "#fff") : "rgba(255,255,255,.5)",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                whiteSpace: "nowrap",
              }}
            >
              {f.label}
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px" }}>{filterCounts[f.key] || 0}</span>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* Sort toggle */}
      <button
        onClick={() => onSortChange(sort === "date" ? "fee" : "date")}
        style={{
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: ".12em",
          color: "rgba(255,255,255,.5)",
          border: "1px solid rgba(255,255,255,.07)",
          borderRadius: "99px",
          padding: "5px 10px",
          cursor: "pointer",
          backgroundColor: "transparent",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        SORT: {sort === "date" ? "DATE" : "FEE ↓"}
      </button>

      {/* Hide $0 switch */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        <button
          onClick={onHideZerosChange}
          style={{
            width: "34px",
            height: "19px",
            borderRadius: "99px",
            border: "none",
            cursor: "pointer",
            backgroundColor: hideZeros ? "#6EE7C0" : "rgba(255,255,255,.10)",
            position: "relative",
            transition: "background-color .2s",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: "2px",
              left: hideZeros ? "17px" : "2px",
              width: "15px",
              height: "15px",
              borderRadius: "99px",
              backgroundColor: "#fff",
              transition: "left .2s",
            }}
          />
        </button>
        <span
          className="max-[699px]:hidden"
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "11px",
            color: "rgba(255,255,255,.34)",
            whiteSpace: "nowrap",
          }}
        >
          {lineCount} lines
        </span>
      </div>
    </div>
  );
}