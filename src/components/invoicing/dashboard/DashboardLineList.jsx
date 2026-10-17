import { computeFeeAmt, formatMoney } from "@/lib/feeMath";
import { lineDashboardStatus } from "@/lib/invoiceDashboard";

const STATUS_STYLE = {
  draft: { label: "Draft", bg: "var(--gf-field)", fg: "var(--gf-ink-3)" },
  outstanding: { label: "Outstanding", bg: "#E3EFEC", fg: "var(--gf-teal-800)" },
  overdue: { label: "Overdue", bg: "#F6E3E2", fg: "#A43432" },
  paid: { label: "Paid", bg: "#E0EFEA", fg: "#146556" },
  needs_report: { label: "Needs report", bg: "#F5EBD7", fg: "#8A6A1F" },
  check_billing: { label: "Check billing", bg: "#F5EBD7", fg: "#8A6A1F" },
  review: { label: "Needs review", bg: "#F5EBD7", fg: "#8A6A1F" },
};

function shortDate(jobDate) {
  if (!jobDate) return "No date";
  const d = new Date(`${jobDate}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function feeTerms(row) {
  if (row.fee_type === "profit_split") return `${Math.round((row.split_pct ?? 0.5) * 100)}% profit split`;
  return `${Math.round((row.fee_pct ?? 0.1) * 100)}% of labor`;
}

// Month-grouped billing line list for the dashboard, styled after the target
// invoice list: date + terms on the left, job and description in the middle,
// status pill and fee on the right. Clicking a row opens its details; bulk
// billing actions stay in the Lines view.
export default function DashboardLineList({ groups, onOpenDetails, reportStatusMap, supersededSet, today }) {
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  if (totalRows === 0) {
    return (
      <div className="rounded-[12px]" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", boxShadow: "var(--shadow-card)", padding: "80px 0", textAlign: "center" }}>
        <p className="text-[15px]" style={{ color: "var(--gf-ink-3)" }}>Nothing in this range.</p>
      </div>
    );
  }
  return (
    <div className="rounded-[12px]" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", boxShadow: "var(--shadow-card)", maxHeight: "620px", overflowY: "auto" }}>
      <div className="hidden sm:flex items-center" style={{ height: "30px", padding: "0 16px", gap: "14px", borderBottom: "1px solid var(--gf-hairline)", backgroundColor: "var(--gf-card-band)", position: "sticky", top: 0, zIndex: 6 }}>
        <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "86px", flexShrink: 0 }}>Date</span>
        <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", flex: "1 1 auto" }}>Job</span>
        <span className="text-[11px] font-semibold uppercase text-right" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "110px", flexShrink: 0 }}>Status</span>
        <span className="text-[11px] font-semibold uppercase text-right" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "90px", flexShrink: 0 }}>Total</span>
      </div>
      {groups.map((g) => (
        <div key={g.month}>
          <div
            className="text-[11px] font-semibold uppercase"
            style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em", padding: "10px 16px 4px", position: "sticky", top: "30px", backgroundColor: "var(--gf-card)", zIndex: 5 }}
          >
            {g.label}
          </div>
          {g.rows.map((row) => {
            const st = STATUS_STYLE[lineDashboardStatus(row, reportStatusMap, supersededSet, today)] || STATUS_STYLE.review;
            const job = row.job_name_raw || row.job_name_norm || "Unmatched";
            return (
              <button
                key={row.id}
                onClick={() => onOpenDetails(row)}
                className="flex w-full items-center text-left"
                style={{ padding: "10px 16px", gap: "14px", background: "none", border: "none", borderTop: "1px solid var(--gf-hairline)", cursor: "pointer" }}
              >
                <div style={{ width: "86px", flexShrink: 0 }}>
                  <div className="text-[13px] font-bold" style={{ color: "var(--gf-ink)" }}>{shortDate(row.job_date)}</div>
                  <div className="text-[11px]" style={{ color: "var(--gf-ink-3)" }}>{feeTerms(row)}</div>
                </div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div className="truncate text-[13.5px] font-semibold" style={{ color: "var(--gf-ink)" }}>{job}</div>
                  <div className="truncate text-[12px]" style={{ color: "var(--gf-ink-3)" }}>
                    {row.line_description || row.po_number || ""}
                    {row.manually_adjusted && (
                      <span className="ml-1.5 rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ backgroundColor: "#F5EBD7", color: "#8A6A1F" }}>Manually Adjusted</span>
                    )}
                  </div>
                </div>
                <div className="text-right" style={{ width: "110px", flexShrink: 0 }}>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: st.bg, color: st.fg, whiteSpace: "nowrap" }}>{st.label}</span>
                </div>
                <div className="text-right text-[13.5px] font-bold tabular-nums" style={{ color: "var(--gf-ink)", width: "90px", flexShrink: 0 }}>
                  ${formatMoney(computeFeeAmt(row))}
                </div>
              </button>
            );
          })}
        </div>
      ))}
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--gf-hairline)" }}>
        <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>Bulk billing actions live in the Lines view.</span>
      </div>
    </div>
  );
}
