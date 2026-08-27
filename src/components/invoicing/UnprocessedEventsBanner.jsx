import { AlertCircle, Loader2 } from "lucide-react";

export default function UnprocessedEventsBanner({ count, onRun, running }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        marginBottom: "16px",
        borderRadius: "12px",
        backgroundColor: "rgba(255,138,122,.08)",
        border: "1px solid rgba(255,138,122,.20)",
      }}
    >
      <AlertCircle style={{ width: "18px", height: "18px", color: "#FF8A7A", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: "13px", fontWeight: 500, color: "#fff" }}>
          {count} calendar {count === 1 ? "event has" : "events have"} no billing line
        </div>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: "12px", color: "rgba(255,255,255,.45)", marginTop: "2px" }}>
          These events won't appear in your invoice until the fee ingest runs.
        </div>
      </div>
      <button
        onClick={onRun}
        disabled={running}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: "34px",
          padding: "0 14px",
          borderRadius: "99px",
          backgroundColor: running ? "rgba(255,255,255,.05)" : "#FF8A7A",
          color: running ? "rgba(255,255,255,.4)" : "#0A0C0C",
          fontFamily: "'Inter Tight',sans-serif",
          fontSize: "12px",
          fontWeight: 600,
          border: "none",
          cursor: running ? "wait" : "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {running && <Loader2 style={{ width: "13px", height: "13px", animate: "spin" }} />}
        {running ? "Running…" : "Run ingest now"}
      </button>
    </div>
  );
}