// Display helpers for the job ⇄ contact join served by the contacts-directory function.
import { contactRole, highConfidenceSingleCandidateLinks } from "../../base44/shared/jobContacts.js";
export { highConfidenceSingleCandidateLinks };

export const ROLE_LABELS = {
  superintendent: "Superintendent",
  project_manager: "Project manager",
  site: "Site contact",
  homeowner: "Homeowner",
  builder: "Builder contact",
};
const ROLE_ORDER = ["superintendent", "project_manager", "site", "homeowner", "builder"];

export const CONFIDENCE_LABELS = { high: "Strong match", medium: "Likely", low: "Check first" };

// [[role, contacts], …] in display order, skipping empty roles.
export function groupByRole(linked) {
  return ROLE_ORDER.map((role) => [role, (linked || []).filter((c) => c.role === role)]).filter(([, list]) => list.length > 0);
}

export function statusOf(linked) {
  const superintendents = linked.filter((c) => c.role === "superintendent").length;
  return { linked: linked.length, superintendents, missing_contact: linked.length === 0, missing_superintendent: superintendents === 0, suggestions: 0 };
}

// The older `job` action (before `job_contacts` is published): linked contacts only, no suggestions.
export function viewFromLegacy(data, jobId) {
  const linked = (data?.contacts || []).map((c) => ({
    ...c,
    role: contactRole(c),
    link: (c.manual_job_ids || []).includes(jobId) ? "saved" : "workbook",
  }));
  return { job: { id: jobId }, directory: !data?.empty, legacy: true, messages: "unavailable", linked, suggestions: [], status: statusOf(linked) };
}

export function invokeErrorOf(error) {
  const data = error?.response?.data;
  return { status: error?.response?.status || 0, message: data?.error || data?.message || error?.message || "" };
}

export function suggestionTitle(s) {
  return s.contact?.name || s.seed?.name || s.participant?.phone || s.participant?.email || "Unknown contact";
}

// Preserve any supported role that the owner explicitly confirms with a suggestion.
export const confirmRoleOf = (s) => (["superintendent", "project_manager", "homeowner", "site"].includes(s.role) ? s.role : undefined);
