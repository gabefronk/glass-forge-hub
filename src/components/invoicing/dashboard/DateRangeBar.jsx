import { DASHBOARD_PRESETS } from "@/lib/invoiceDashboard";

const pill = (active) => ({
  height: "30px",
  padding: "0 12px",
  borderRadius: "7px",
  border: "none",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  fontWeight: 500,
  whiteSpace: "nowrap",
  backgroundColor: active ? "var(--gf-ink)" : "var(--gf-field)",
  color: active ? "#F4F1EA" : "var(--gf-ink-2)",
});

const dateInput = {
  height: "30px",
  borderRadius: "var(--r-control)",
  border: "1px solid var(--gf-border)",
  backgroundColor: "var(--gf-card)",
  color: "var(--gf-ink)",
  fontSize: "12.5px",
  fontFamily: "var(--font-body)",
  padding: "0 8px",
};

// Date filter for the dashboard view. Presets plus an optional custom range;
// the label names the active range so the cards and list always agree.
export default function DateRangeBar({ preset, onPresetChange, customStart, customEnd, onCustomChange, rangeLabel }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[12px] px-4 py-3" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {DASHBOARD_PRESETS.map((p) => (
          <button key={p.key} onClick={() => onPresetChange(p.key)} style={pill(preset === p.key)} aria-pressed={preset === p.key}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-semibold tracking-[.08em]" style={{ color: "var(--gf-ink-3)" }}>CUSTOM</span>
        <input
          type="date"
          aria-label="Start date"
          value={customStart}
          onChange={(e) => { onCustomChange(e.target.value, customEnd); if (e.target.value) onPresetChange("custom"); }}
          style={dateInput}
        />
        <span style={{ color: "var(--gf-ink-3)" }}>–</span>
        <input
          type="date"
          aria-label="End date"
          value={customEnd}
          onChange={(e) => { onCustomChange(customStart, e.target.value); if (e.target.value) onPresetChange("custom"); }}
          style={dateInput}
        />
        {(customStart || customEnd) && (
          <button
            onClick={() => { onCustomChange("", ""); onPresetChange("this_month"); }}
            aria-label="Clear dates"
            style={{ width: "26px", height: "26px", borderRadius: "6px", border: "none", backgroundColor: "transparent", color: "var(--gf-ink-3)", cursor: "pointer", fontSize: "15px", lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>
      <div style={{ flex: "1 1 auto" }} />
      <span className="text-[12.5px] font-semibold" style={{ color: "var(--gf-teal-800)", whiteSpace: "nowrap" }}>{rangeLabel}</span>
    </div>
  );
}
