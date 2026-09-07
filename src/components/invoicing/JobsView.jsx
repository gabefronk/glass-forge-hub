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
        <p style={{ fontFamily: "'Archivo',sans-serif", fontSize: "15px", color: "#616D81" }}>No jobs for this month.</p>
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
          borderBottom: "1px solid #DDE3EC",
        }}
      >
        <span style={{ fontFamily: "'Archivo',sans-serif", fontSize: "10px", letterSpacing: ".01em", color: "#616D81" }}>Sort: fee ↓</span>
        <span style={{ fontFamily: "'Archivo',sans-serif", fontSize: "11px", color: "#616D81" }}>{jobs.length} jobs</span>
      </div>
      {jobs.map((job) => {
        const key = job.id || job.name;
        const isOpen = expanded === key;
        return (
          <div key={key} style={{ borderBottom: "1px solid #E9EDF4" }}>
            <button
              onClick={() => setExpanded(isOpen ? null : key)}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) auto 20px",
                gap: "10px",
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
                    fontFamily: "'Archivo',sans-serif",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#131A26",
                    overflowWrap: "anywhere",
                  }}
                >
                  {job.name}
                </div>
                <div style={{ fontFamily: "'Archivo',sans-serif", fontSize: "12.5px", color: "#616D81", marginTop: "2px" }}>
                  {job.lines.length} lines
                </div>
              </div>
              <span
                style={{
                  textAlign: "right",
                  fontFamily: "'Archivo',sans-serif",
                  fontSize: job.fee >= 250 ? "17px" : "14px",
                  fontWeight: job.fee >= 250 ? 700 : 600,
                  color: "#1E4A85",
                  whiteSpace: "nowrap",
                }}
              >
                ${formatMoney(job.fee)}
              </span>
              <span style={{ textAlign: "right", color: "#77839A", fontFamily: "'Archivo',sans-serif", fontSize: "14px" }}>
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
                      borderTop: "1px solid #E9EDF4",
                      gap: "12px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Archivo',sans-serif",
                        fontSize: "13px",
                        color: "#535E72",
                        minWidth: 0,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {line.line_description || line.job_name_raw}
                    </span>
                    <span style={{ fontFamily: "'Archivo',sans-serif", fontSize: "13px", fontWeight: 600, color: "#1E4A85", whiteSpace: "nowrap" }}>
                      ${formatMoney(computeFeeAmt(line))}
                    </span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => onBillJob(job)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "10px",
                      border: "1px solid #1E4A85",
                      backgroundColor: "#2A5EA8",
                      color: "#FFFFFF",
                      fontFamily: "'Archivo',sans-serif",
                      fontSize: "12px",
                      fontWeight: 600,
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
                      borderRadius: "10px",
                      border: "1px solid #DDE3EC",
                      backgroundColor: "#FFFFFF",
                      color: "#131A26",
                      fontFamily: "'Archivo',sans-serif",
                      fontSize: "12px",
                      fontWeight: 500,
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
                        borderRadius: "10px",
                        border: "1px solid #DDE3EC",
                        backgroundColor: "#FFFFFF",
                        color: "#131A26",
                        fontFamily: "'Archivo',sans-serif",
                        fontSize: "12px",
                        fontWeight: 500,
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
