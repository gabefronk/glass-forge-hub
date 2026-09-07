import { formatMoney } from "@/lib/feeMath";

function Stat({ label, value, sub, coral, onClick }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      style={{
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        border: "none",
        background: "none",
        padding: 0,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: "'Archivo',sans-serif",
          fontSize: "9.5px",
          letterSpacing: ".01em",
          color: coral ? "#8A4038" : "#616D81",
          overflowWrap: "anywhere",
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Archivo',sans-serif",
          fontSize: "15px",
          fontWeight: 700,
          color: coral ? "#8A4038" : "#131A26",
          overflowWrap: "anywhere",
          letterSpacing: "-.02em",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "11px",
            color: coral ? "#8A4038" : "#616D81",
            overflowWrap: "anywhere",
            marginTop: "2px",
          }}
        >
          {sub}
        </div>
      )}
    </Comp>
  );
}

export default function InvoicingHero({ readyTotal, readyCount, matchBlockedCount, reportBlockedCount, noSourceDataCount, customFeeCount, billedTotal, billedCount, scheduledTotal, scheduledCount, monthEarnedTotal, monthEarnedCount, onFilterBlocked, onFilterMatchBlocked }) {
  return (
    <div
      style={{
        gap: "24px",
        paddingTop: "32px",
        paddingBottom: "28px",
      }}
      className="flex min-w-0 flex-col items-start"
    >
      <div className="min-w-0 max-w-full">
        <div
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "10px",
            letterSpacing: ".01em",
            color: "#616D81",
            whiteSpace: "nowrap",
            marginBottom: "10px",
          }}
        >
          Ready to bill
        </div>
        <div
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "clamp(32px, 6vw, 64px)",
            overflowWrap: "anywhere",
            fontWeight: 800,
            color: "#1E4A85",
            letterSpacing: "-.045em",
            lineHeight: 1,
          }}
        >
          ${formatMoney(readyTotal)}
        </div>
        <div
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "15px",
            color: "#535E72",
            marginTop: "10px",
            overflowWrap: "anywhere",
          }}
        >
          {readyCount} lines ready · {reportBlockedCount} waiting on a report · {matchBlockedCount} match review · {customFeeCount} custom fee %
          {noSourceDataCount > 0 && (
            <span style={{ display: "block", marginTop: "6px", fontFamily: "'Archivo',sans-serif", fontSize: "11px", color: "#8A4038" }}>
              ⚠ Source data missing for {noSourceDataCount} {noSourceDataCount === 1 ? "line" : "lines"} — Probuild pull may have failed
            </span>
          )}
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Earned to date" value={`$${formatMoney(monthEarnedTotal)}`} sub={`${monthEarnedCount} lines · excl. scheduled`} />
        <Stat label="Billed" value={`$${formatMoney(billedTotal)}`} sub={`${billedCount} lines`} />
        <Stat label="Scheduled" value={`$${formatMoney(scheduledTotal)}`} sub={`${scheduledCount} lines`} />
        <Stat label="Needs a report" value={String(reportBlockedCount)} sub="fix →" coral onClick={onFilterBlocked} />
        <Stat label="Match review" value={String(matchBlockedCount)} sub="fix →" coral onClick={onFilterMatchBlocked} />
      </div>
    </div>
  );
}
