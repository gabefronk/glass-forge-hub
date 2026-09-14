// Review recommendations only. No record updates, approvals, dispatch or I/O.
export const DECISION_TRIAGE_VERSION = 'decision-triage-2026-09-14-v1';
const text = v => typeof v === 'string' ? v : '';
const routine = new Map([
  ['Job data: stale arrival source', 'Prepare a current, exact-order Sales Tracker evidence check. Keep old ETAs unconfirmed.'],
  ['Job data: calendar coverage gap', 'Prepare a bounded missing-calendar capture through iPad > MacBook. Do not confirm visits.'],
  ['Job data: cancellation not verified', 'Check current cancellation status through iPad > MacBook. Do not change or confirm appointments.'],
  ['Job data: selected calendar scope', 'Plan the deferred calendar-detail review through iPad > MacBook. Preserve explicit scope gaps.'],
  ['Job data: upstream freshness unverified', 'Verify the relevant upstream source and its check watermark. Database update time is not source freshness.'],
  ['Job data: deleted projects', 'Review the existing historical-only exclusion. Do not delete, restore, reactivate or relink any evidence.']
]);
const consequential = /\b(?:conflict\w*|contradict\w*|disagree\w*|warrant\w*|money|pricing|refund\w*|upset|angry|compensation)\b|\b(?:fee|fees|payment|chargeback|credit)\b|[$\u00a3\u20ac]\s*\d/iu;
export function triageEscalation(row = {}) {
  const title = text(row.title), context = text(row.context), combined = title + '\n' + context;
  const base = { version: DECISION_TRIAGE_VERSION, approval_granted: false, automatic_action_allowed: false, status_change_allowed: false };
  const owner = reason => ({ ...base, bucket: 'gabe_decision', label: 'Needs Gabe / source-level resolution', reason, allowed_next_step: 'Collect the exact source evidence and proposed resolution for Gabe. Do not bulk-approve, merge jobs, assign fees, accept extracted facts, or close the exception.' });
  if (consequential.test(combined)) return owner('Conflicting identity, financial consequences, warranty or customer concern requires individual review.');
  if (/multiple exact jobs|multiple lots|multi lot|no exact identity|supplied order|pdf extraction needs review/iu.test(title)) return owner('The record does not establish a unique job/order or approved document facts. Source-level verification is required before a decision.');
  const safe = reason => ({ ...base, bucket: 'bulk_safe_read_only_review', label: 'Batch-safe investigation only', reason: 'Safe to batch the evidence-gathering work, not to approve the underlying facts or close the item.', allowed_next_step: reason });
  if (routine.has(title)) return safe(routine.get(title));
  const reportOnly = ['calendar_ops_lead', 'field_reporting_lead'].includes(row.agent_id)
    && /^Daily run exception: (Calendar Operations|Field Reporting) Lead$/.test(title)
    && /^Reconciled \d+ (?:scheduled )?events(?: and \d+ recent field reports)?:/u.test(context)
    && /missing(?:\/incomplete)? (?:field )?reports|events missing reports/iu.test(context)
    && !/unresolved|job preparation|unassigned|source checks|identity|extraction/iu.test(context);
  if (reportOnly) return safe('Compare the missing-report audit with current report evidence. Group related alerts for review, but do not declare reports received or dismiss snapshots as duplicates.');
  return owner('Mixed or insufficient detail: the summary is not enough to authorize final approval. Investigate its underlying records before an individual decision.');
}
export function summarizeDecisionTriage(rows = []) {
  const open = rows.filter(r => r?.status === 'needs_owner_decision');
  const items = open.map(row => ({ id: row.id, title: row.title, ...triageEscalation(row) }));
  return { version: DECISION_TRIAGE_VERSION, total: items.length,
    bulk_safe_read_only_review: items.filter(r => r.bucket === 'bulk_safe_read_only_review').length,
    gabe_decision: items.filter(r => r.bucket === 'gabe_decision').length,
    safe_final_approvals: 0, approved: 0, resolved: 0, items };
}
