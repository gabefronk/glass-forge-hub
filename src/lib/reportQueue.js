import { assessBillingLine } from "../../base44/shared/billingAudit.js";
import { denverDate } from "../../base44/shared/billingCore.js";

// A purchasing reminder is not an installer visit. No-charge visits still need
// their work report; billing eligibility and reporting obligations are separate.
export function reportQueueEvents(events = [], today = denverDate()) {
  const seen = new Set();
  return events.filter(event => {
    if (!event || event.report_required === false) return false;
    const kind = assessBillingLine({
      source: "calendar", job_name_raw: event.job_name, job_date: event.event_date,
      labor_amt: event.labor_amt, calendar_note_text: event.scope_notes,
    }, event, today).kind;
    if (["ignored","scheduled","tracker_only","logistics"].includes(kind)) return false;
    const identity = event.google_event_id ? (event.google_calendar_id || "") + ":" + event.google_event_id : event.id;
    if (identity && seen.has(identity)) return false;
    if (identity) seen.add(identity);
    return true;
  });
}
