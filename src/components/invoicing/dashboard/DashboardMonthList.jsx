import { useEffect, useState } from "react";
import { computeFeeAmt, formatMoney, isFutureRow } from "@/lib/feeMath";
import { isMatchBlocked, isReportBlocked } from "@/lib/invoicingFilters";
import LineRow from "../LineRow";

// Month-grouped billing line list for the dashboard view. Same LineRow rows and
// per-line actions as the Lines view; bulk selection stays in the month-scoped
// Lines view so a cross-month range can never feed a bulk bill by accident.
export default function DashboardMonthList({ groups, selectedIds, onToggle, onShiftClick, onEdit, onDelete, onAddReport, onMarkBilled, onOpenJob, onOpenDetails, reportAttached, editRequestId, onEditRequestHandled, onReady, onSendForReview, jobs, onLinkJob, reportStatusMap }) {
  const [expandedId, setExpandedId] = useState(null);
  useEffect(() => {
    if (!editRequestId) return;
    setExpandedId(editRequestId);
    onEditRequestHandled?.();
  }, [editRequestId, onEditRequestHandled]);
  const toggleExpand = (row) => setExpandedId((prev) => (prev === row.id ? null : row.id));
  const collapse = () => setExpandedId(null);
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);

  if (totalRows === 0) {
    return (
      <div style={{ padding: "80px 0", textAlign: "center" }}>
        <p className="text-[15px]" style={{ color: "var(--gf-ink-3)" }}>Nothing in this range.</p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", paddingBottom: "8px" }}>
      <div className="hidden sm:flex items-center" style={{ height: "26px", padding: "0 16px", gap: "14px", borderBottom: "1px solid var(--gf-hairline)", backgroundColor: "var(--gf-card-band)" }}>
        <div style={{ width: "28px", flexShrink: 0 }} />
        <div style={{ width: "30px", flexShrink: 0 }} />
        <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", flex: "1 1 auto" }}>Job</span>
        <span className="text-[11px] font-semibold uppercase text-right" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "80px", flexShrink: 0 }}>Labor / sale</span>
        <span className="text-[11px] font-semibold uppercase text-right" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "128px", flexShrink: 0 }}>Status</span>
        <span className="text-[11px] font-semibold uppercase text-right" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "100px", flexShrink: 0 }}>Fee</span>
        <div style={{ width: "28px", flexShrink: 0 }} />
      </div>
      {groups.map((g) => {
        const monthFee = g.rows.reduce((s, r) => s + (computeFeeAmt(r) || 0), 0);
        return (
          <div key={g.month}>
            <div
              className="flex items-center"
              style={{
                position: "sticky",
                top: 0,
                zIndex: 5,
                height: "34px",
                backgroundColor: "var(--gf-card-band)",
                borderTop: "1px solid var(--gf-hairline)",
                borderBottom: "1px solid var(--gf-hairline)",
                padding: "0 16px",
                gap: "12px",
              }}
            >
              <span className="text-[12.5px] font-semibold" style={{ color: "var(--gf-ink)", whiteSpace: "nowrap" }}>{g.label}</span>
              <span className="text-[12px]" style={{ color: "var(--gf-ink-3)", whiteSpace: "nowrap" }}>{g.rows.length} {g.rows.length === 1 ? "line" : "lines"}</span>
              <div style={{ flex: "1 1 0%", minWidth: 0 }} />
              <span className="text-[12.5px] font-semibold font-mono-num" style={{ color: "var(--gf-ink)", whiteSpace: "nowrap" }}>${formatMoney(monthFee)}</span>
            </div>
            {g.rows.map((raw) => {
              const row = { ...raw, _reportBlocked: isReportBlocked(raw, reportStatusMap) };
              return (
                <LineRow
                  key={row.id}
                  row={row}
                  selected={false}
                  selectionEnabled={false}
                  blocked={isMatchBlocked(row) || row._reportBlocked}
                  reportAttached={reportAttached.has(row.id)}
                  isFuture={isFutureRow(row)}
                  isBilled={!!row.billed_to_bfs}
                  isZero={Number(row.labor_amt) === 0}
                  onToggle={onToggle}
                  onShiftClick={onShiftClick}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onAddReport={onAddReport}
                  onMarkBilled={onMarkBilled}
                  onOpenJob={onOpenJob}
                  onOpenDetails={onOpenDetails}
                  expanded={expandedId === row.id}
                  onToggleExpand={toggleExpand}
                  onReady={onReady}
                  onSendForReview={onSendForReview}
                  onCollapse={collapse}
                  jobs={jobs}
                  onLinkJob={onLinkJob}
                />
              );
            })}
          </div>
        );
      })}
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--gf-hairline)" }}>
        <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>Bulk billing actions live in the Lines view.</span>
      </div>
    </div>
  );
}
