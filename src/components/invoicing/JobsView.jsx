import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { computeFeeAmt, formatMoney } from "@/lib/feeMath";

export default function JobsView({ rows, onBillJob, onExportJob, onOpenJob }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(null);

  const jobs = useMemo(() => {
    const groups = {};
    for (const r of rows) {
      const key = r.job_id || r.job_name_norm;
      if (!groups[key]) groups[key] = { id: r.job_id, name: r.job_name_norm, lines: [], fee: 0 };
      groups[key].lines.push(r);
      groups[key].fee += computeFeeAmt(r) || 0;
    }
    return Object.values(groups).sort((a, b) => b.fee - a.fee);
  }, [rows]);

  if (jobs.length === 0) {
    return (
      <div style={{ padding: "80px 0", textAlign: "center" }}>
        <p style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: "15px", color: "rgba(255,255,255,.5)" }}>No jobs for this month.</p>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 12px",
          borderBottom: "1px solid rgba(255,255,255,.08)",
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "10px", letterSpacing: ".14em", color: "rgba(255,255,255,.40)" }}>SORT: FEE ↓</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", color: "rgba(255,255,255,.34)" }}>{jobs.length} jobs</span>
      </div>
      {jobs.map((job) => {
        const key = job.id || job.name;
        const isOpen = expanded === key;
        return (
          <div key={key} style={{ borderBottom: "1px solid rgba(255,255,255,.05)" }}>
            <button
              onClick={() => setExpanded(isOpen ? null : key)}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 120px 24px",
                gap: "16px",
                alignItems: "center",
                width: "100%",
                padding: "16px 12px",
                minHeight: "64px",
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    font: "500 15px 'Inter Tight',sans-serif",
                    color: "#fff",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {job.name}
                </div>
                <div style={{ font: "400 12.5px 'Inter Tight',sans-serif", color: "rgba(255,255,255,.34)", marginTop: "2px" }}>
                  {job.lines.length} lines
                </div>
              </div>
              <span
                style={{
                  textAlign: "right",
                  font: `${job.fee >= 250 ? "600 17px" : "500 14px"} 'IBM Plex Mono',monospace`,
                  color: "#6EE7C0",
                  whiteSpace: "nowrap",
                }}
              >
                ${formatMoney(job.fee)}
              </span>
              <span style={{ textAlign: "right", color: "rgba(255,255,255,.3)", fontFamily: "'IBM Plex Mono',monospace", fontSize: "14px" }}>
                {isOpen ? "⌄" : "›"}
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: "0 12px 16px" }}>
                {job.lines.map((line) => (
                  <div
                    key={line.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 0",
                      borderTop: "1px solid rgba(255,255,255,.05)",
                      gap: "12px",
                    }}
                  >
                    <span
                      style={{
                        font: "400 13px 'Inter Tight',sans-serif",
                        color: "rgba(255,255,255,.62)",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {line.line_description || line.job_name_raw}
                    </span>
                    <span style={{ font: "500 13px 'IBM Plex Mono',monospace", color: "#6EE7C0", whiteSpace: "nowrap" }}>
                      ${formatMoney(computeFeeAmt(line))}
                    </span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => onBillJob(job)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "99px",
                      border: "none",
                      backgroundColor: "#6EE7C0",
                      color: "#0A0C0C",
                      font: "600 12px 'Inter Tight',sans-serif",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Bill this job · ${formatMoney(job.fee)}
                  </button>
                  <button
                    onClick={() => onExportJob(job)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "99px",
                      border: "1px solid rgba(255,255,255,.10)",
                      backgroundColor: "transparent",
                      color: "rgba(255,255,255,.62)",
                      font: "500 12px 'Inter Tight',sans-serif",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Export CSV
                  </button>
                  {job.id && (
                    <button
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "99px",
                        border: "1px solid rgba(255,255,255,.10)",
                        backgroundColor: "transparent",
                        color: "rgba(255,255,255,.62)",
                        font: "500 12px 'Inter Tight',sans-serif",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Open job ↗
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}