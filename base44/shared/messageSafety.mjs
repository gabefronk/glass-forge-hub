// Conservative draft holds, not a complete sentiment classifier or sending authority.
// No I/O, external actions, automatic approvals, or model calls.
export const MESSAGE_SAFETY_VERSION = 'service-safety-2026-09-14-v1';
export const MICROSOFT_ACCESS_ROUTE = 'iPad > MacBook';
export const CUSTOMER_SERVICE_RULES = Object.freeze([
  'Quick acknowledgment, unless already acknowledged or Gabe review is required.',
  'Day-before appointment confirmation drafts require a current, confirmed appointment for the exact job and recipient, with date, timezone and cancellation status verified.',
  'Photo updates use only verified, job-specific photos and attributed notes. Metadata is not visual inspection or proof of completion.',
  'Explain the next step in plain language. Do not promise an action that has not been approved.',
  'Never invent warranty coverage.',
  'Money, warranty disputes and upset customers go directly to Gabe. Do not automatically handle or forward them to service.',
  'Outlook and OneDrive access: iPad > MacBook, using existing approved native sessions only. No direct connectors, Microsoft OAuth, Graph access or browser sign-in.',
  'All customer communication remains a draft. No automatic sending, appointment reminders, dispatch or messaging takeover is enabled.'
]);
const text = value => typeof value === 'string' ? value.normalize('NFKC') : '';
const money = /(?:[$\u00a3\u20ac]\s*\d|\b(?:money|dollars?|prices?|pricing|costs?|fees?|charges?|payments?|deposits?|refunds?|reimburse\w*|invoices?|billing|credits?|discounts?|compensation|paid|owe|owed|pay|paying|chargebacks?)\b)/iu;
// All warranty questions are held conservatively; the detector cannot establish coverage.
const warranty = /\bwarrant(?:y|ies)\b|\b(?:covered|coverage)\s+(?:by|under)\b/iu;
const upset = /\b(?:upset|angry|furious|frustrat\w*|disappoint\w*|unacceptable|ridiculous|unhappy|complain\w*|fed\s+up|sick\s+of|pissed|lawsuit|lawyer|sue|scam|rip\s*off)\b|\b(?:you\s+promised|still\s+not\s+fixed|nobody\s+(?:called|showed|responded)|no\s+one\s+(?:called|showed|responded)|third\s+time|not\s+happy)\b/iu;
export function serviceRisk(value) {
  const valueText = text(value), reasons = [];
  if (money.test(valueText)) reasons.push('money');
  if (warranty.test(valueText)) reasons.push('warranty');
  if (upset.test(valueText)) reasons.push('upset_customer');
  return { owner_review_required: reasons.length > 0, escalate_to: reasons.length ? 'Gabe' : null, reasons };
}
export function combineServiceRisks(...values) {
  const reasons = [...new Set(values.flatMap(value => serviceRisk(value).reasons))];
  return { owner_review_required: reasons.length > 0, escalate_to: reasons.length ? 'Gabe' : null, reasons };
}
const actionable = messages => (Array.isArray(messages) ? messages : [])
  .filter(m => m && !m.retracted_at && !m.is_reaction && m.kind !== 'reaction')
  .sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at));
// Use the latest incoming turn, including its preceding request when Gabe has acknowledged.
// The service validator also inspects the actual selected incident, not older unrelated jobs.
export function latestIncomingTurn(messages) {
  const actual = actionable(messages);
  let end = actual.length - 1;
  while (end >= 0 && actual[end].direction !== 'incoming') end--;
  let start = end;
  while (start > 0 && actual[start - 1].direction === 'incoming') start--;
  return end < 0 ? [] : actual.slice(start, end + 1);
}
export function gabeReviewNote(risk) {
  return 'Gabe review required: ' + risk.reasons.map(r => ({ money: 'money or pricing', warranty: 'warranty matter', upset_customer: 'upset customer' })[r] || r).join(', ') + '. No customer reply or service dispatch is proposed. This is an on-screen review hold, not a sent notification.';
}
// A day-before draft is not an automated reminder. Relative dates alone cannot pass.
export function checkDayBeforeAppointment({ appointment, jobId, recipient, now, timeZone = 'America/Denver' } = {}) {
  const a = appointment;
  if (!a || !jobId || !recipient || a.job_id !== jobId || a.recipient !== recipient ||
      a.status !== 'confirmed' || a.cancelled !== false || !a.source_key || !a.time_zone ||
      !Number.isFinite(Date.parse(a.starts_at)) || !Number.isFinite(Date.parse(a.checked_at)) || !Number.isFinite(Date.parse(now))) {
    return { eligible: false, reason: 'Verify the exact job, recipient, confirmed appointment, timezone and current cancellation status.' };
  }
  const age = Date.parse(now) - Date.parse(a.checked_at);
  if (age < 0 || age > 5 * 60 * 1000) return { eligible: false, reason: 'Appointment evidence needs a fresh source check.' };
  try {
    const localDate = v => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
    // Compare calendar dates at UTC noon after converting each instant independently.
    const day = v => Date.parse(localDate(v) + 'T12:00:00Z');
    const eligible = day(a.starts_at) - day(now) === 86400000 && Date.parse(a.starts_at) > Date.parse(now) && a.time_zone === timeZone;
    return { eligible, reason: eligible ? 'Verified appointment falls on the next local calendar day; draft only.' : 'The appointment is not tomorrow in the verified timezone.' };
  } catch { return { eligible: false, reason: 'The appointment timezone could not be verified.' }; }
}
