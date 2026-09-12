import { formatMoney } from "@/lib/feeMath";

export default function InvoiceSummary({ readyTotal, readyCount, heldTotal, recordedLaborTotal, splitReviewCount, matchBlockedTotal, matchBlockedCount, reportBlockedTotal, reportBlockedCount, noSourceDataCount, billedTotal, billedCount, scheduledTotal, scheduledCount, monthEarnedTotal, monthEarnedCount, onFilterBlocked, onFilterMatchBlocked }) {
  return (
    <div className="rounded-xl" style={{ backgroundColor: "#FFFFFF", border: "1px solid #DDE0DA" }}>
      {/* Headline + labor + notes */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3.5 sm:px-6">
        <div>
          <div className="text-[11px] font-medium mb-0.5" style={{ color: "#53615B", letterSpacing: "0.02em" }}>Recorded fees</div>
          <div className="font-mono-num-bold" style={{ fontSize: "32px", fontWeight: 800, color: "#182422", letterSpacing: "-0.03em", lineHeight: 1 }}>
            ${formatMoney(monthEarnedTotal)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium mb-0.5" style={{ color: "#53615B", letterSpacing: "0.02em" }}>Recorded labor</div>
          <div className="font-mono-num-bold text-[18px]" style={{ color: "#53615B", letterSpacing: "-0.02em" }}>
            ${formatMoney(recordedLaborTotal)}
          </div>
        </div>
        <div className="min-w-0 flex-1 text-[12px] self-end" style={{ color: "#8A958F", lineHeight: 1.5 }}>
          Includes provisional amounts held for review.
          {splitReviewCount > 0 && <span style={{ color: "#89511A" }}> {splitReviewCount} profit-split {splitReviewCount === 1 ? "note" : "notes"} need allocation.</span>}
        </div>
      </div>

      {/* Metric strip: Ready | Held | Billed */}
      <div className="grid grid-cols-3 border-t border-b" style={{ borderColor: "#DDE0DA" }}>
        <MetricCell label="Ready to bill" value={`$${formatMoney(readyTotal)}`} sub={`${readyCount} lines`} tone="ready" />
        <MetricCell label="Held for review" value={`$${formatMoney(heldTotal)}`} sub={`${reportBlockedCount + matchBlockedCount} lines`} tone="held" />
        <MetricCell label="Billed" value={`$${formatMoney(billedTotal)}`} sub={`${billedCount} lines`} tone="billed" last />
      </div>

      {/* Held breakdown — actionable subset links */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 sm:px-6 text-[12px]">
        <span style={{ color: "#8A958F" }}>Held:</span>
        {onFilterBlocked && (
          <button onClick={onFilterBlocked} className="font-medium hover:underline" style={{ color: "#89511A" }}>
            {reportBlockedCount} waiting on reports · ${formatMoney(reportBlockedTotal)}
          </button>
        )}
        {onFilterMatchBlocked && (
          <button onClick={onFilterMatchBlocked} className="font-medium hover:underline" style={{ color: "#89511A" }}>
            {matchBlockedCount} pricing review · ${formatMoney(matchBlockedTotal)}
          </button>
        )}
        {noSourceDataCount > 0 && (
          <span style={{ color: "#A43432" }}>⚠ {noSourceDataCount} missing source data</span>
        )}
      </div>

      {/* Future — divider + scheduled */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 sm:px-6" style={{ borderTop: "1px solid #ECEEEA" }}>
        <span className="text-[11px] font-semibold uppercase" style={{ color: "#8A958F", letterSpacing: "0.06em" }}>Future</span>
        <span className="font-mono-num-bold text-[16px]" style={{ color: "#335E91" }}>${formatMoney(scheduledTotal)}</span>
        <span className="text-[12px]" style={{ color: "#8A958F" }}>{scheduledCount} scheduled · not yet billable</span>
      </div>
    </div>
  );
}

function MetricCell({ label, value, sub, tone, last }) {
  const colors = { ready: "#166447", held: "#89511A", billed: "#53615B" };
  return (
    <div className="px-3 py-2.5" style={{ borderRight: last ? "none" : "1px solid #DDE0DA" }}>
      <div className="text-[11px] font-medium mb-0.5" style={{ color: "#53615B" }}>{label}</div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-mono-num-bold text-[20px]" style={{ color: colors[tone] || colors.billed, letterSpacing: "-0.02em" }}>{value}</span>
        <span className="text-[11px]" style={{ color: "#8A958F" }}>{sub}</span>
      </div>
    </div>
  );
}