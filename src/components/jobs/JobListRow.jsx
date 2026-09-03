import { Link } from "react-router-dom";
import { formatShort } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

export const COLS = "minmax(320px,1fr) 170px 80px 96px 120px 116px 150px 28px";

const money = (n) => `$${formatMoney(n)}`;

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
  const isZero = stats.labor === 0;
  const statusStr = status.key === "complete" ? "Complete" : status.key === "needs_report" ? "Needs report" : "Active";
  const isComplete = status.key === "complete";
  const isNeedsReport = status.key === "needs_report";

  return (
    <Link
      to={`/jobs/${job.id}`}
      style={{
        display: "grid", gridTemplateColumns: COLS, alignItems: "center",
        gap: 16, padding: "14px 20px", minHeight: 60,
        borderTop: "1px solid #E9EDF4", cursor: "pointer",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 700, fontSize: "14px", color: "#131A26",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.canonical_name}</div>
        <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 400, fontSize: "12px", color: "#616D81",
          marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.address || ""}</div>
      </div>
      <span style={{ minWidth: 0, fontFamily: "'Archivo',sans-serif", fontWeight: 400, fontSize: "13px", color: "#535E72",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.builder || "—"}</span>
      <span style={{ textAlign: "right", fontFamily: "'Archivo',sans-serif", fontWeight: 500, fontSize: "13px", color: "#131A26" }}>{stats.visits}</span>
      <span style={{ textAlign: "right", fontFamily: "'Archivo',sans-serif", fontWeight: 500, fontSize: "13px", color: "#616D81", whiteSpace: "nowrap" }}>{stats.lastReport ? formatShort(stats.lastReport) : "—"}</span>
      <span style={{ textAlign: "right", fontFamily: "'Archivo',sans-serif", fontWeight: 500, fontSize: "13.5px", color: "#131A26", whiteSpace: "nowrap" }}>{isZero ? "—" : money(stats.labor)}</span>
      <span style={{ textAlign: "right", fontFamily: "'Archivo',sans-serif", fontWeight: 700, fontSize: "13.5px", color: isZero ? "#657185" : "#1E4A85", whiteSpace: "nowrap" }}>{isZero ? "—" : money(stats.fee)}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: "inline-block", fontFamily: "'Archivo',sans-serif", fontWeight: 600, fontSize: "9.5px", letterSpacing: ".01em",
          padding: "4px 8px", borderRadius: 4, whiteSpace: "nowrap",
          backgroundColor: isComplete ? "#E7EEFA" : isNeedsReport ? "#FBEDEA" : "#F6F8FC",
          border: isComplete ? "1px solid #C3D4EE" : isNeedsReport ? "1px solid #EFD2CA" : "1px solid #DDE3EC",
          color: isComplete ? "#1E4A85" : isNeedsReport ? "#8A4038" : "#535E72",
        }}>{statusStr}</span>
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end", color: "#77839A" }}>›</span>
    </Link>
  );
}