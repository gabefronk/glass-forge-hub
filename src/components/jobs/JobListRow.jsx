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
  const statusStr = status.key === "complete" ? "COMPLETE" : status.key === "needs_report" ? "NEEDS REPORT" : "ACTIVE";

  return (
    <Link
      to={`/jobs/${job.id}`}
      style={{
        display: "grid", gridTemplateColumns: COLS, alignItems: "center",
        gap: 16, padding: "14px 20px", minHeight: 60,
        borderTop: "1px solid rgba(255,255,255,.06)", cursor: "pointer",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "600 14px 'Inter Tight',sans-serif", color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.canonical_name}</div>
        <div style={{ font: "400 12px 'Inter Tight',sans-serif", color: "rgba(255,255,255,.42)",
          marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.address || ""}</div>
      </div>
      <span style={{ minWidth: 0, font: "400 13px 'Inter Tight',sans-serif", color: "rgba(255,255,255,.62)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.builder || "—"}</span>
      <span style={{ textAlign: "right", font: "500 13px 'IBM Plex Mono',monospace", color: "rgba(255,255,255,.7)" }}>{stats.visits}</span>
      <span style={{ textAlign: "right", font: "500 13px 'IBM Plex Mono',monospace", color: "rgba(255,255,255,.5)", whiteSpace: "nowrap" }}>{stats.lastReport ? formatShort(stats.lastReport) : "—"}</span>
      <span style={{ textAlign: "right", font: "500 13.5px 'IBM Plex Mono',monospace", color: "rgba(255,255,255,.8)", whiteSpace: "nowrap" }}>{isZero ? "—" : money(stats.labor)}</span>
      <span style={{ textAlign: "right", font: "600 13.5px 'IBM Plex Mono',monospace", color: "#6EE7C0", whiteSpace: "nowrap" }}>{isZero ? "—" : money(stats.fee)}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: "inline-block", font: "600 9.5px 'IBM Plex Mono',monospace", letterSpacing: ".1em",
          padding: "4px 8px", borderRadius: 4, whiteSpace: "nowrap",
          background: statusStr === "COMPLETE" ? "rgba(110,231,192,.14)" : "rgba(255,138,122,.14)",
          color: statusStr === "COMPLETE" ? "#6EE7C0" : "#FF8A7A",
        }}>{statusStr}</span>
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end", color: "rgba(255,255,255,.3)" }}>›</span>
    </Link>
  );
}