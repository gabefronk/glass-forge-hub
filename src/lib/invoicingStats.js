import { computeFeeAmt, computeLaborAmt, isFutureRow } from "./feeMath";
import { buildSupersededSet, isReady, isMatchBlocked, isReportBlocked, isCustomFee } from "./invoicingFilters";
export function invoicingStats(rows, reportStatusMap, supersededSet = buildSupersededSet(rows)) {
  const active = rows.filter(r => r.billable && !supersededSet.has(r.id));
  const past = active.filter(r => !isFutureRow(r));
  const ready = past.filter(r => isReady(r, reportStatusMap, supersededSet));
  const billed = past.filter(r => r.billed_to_bfs);
  const held = past.filter(r => !r.billed_to_bfs && !isReady(r, reportStatusMap, supersededSet));
  const match = held.filter(isMatchBlocked);
  const report = held.filter(r => !isMatchBlocked(r) && isReportBlocked(r, reportStatusMap));
  const scheduled = active.filter(isFutureRow);
  const sum = arr => Math.round(arr.reduce((n, r) => n + computeFeeAmt(r), 0) * 100) / 100;
  return {
    readyTotal: sum(ready), readyCount: ready.length,
    billedTotal: sum(billed), billedCount: billed.length,
    matchBlockedTotal: sum(match), matchBlockedCount: match.length,
    reportBlockedTotal: sum(report), reportBlockedCount: report.length,
    heldTotal: sum(held),
    scheduledTotal: sum(scheduled), scheduledCount: scheduled.length,
    monthEarnedTotal: sum(past), monthEarnedCount: past.filter(r => computeFeeAmt(r) !== 0).length,
    recordedLaborTotal: Math.round(past.reduce((n,r) => n + computeLaborAmt(r), 0) * 100) / 100,
    noSourceDataCount: past.filter(r => reportStatusMap?.get(r.calendar_event_id) === "no_source_data").length,
    customFeeCount: active.filter(isCustomFee).length,
    splitReviewCount: active.filter(r => r.split_candidate_amt != null && r.pricing_review_reason).length
  };
}
