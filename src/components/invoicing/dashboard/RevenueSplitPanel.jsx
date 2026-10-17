import { formatMoney } from "@/lib/feeMath";

// Revenue split panel: Glass Forge share vs each billing channel's share, with
// ratio terms from the lines' own fee math. Worth-a-look, split-by-job and
// partner-statement actions mirror the target layout.
export default function RevenueSplitPanel({ split, rangeLabel, includeDrafts, onIncludeDraftsChange, manuallyAdjusted, onReview, onViewSplitByJob, onPartnerStatements }) {
  return (
    <div className="rounded-[12px] px-5 py-4" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-bold" style={{ color: "var(--gf-ink)" }}>Revenue split</h2>
        <span className="text-[11.5px]" style={{ color: "var(--gf-ink-3)" }}>{rangeLabel}</span>
      </div>
      <p className="m-0 mt-0.5 text-[12.5px]" style={{ color: "var(--gf-ink-3)" }}>Glass Forge share by billing channel</p>

      {split.channels.length === 0 ? (
        <p className="m-0 mt-3 text-[13px]" style={{ color: "var(--gf-ink-3)" }}>No billing lines in this range.</p>
      ) : (
        <div className="mt-3">
          {split.channels.map((c) => {
            const total = c.gfFee + c.other;
            const gfPct = total > 0 ? Math.max(2, Math.round((c.gfFee / total) * 100)) : 0;
            return (
              <div key={c.key} className="py-2.5" style={{ borderTop: "1px solid var(--gf-hairline)" }}>
                <div className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-semibold" style={{ color: "var(--gf-ink)" }}>{c.label}</span>
                  <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>{c.terms}</span>
                  <div style={{ flex: "1 1 auto" }} />
                  <span className="text-[13.5px] font-semibold tabular-nums" style={{ color: "var(--gf-ink)" }}>${formatMoney(c.gfFee)}</span>
                </div>
                <div className="mt-1.5 flex h-[6px] overflow-hidden rounded-full" style={{ backgroundColor: "var(--gf-field)" }}>
                  <div style={{ width: `${gfPct}%`, backgroundColor: "var(--gf-teal-600)" }} />
                </div>
                <div className="mt-1 flex items-baseline text-[11.5px]" style={{ color: "var(--gf-ink-3)" }}>
                  <span>Glass Forge ${formatMoney(c.gfFee)}</span>
                  <div style={{ flex: "1 1 auto" }} />
                  <span>{c.label} ${formatMoney(c.other)}</span>
                </div>
              </div>
            );
          })}
          <div className="flex items-baseline pt-2.5" style={{ borderTop: "1px solid var(--gf-border)" }}>
            <span className="text-[13.5px] font-bold" style={{ color: "var(--gf-ink)" }}>Glass Forge total</span>
            <div style={{ flex: "1 1 auto" }} />
            <span className="text-[15px] font-bold tabular-nums" style={{ color: "var(--gf-ink)" }}>${formatMoney(split.total)}</span>
          </div>
        </div>
      )}

      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px]" style={{ color: "var(--gf-ink-2)" }}>
        <input type="checkbox" checked={includeDrafts} onChange={(e) => onIncludeDraftsChange(e.target.checked)} style={{ accentColor: "var(--gf-teal-700)", width: "14px", height: "14px" }} />
        Include drafts
      </label>

      {manuallyAdjusted > 0 && (
        <div className="mt-3 rounded-[10px] px-3.5 py-2.5" style={{ backgroundColor: "var(--gf-field)" }}>
          <div className="text-[10.5px] font-semibold tracking-[.08em]" style={{ color: "var(--gf-ink-3)" }}>WORTH A LOOK</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-bold" style={{ backgroundColor: "#D9A13B", color: "#fff" }}>{manuallyAdjusted}</span>
            <span className="text-[12.5px]" style={{ color: "var(--gf-ink-2)" }}>Manually adjusted</span>
            <div style={{ flex: "1 1 auto" }} />
            <button onClick={onReview} className="text-[12.5px] font-semibold" style={{ color: "var(--gf-teal-700)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Review</button>
          </div>
        </div>
      )}

      <button
        onClick={onViewSplitByJob}
        className="mt-3 flex w-full items-center justify-between rounded-[10px] px-4 py-2.5 text-[13.5px] font-semibold"
        style={{ backgroundColor: "var(--gf-ink)", color: "#F4F1EA", border: "none", cursor: "pointer" }}
      >
        View split by job
        <span aria-hidden="true">›</span>
      </button>
      <button
        onClick={onPartnerStatements}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13.5px] font-semibold"
        style={{ backgroundColor: "var(--gf-field)", color: "var(--gf-ink-2)", border: "1px solid var(--gf-border)", cursor: "pointer" }}
      >
        <span aria-hidden="true">▤</span>
        Partner statements
      </button>
    </div>
  );
}
