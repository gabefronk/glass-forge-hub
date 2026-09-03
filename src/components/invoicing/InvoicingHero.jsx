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
      }}
    >
      <div
        style={{
          fontFamily: "'Archivo',sans-serif",
          fontSize: "9.5px",
          letterSpacing: ".01em",
          color: coral ? "#8A4038" : "#616D81",
          whiteSpace: "nowrap",
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
          whiteSpace: "nowrap",
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
            whiteSpace: "nowrap",
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
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: "24px",
        paddingTop: "32px",
        paddingBottom: "28px",
      }}
      className="max-[699px]:flex-col max-[699px]:items-start max-[699px]:gap-4"
    >
      <div>
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
            fontSize: "64px",
            fontWeight: 800,
            color: "#1E4A85",
            letterSpacing: "-.045em",
            lineHeight: 1,
          }}
          className="max-[699px]:text-[40px]"
        >
          ${formatMoney(readyTotal)}
        </div>
        <div
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "15px",
            color: "#535E72",
            marginTop: "10px",
            whiteSpace: "nowrap",
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

      <div className="max-[699px]:w-full" style={{ display: "flex", alignItems: "flex-end", gap: 0 }}>
        <Stat label="Earned to date" value={`$${formatMoney(monthEarnedTotal)}`} sub={`${monthEarnedCount} lines · excl. scheduled`} />
        <div style={{ width: "1px", height: "44px", backgroundColor: "#DDE3EC", margin: "0 20px" }} className="max-[699px]:mx-3" />
        <Stat label="Billed" value={`$${formatMoney(billedTotal)}`} sub={`${billedCount} lines`} />
        <div style={{ width: "1px", height: "44px", backgroundColor: "#DDE3EC", margin: "0 20px" }} className="max-[699px]:mx-3" />
        <Stat label="Scheduled" value={`$${formatMoney(scheduledTotal)}`} sub={`${scheduledCount} lines`} />
        <div style={{ width: "1px", height: "44px", backgroundColor: "#DDE3EC", margin: "0 20px" }} className="max-[699px]:mx-3" />
        <Stat label="Needs a report" value={String(reportBlockedCount)} sub="fix →" coral onClick={onFilterBlocked} />
        <div style={{ width: "1px", height: "44px", backgroundColor: "#DDE3EC", margin: "0 20px" }} className="max-[699px]:mx-3" />
        <Stat label="Match review" value={String(matchBlockedCount)} sub="fix →" coral onClick={onFilterMatchBlocked} />
      </div>
    </div>
  );
}