import { base44 } from "@/api/base44Client";

// resolveFieldReport reports most failures as HTTP 200 with an `error` code.
// Callers must treat those as failures, not as a completed upload/waive.
const MESSAGES = {
  missing_job: "This appointment is not linked to a job, so the report could not be filed. Open the job and add the report there.",
  event_not_found: "This appointment no longer exists. Reload and try again.",
  reason_required: "Enter a reason to waive the report.",
  missing_params: "The request was incomplete. Reload and try again.",
  forbidden: "Your account cannot do that.",
  Unauthorized: "Sign in again, then retry.",
  // Structured field-visit report rules (base44/shared/fieldVisitReport.js).
  invalid_report: "Some answers are missing. Check the highlighted sections and submit again.",
  recipients_required: "Pick at least one manager or salesperson to follow this up.",
  missing_request_key: "Reload the page and file the report again.",
  report_not_claimed: "The report could not be saved completely. Submit it again — nothing will be duplicated.",
};

export async function resolveFieldReport(payload) {
  let res;
  try {
    res = await base44.functions.invoke("resolveFieldReport", payload);
  } catch (e) {
    const code = e?.response?.data?.error;
    throw new Error(MESSAGES[code] || code || e?.message || "The report action failed.");
  }
  const code = res?.data?.error;
  if (code) throw new Error(MESSAGES[code] || `The report action failed: ${code}`);
  return res.data;
}
