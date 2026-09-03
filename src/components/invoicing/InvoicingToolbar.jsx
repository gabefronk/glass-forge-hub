const FILTERS = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "needs_review", label: "Needs review" },
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
        borderBottom: "1px solid #DDE3EC",
        flexWrap: "nowrap",
      }}
    >
      {/* Lines / Jobs segmented toggle */}
      <div style={{ display: "inline-flex", backgroundColor: "#F6F8FC", borderRadius: "10px", padding: "3px", flexShrink: 0, border: "1px solid #DDE3EC" }}>
        {["lines", "jobs"].map((v) => (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            style={{
              padding: "6px 16px",
              borderRadius: "9px",
              border: "none",
              cursor: "pointer",
              fontFamily: "'Archivo',sans-serif",
              fontSize: "13px",
              fontWeight: 600,
              backgroundColor: view === v ? "#FFFFFF" : "transparent",
              color: view === v ? "#131A26" : "#535E72",
              whiteSpace: "nowrap",
              textTransform: "capitalize",
              boxShadow: view === v ? "0 1px 2px rgba(19,26,38,.05)" : "none",
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
          const isWarning = f.key === "needs_report";
          const isReview = f.key === "needs_review";
          return (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              style={{
                padding: "6px 12px",
                borderRadius: "99px",
                border: active
                  ? isWarning
                    ? "1px solid #EFD2CA"
                    : isReview
                    ? "1px solid #EEDAB4"
                    : "1px solid #C3D4EE"
                  : "1px solid #DDE3EC",
                cursor: "pointer",
                fontFamily: "'Archivo',sans-serif",
                fontSize: "12.5px",
                fontWeight: 500,
                backgroundColor: active
                  ? isWarning
                    ? "#FBEDEA"
                    : isReview
                    ? "#FCF5E9"
                    : "#E7EEFA"
                  : "#FFFFFF",
                color: active
                  ? isWarning
                    ? "#8A4038"
                    : isReview
                    ? "#8A5A10"
                    : "#1E4A85"
                  : "#535E72",
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

      <div style={{ flex: 1 }} />

      {/* Sort toggle */}
      <button
        onClick={() => onSortChange(sort === "date" ? "fee" : "date")}
        style={{
          fontFamily: "'Archivo',sans-serif",
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: ".01em",
          color: "#535E72",
          border: "1px solid #DDE3EC",
          borderRadius: "99px",
          padding: "5px 10px",
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
          style={{
            width: "34px",
            height: "19px",
            borderRadius: "99px",
            border: "none",
            cursor: "pointer",
            backgroundColor: hideZeros ? "#2A5EA8" : "#DDE3EC",
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
            fontFamily: "'Archivo',sans-serif",
            fontSize: "11px",
            color: "#616D81",
            whiteSpace: "nowrap",
          }}
        >
          {lineCount} lines
        </span>
      </div>
    </div>
  );
}