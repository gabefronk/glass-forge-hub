import { AlertCircle, Loader2 } from "lucide-react";

export default function UnprocessedEventsBanner({ count, onRun, running }) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl mb-4"
      style={{ padding: "12px 16px", backgroundColor: "#FCEDEC", border: "1px solid #F0C9C5" }}
    >
      <AlertCircle style={{ width: "18px", height: "18px", color: "#A43432", flexShrink: 0 }} />
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div className="text-[13px] font-semibold" style={{ color: "#182422" }}>
          {count} calendar {count === 1 ? "event has" : "events have"} no billing line
        </div>
        <div className="text-[12px]" style={{ color: "#53615B", marginTop: "2px" }}>
          These events won't appear in your invoice until the fee ingest runs.
        </div>
      </div>
      <button
        onClick={onRun}
        className="w-full justify-center sm:w-auto flex items-center gap-2 min-h-10 rounded-lg px-4 text-[13px] font-semibold whitespace-nowrap"
        disabled={running}
        style={{ backgroundColor: running ? "#F0F1ED" : "#A43432", color: running ? "#8A958F" : "#FFFFFF", border: "1px solid #F0C9C5", cursor: running ? "wait" : "pointer", flexShrink: 0 }}
      >
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {running ? "Running…" : "Run ingest now"}
      </button>
    </div>
  );
}