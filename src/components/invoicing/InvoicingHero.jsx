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
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: "9.5px",
          letterSpacing: ".15em",
          color: coral ? "#FF8A7A" : "rgba(255,255,255,.38)",
          whiteSpace: "nowrap",
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: "15px",
          fontWeight: 600,
          color: coral ? "#FF8A7A" : "#fff",
          whiteSpace: "nowrap",
          letterSpacing: "-.02em",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "'Inter Tight',sans-serif",
            fontSize: "11px",
            color: coral ? "rgba(255,138,122,.6)" : "rgba(255,255,255,.34)",
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
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "10px",
            letterSpacing: ".18em",
            color: "rgba(255,255,255,.38)",
            whiteSpace: "nowrap",
            marginBottom: "10px",
          }}
        >
          READY TO BILL
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "64px",
            fontWeight: 600,
            color: "#6EE7C0",
            letterSpacing: "-.045em",
            textShadow: "0 0 46px rgba(110,231,192,.28)",
            lineHeight: 1,
          }}
          className="max-[699px]:text-[40px]"
        >
          ${formatMoney(readyTotal)}
        </div>
        <div
          style={{
            fontFamily: "'Inter Tight',sans-serif",
            fontSize: "15px",
            color: "rgba(255,255,255,.5)",
            marginTop: "10px",
            whiteSpace: "nowrap",
          }}
        >
          {readyCount} lines ready · {reportBlockedCount} waiting on a report · {matchBlockedCount} match review · {customFeeCount} custom fee %
          {noSourceDataCount > 0 && (
            <span style={{ display: "block", marginTop: "6px", fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", color: "#FF8A7A" }}>
              ⚠ Source data missing for {noSourceDataCount} {noSourceDataCount === 1 ? "line" : "lines"} — Probuild pull may have failed
            </span>
          )}
        </div>
      </div>

      <div className="max-[699px]:w-full" style={{ display: "flex", alignItems: "flex-end", gap: 0 }}>
        <Stat label="MONTH TOTAL" value={`$${formatMoney(monthEarnedTotal)}`} sub={`${monthEarnedCount} lines`} />
        <div style={{ width: "1px", height: "44px", backgroundColor: "rgba(255,255,255,.10)", margin: "0 20px" }} className="max-[699px]:mx-3" />
        <Stat label="BILLED" value={`$${formatMoney(billedTotal)}`} sub={`${billedCount} lines`} />
        <div style={{ width: "1px", height: "44px", backgroundColor: "rgba(255,255,255,.10)", margin: "0 20px" }} className="max-[699px]:mx-3" />
        <Stat label="SCHEDULED" value={`$${formatMoney(scheduledTotal)}`} sub={`${scheduledCount} lines`} />
        <div style={{ width: "1px", height: "44px", backgroundColor: "rgba(255,255,255,.10)", margin: "0 20px" }} className="max-[699px]:mx-3" />
        <Stat label="NEEDS A REPORT" value={String(reportBlockedCount)} sub="fix →" coral onClick={onFilterBlocked} />
        <div style={{ width: "1px", height: "44px", backgroundColor: "rgba(255,255,255,.10)", margin: "0 20px" }} className="max-[699px]:mx-3" />
        <Stat label="MATCH REVIEW" value={String(matchBlockedCount)} sub="fix →" coral onClick={onFilterMatchBlocked} />
      </div>
    </div>
  );
}