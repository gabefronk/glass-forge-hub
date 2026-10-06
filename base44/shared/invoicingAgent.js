// Invoicing Agent v1 — read-only flag-and-list analysis. Pure: takes the
// already-fetched FeeLines / Jobs / CalendarEvents and returns a worklist with
// four sections (needs_pricing, needs_job_link, pricing_conflicts, ready_to_bill).
//
// RULE ZERO: this module never writes. It computes on demand from the records
// handed to it. No state is stored. It never sums, folds, supersedes or picks a
// winner for pricing conflicts — it surfaces both amounts.
//
// Reuses the shared lot+community matcher (lotCommunityMatch.js), identity
// resolver (jobIdentity.js) and link resolver (jobLinkResolver.js) so the
// agent's job-link verdicts match the ingest paths.

import {
  isIgnoredWorkItem,
  computeLaborAmt,
  computeFeeAmt,
  feeCompanions,
  eventPostIndex,
  denverDate,
} from "./billingCore.js";
import { withBillingAudit } from "./billingAudit.js";
import { buildSupersededSet } from "./supersession.ts";
import { normalizeJobName, invoiceMonthFromDate } from "./ingestShared.ts";
import {
  createJobIndex,
  resolveJob,
  describeJobInfo,
  customersConflict,
} from "./jobIdentity.js";
import { lotCommunityCheck } from "./lotCommunityMatch.js";
import { suggestJobLinks } from "./jobLinkResolver.js";

// "YYYY-MM" shifted by whole months without Date/UTC conversion.
function shiftMonth(monthStr, delta) {
  const [y, m] = String(monthStr || "").split("-").map(Number);
  if (!y || !m) return monthStr || "";
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

// No-charge indicators from the billing audit (kept in sync with billingAudit.js).
const FREE_WORDS = /\bno[ -]?charge\b|\bnot\s+billable\b|\bno\s+pay\b/i;
const SHEETROCK_ONLY = (text) =>
  /\b(?:sheetrock|srw)\b/i.test(text) &&
  !/\b(?:except|chargeable|repair|replace|extra\s+(?:charge|labor))\b/i.test(text);
const CURRENT_SERVICE_SCOPE = (text) =>
  String(text || "").split(/\n\s*[_=]{8,}[^\n]*(?:\n|$)/)[0];

// A line carries an explicit no-charge decision in its notes.
export function hasNoChargeNote(row) {
  const scope = CURRENT_SERVICE_SCOPE(
    row.calendar_note_text || (row.source === "calendar" ? row.note_text : "")
  );
  const report = String(
    row.probuild_note_text || (row.source === "probuild" ? row.note_text : "") || ""
  );
  return FREE_WORDS.test(scope) || FREE_WORDS.test(report) || SHEETROCK_ONLY(scope || report);
}

function isFuture(row, today) {
  const d = row.job_date;
  if (!d) return false;
  return String(d) > String(today);
}

// ── Report-block (mirrors invoicingFilters.js isReportBlocked) ───────────────
function hasFeeLineReportEvidence(r) {
  return !!(
    r.probuild_post_id &&
    (r.probuild_note_text ||
      r.note_text ||
      Number(r.man_hours) > 0 ||
      Number(r.trip_charges) > 0 ||
      (Array.isArray(r.photo_urls) && r.photo_urls.length > 0))
  );
}
const OK_REPORT_STATUSES = new Set(["ok", "waived", "pre_compliance"]);
function isReportBlocked(r, reportStatusMap) {
  if (!r.calendar_event_id || !reportStatusMap) return false;
  const status = reportStatusMap.get(r.calendar_event_id);
  if (status === "rescheduled") return true;
  if (hasFeeLineReportEvidence(r)) return false;
  if (!status) return true;
  return !OK_REPORT_STATUSES.has(status);
}

// ── Match-block (mirrors invoicingFilters.js isMatchBlocked) ─────────────────
function isMatchBlocked(r) {
  return (
    !!r._billing_review ||
    ((r.needs_review || !!r._companion_review) && !r.manually_adjusted)
  );
}

// ── Ready to bill (mirrors invoicingFilters.js isReady) ──────────────────────
function isReady(r, reportStatusMap, supersededSet, today) {
  return (
    r.billable &&
    !r._billing_hidden &&
    !r.billed_to_bfs &&
    !isFuture(r, today) &&
    !isMatchBlocked(r) &&
    !isReportBlocked(r, reportStatusMap) &&
    !(supersededSet && supersededSet.has(r.id)) &&
    (Number(r.labor_amt) > 0 || r.fee_type === "profit_split")
  );
}

// Suggest the single clear survivor job for a line, or list candidates.
// Never guesses when more than one candidate exists.
function suggestTarget(row, index, jobs) {
  const rawName = row.job_name_raw || row.job_name_norm || "";
  const input = {
    normName: normalizeJobName(rawName),
    rawName,
    poNumber: row.po_number || "",
    oeNumber: row.oe_number || "",
    address: "",
    linkedJobId: "", // ignore the current (possibly wrong) link when suggesting
  };
  const m = resolveJob(input, index);
  if (
    m &&
    m.job_id &&
    m.match_confidence === "high" &&
    !m.needs_review &&
    !m.autoCreate
  ) {
    const job = index.byId.get(m.job_id);
    return {
      suggested_job_id: m.job_id,
      suggested_job_name: job ? job.canonical_name : "",
      candidates: [],
      match_reason: m.reason,
    };
  }
  // No single survivor — collect candidates (resolveJob's, then suggestJobLinks).
  const candIds = (m && m.candidate_job_ids) || [];
  const candidates = candIds.map((id) => {
    const j = index.byId.get(id);
    return { job_id: id, job_name: j ? j.canonical_name : "" };
  });
  if (candidates.length < 5) {
    const sugg = suggestJobLinks(
      { job_name: rawName, po_number: row.po_number, oe_number: row.oe_number },
      jobs,
      5
    );
    const seen = new Set(candidates.map((c) => c.job_id));
    for (const s of sugg) {
      if (!seen.has(s.job_id)) {
        candidates.push({
          job_id: s.job_id,
          job_name: s.job_name,
          reasons: s.reasons,
          score: s.score,
        });
        seen.add(s.job_id);
      }
    }
  }
  return {
    suggested_job_id: null,
    suggested_job_name: "",
    candidates: candidates.slice(0, 5),
    match_reason: m ? m.reason : "",
  };
}

// Build the agent worklist. Pure: no SDK calls, no writes.
//   feeLines: FeeLines records (raw; amounts recomputed here)
//   jobs:     Jobs records
//   events:   CalendarEvents records (for report-status + companion pairing)
//   currentMonth: "YYYY-MM"
export function buildAgentWorklist({ feeLines, jobs, events, currentMonth }) {
  const today = denverDate();
  const priorMonth = shiftMonth(currentMonth, -1);

  // Scope: current month (all lines) + prior month's open (not billed) lines.
  const scoped = (Array.isArray(feeLines) ? feeLines : []).filter((r) => {
    const im = r.invoice_month || invoiceMonthFromDate(r.job_date);
    if (!im) return false;
    if (im === currentMonth) return true;
    if (im === priorMonth && !r.billed_to_bfs) return true;
    return false;
  });

  // Recompute amounts the way the Invoicing page sees them.
  const rows = scoped.map((r) => ({
    ...r,
    labor_amt: computeLaborAmt(r),
    fee_amt: computeFeeAmt(r),
  }));

  // Billing audit + companion pairing (mirrors withCompanions in invoicingFilters).
  const audited = withBillingAudit(rows, events);
  const filtered = audited.filter((r) => !isIgnoredWorkItem(r) && !r._billing_hidden);
  const comps = feeCompanions(filtered, { eventPosts: eventPostIndex(events) });
  const displayRows = filtered.map((r) => {
    if (comps.folded.has(r.id))
      return { ...r, _companion_folded: true, _companion_of: comps.companionOf.get(r.id) || null };
    if (comps.held.has(r.id)) return { ...r, _companion_review: comps.held.get(r.id) };
    if (comps.companionsByCalendar.has(r.id))
      return { ...r, _companion_ids: comps.companionsByCalendar.get(r.id) };
    return r;
  });
  const supersededSet = buildSupersededSet(displayRows, events);

  // Report-status map keyed by google_event_id (the calendar_event_id on a fee line).
  const reportStatusMap = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (e.google_event_id) reportStatusMap.set(e.google_event_id, e.report_status);
  }

  // Job index for identity resolution.
  const index = createJobIndex(jobs, normalizeJobName);
  const jobsById = index.byId;

  // Flag set: open (not billed), not superseded — used for pricing + link checks.
  const flagRows = displayRows.filter(
    (r) => !r.billed_to_bfs && !supersededSet.has(r.id)
  );
  // Conflict set: open, includes superseded twins (so calendar/probuild amount
  // disagreements surface instead of being silently folded).
  const conflictRows = displayRows.filter((r) => !r.billed_to_bfs);

  // ── 1. Needs pricing ───────────────────────────────────────────────────────
  const needs_pricing = [];
  for (const r of flagRows) {
    if (isFuture(r, today)) continue; // scheduled, no work done yet
    if (r.fee_type !== "labor_pct") continue; // profit-split pricing is sale/cost
    const labor = Number(r.labor_amt) || 0;
    if (labor > 0) continue;
    if (hasNoChargeNote(r)) continue;
    const crewLine = r.source === "probuild";
    needs_pricing.push({
      line_id: r.id,
      job_date: r.job_date,
      invoice_month: r.invoice_month || invoiceMonthFromDate(r.job_date),
      job_name_raw: r.job_name_raw || "",
      job_name_norm: r.job_name_norm || "",
      line_description: r.line_description || "",
      source: r.source,
      po_number: r.po_number || "",
      oe_number: r.oe_number || "",
      job_id: r.job_id || null,
      labor_amt: r.labor_amt,
      fee_amt: r.fee_amt,
      crew_line: crewLine,
      sent_for_review: !!r.sent_for_review,
      // Crew (Israel) ProBuild lines use the Hub-side "Send for Review" path.
      send_for_review_eligible: crewLine && !r.sent_for_review,
    });
  }

  // ── 2. Needs job link ──────────────────────────────────────────────────────
  const needs_job_link = [];
  for (const r of flagRows) {
    const eventTitle = r.job_name_raw || r.job_name_norm || r.line_description || "";
    let reason = null;
    let linkedJob = null;
    if (r.job_id) {
      linkedJob = jobsById.get(r.job_id);
      if (!linkedJob) {
        reason = "linked_job_not_found";
      } else {
        const lc = lotCommunityCheck(eventTitle, linkedJob);
        if (lc.veto) {
          reason = lc.reason; // lot_mismatch | community_mismatch
        } else {
          // Identity clash: the line's builder/customer disagrees with the job.
          const me = describeJobInfo({ canonical_name: eventTitle });
          const info = index.info.get(r.job_id);
          if (info && me.customer && customersConflict(me.customer, info.customer)) {
            reason = "customer_clash";
          }
        }
      }
    } else {
      reason = "no_job_link";
    }
    if (!reason) continue;
    const suggestion = suggestTarget(r, index, jobs);
    needs_job_link.push({
      line_id: r.id,
      job_date: r.job_date,
      invoice_month: r.invoice_month || invoiceMonthFromDate(r.job_date),
      job_name_raw: r.job_name_raw || "",
      job_name_norm: r.job_name_norm || "",
      line_description: r.line_description || "",
      source: r.source,
      po_number: r.po_number || "",
      oe_number: r.oe_number || "",
      current_job_id: r.job_id || null,
      current_job_name: linkedJob ? linkedJob.canonical_name : "",
      reason,
      labor_amt: r.labor_amt,
      fee_amt: r.fee_amt,
      ...suggestion,
    });
  }

  // ── 3. Pricing conflicts (same job + same visit date, different amounts) ──
  // Never sum, fold, supersede or pick one — surface every line with its amount.
  const conflictMap = new Map();
  for (const r of conflictRows) {
    if (!r.job_id) continue;
    const key = r.job_id + "|" + r.job_date;
    if (!conflictMap.has(key)) conflictMap.set(key, []);
    conflictMap.get(key).push(r);
  }
  const pricing_conflicts = [];
  for (const group of conflictMap.values()) {
    if (group.length < 2) continue;
    const nonzero = group.filter((r) => Number(r.labor_amt) > 0);
    const distinctAmts = new Set(nonzero.map((r) => Number(r.labor_amt)));
    if (distinctAmts.size < 2) continue; // need 2+ different nonzero amounts
    const job = jobsById.get(group[0].job_id);
    pricing_conflicts.push({
      job_id: group[0].job_id,
      job_name: job ? job.canonical_name : group[0].job_name_norm || "",
      job_date: group[0].job_date,
      amounts: [...distinctAmts].sort((a, b) => a - b),
      lines: group
        .map((r) => ({
          line_id: r.id,
          source: r.source,
          labor_amt: r.labor_amt,
          fee_amt: r.fee_amt,
          line_description: r.line_description || "",
          probuild_post_id: r.probuild_post_id || null,
          calendar_event_id: r.calendar_event_id || null,
          superseded_by: r.superseded_by || null,
        }))
        .sort((a, b) => Number(a.labor_amt) - Number(b.labor_amt)),
    });
  }

  // ── 4. Ready to bill (count + subtotal), excluding any flagged line ───────
  const flaggedIds = new Set([
    ...needs_pricing.map((x) => x.line_id),
    ...needs_job_link.map((x) => x.line_id),
    ...pricing_conflicts.flatMap((c) => c.lines.map((l) => l.line_id)),
  ]);
  const readyRows = displayRows.filter(
    (r) => isReady(r, reportStatusMap, supersededSet, today) && !flaggedIds.has(r.id)
  );
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const ready_to_bill = {
    count: readyRows.length,
    subtotal: round2(readyRows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0)),
    labor_total: round2(readyRows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0)),
  };

  return {
    current_month: currentMonth,
    prior_month: priorMonth,
    today,
    scoped_line_count: rows.length,
    needs_pricing,
    needs_job_link,
    pricing_conflicts,
    ready_to_bill,
    counts: {
      needs_pricing: needs_pricing.length,
      needs_job_link: needs_job_link.length,
      pricing_conflicts: pricing_conflicts.length,
      ready_to_bill: ready_to_bill.count,
    },
  };
}