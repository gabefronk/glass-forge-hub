import { Link } from "react-router-dom";
import { formatShort } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";

export const COLS = "minmax(220px,1fr) 130px 120px 130px 20px";

export function refsLabel(pos, oes) {
  const total = pos.length + oes.length;
  if (total === 0) return null;
  if (total === 1) return pos.length === 1 ? `PO ${pos[0]}` : `OE ${oes[0]}`;
  const parts = [];
  if (pos.length > 0) parts.push(`${pos.length} PO`);
  if (oes.length > 0) parts.push(`${oes.length} OE`);
  return parts.join(" · ");
}

export default function JobListRow({ job, stats }) {
  const status = stats.status;
  const isComplete = status.key === "complete";
  const isNeedsReport = status.key === "needs_report";

  return (
    <Link
      to={`/jobs/${job.id}`}
      style={{
        display: "grid", gridTemplateColumns: COLS, alignItems: "center",
        gap: 12, padding: "14px 16px", minHeight: 60,
        borderTop: "1px solid #ECEEEA", cursor: "pointer",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 700, fontSize: "14px", color: "#182422",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sanitizeText(job.canonical_name)}</div>
        <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 400, fontSize: "12px", color: "#53615B",
          marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sanitizeText(job.address || "")}</div>
      </div>
      <span style={{ minWidth: 0, fontFamily: "'Archivo',sans-serif", fontWeight: 400, fontSize: "13px", color: "#53615B",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sanitizeText(job.builder || "—")}</span>
      <span style={{ textAlign: "right", fontFamily: "'Archivo',sans-serif", fontWeight: 500, fontSize: "13px", color: "#53615B", whiteSpace: "nowrap" }}>{stats.lastReport ? formatShort(stats.lastReport) : "—"}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: "inline-block", fontFamily: "'Archivo',sans-serif", fontWeight: 600, fontSize: "9.5px", letterSpacing: ".01em",
          padding: "4px 8px", borderRadius: 4, whiteSpace: "nowrap",
          backgroundColor: isComplete ? "#EAF5EE" : isNeedsReport ? "#FCEDEC" : "#F0F1ED",
          border: isComplete ? "1px solid #C7E4D2" : isNeedsReport ? "1px solid #F0C9C5" : "1px solid #DDE0DA",
          color: isComplete ? "#166447" : isNeedsReport ? "#A43432" : "#53615B",
        }}>{status.label}</span>
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end", color: "#8A958F" }}>›</span>
    </Link>
  );
}