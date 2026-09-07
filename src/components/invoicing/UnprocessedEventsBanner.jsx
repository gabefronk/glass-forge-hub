import { AlertCircle, Loader2 } from "lucide-react";

export default function UnprocessedEventsBanner({ count, onRun, running }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        marginBottom: "16px",
        borderRadius: "14px",
        backgroundColor: "#FBEDEA",
        border: "1px solid #EFD2CA",
      }}
    >
      <AlertCircle style={{ width: "18px", height: "18px", color: "#8A4038", flexShrink: 0 }} />
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ fontFamily: "'Archivo',sans-serif", fontSize: "13px", fontWeight: 600, color: "#131A26" }}>
          {count} calendar {count === 1 ? "event has" : "events have"} no billing line
        </div>
        <div style={{ fontFamily: "'Archivo',sans-serif", fontSize: "12px", color: "#616D81", marginTop: "2px" }}>
          These events won't appear in your invoice until the fee ingest runs.
        </div>
      </div>
      <button
        onClick={onRun}
        className="w-full justify-center sm:w-auto"
        disabled={running}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: "34px",
          padding: "0 14px",
          borderRadius: "10px",
          backgroundColor: running ? "#F6F8FC" : "#8A4038",
          color: running ? "#77839A" : "#FFFFFF",
          fontFamily: "'Archivo',sans-serif",
          fontSize: "12px",
          fontWeight: 600,
          border: "1px solid #EFD2CA",
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
