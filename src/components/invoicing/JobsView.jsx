import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { computeFeeAmt, formatMoney } from "@/lib/feeMath";

export default function JobsView({ rows, onBillJob, onExportJob, onOpenJob, isLineReady = () => true }) {
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
    return <div style={{ padding: "80px 0", textAlign: "center" }}><p className="text-[15px]" style={{ color: "#53615B" }}>No jobs for this month.</p></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-3" style={{ borderBottom: "1px solid #DDE0DA" }}>
        <span className="text-[12px] font-medium" style={{ color: "#53615B" }}>Sort: fee ↓</span>
        <span className="text-[12px]" style={{ color: "#53615B" }}>{jobs.length} jobs</span>
      </div>
      {jobs.map((job) => {
        const key = job.id || job.name;
        const isOpen = expanded === key;
        const readyLines = job.lines.filter(isLineReady);
        const readyFee = readyLines.reduce((s, r) => s + (computeFeeAmt(r) || 0), 0);
        return (
          <div key={key} style={{ borderBottom: "1px solid #ECEEEA" }}>
            <button
              onClick={() => setExpanded(isOpen ? null : key)}
              className="w-full grid items-center text-left"
              style={{ gridTemplateColumns: "minmax(0,1fr) auto 20px", gap: "10px", padding: "14px 12px", minHeight: "60px", backgroundColor: "transparent", border: "none", cursor: "pointer" }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="text-[15px] font-semibold break-words" style={{ color: "#182422" }}>{job.name}</div>
                <div className="text-[12px]" style={{ color: "#53615B", marginTop: "2px" }}>{job.lines.length} lines</div>
              </div>
              <span className="font-mono-num-bold text-right" style={{ fontSize: job.fee >= 250 ? "17px" : "14px", color: "#166447", whiteSpace: "nowrap" }}>${formatMoney(job.fee)}</span>
              <span className="text-right text-[14px]" style={{ color: "#8A958F" }}>{isOpen ? "⌄" : "›"}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-4">
                {job.lines.map((line) => (
                  <div key={line.id} className="flex justify-between items-start py-2 gap-3" style={{ borderTop: "1px solid #ECEEEA" }}>
                    <span className="text-[13px] break-words" style={{ color: "#53615B", minWidth: 0 }}>{line.line_description || line.job_name_raw}</span>
                    <span className="font-mono-num-bold text-[13px]" style={{ color: "#166447", whiteSpace: "nowrap" }}>${formatMoney(computeFeeAmt(line))}</span>
                  </div>
                ))}
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button onClick={() => onBillJob(job)} disabled={readyLines.length === 0} title={readyLines.length === job.lines.length ? undefined : `${job.lines.length - readyLines.length} line(s) are held, scheduled, excluded or already billed and will not be billed`} className="min-h-10 rounded-lg px-3.5 text-[13px] font-semibold whitespace-nowrap disabled:opacity-50" style={{ border: "1px solid #104E44", backgroundColor: "#146556", color: "#FFFFFF", cursor: readyLines.length ? "pointer" : "not-allowed" }}>
                    {readyLines.length ? `Bill ${readyLines.length} ready ${readyLines.length === 1 ? "line" : "lines"} · $${formatMoney(readyFee)}` : "Nothing ready to bill"}
                  </button>
                  <button onClick={() => onExportJob(job)} className="min-h-10 rounded-lg px-3.5 text-[13px] font-medium whitespace-nowrap" style={{ border: "1px solid #DDE0DA", backgroundColor: "#FFFFFF", color: "#182422", cursor: "pointer" }}>
                    Export CSV
                  </button>
                  {job.id && (
                    <button onClick={() => navigate(`/jobs/${job.id}`)} className="min-h-10 rounded-lg px-3.5 text-[13px] font-medium whitespace-nowrap" style={{ border: "1px solid #DDE0DA", backgroundColor: "#FFFFFF", color: "#182422", cursor: "pointer" }}>
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