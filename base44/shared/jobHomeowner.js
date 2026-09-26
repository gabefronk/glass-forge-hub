// The job's homeowner slot (shown under the superintendent on the job page). Pure helpers
// shared by the contacts-directory function and the page; nothing here writes.
import {normalizeCustomer} from './jobIdentity.js';

const COMPANY_WORDS = /\b(home|builder|construction|const|contracting|contractor|development|dev|llc|inc|corp|company|co|group|estate|properties|property|services|windows?|glass|cash|test|integration|order|warranty|bfs|ya)\b/;

// Jobs.customer_name as a homeowner name, only when it names a person rather than the
// builder or a company ("DAVID WEEKLEY" on a Weekley job is the builder, not the owner).
export function homeownerPrefill(job) {
  const raw = String(job?.customer_name || "").trim().replace(/\s+/g, " ");
  if (!raw || raw.length > 80) return null;
  const name = raw.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const n = normalizeCustomer(name);
  if (!n || n === normalizeCustomer(job?.builder) || COMPANY_WORDS.test(n) || /\d/.test(n)) return null;
  const note = (raw.match(/\(([^)]*)\)/) || [])[1] || "";
  return { name, note, source: "customer_name" };
}

// Who to show in the homeowner slot: the saved homeowner, then a linked homeowner or customer,
// then a strong suggestion (owner view only), then the job's customer name as a starting point.
export function pickHomeowner({ saved, view, job } = {}) {
  if (saved?.name) return { ...saved, source: "linked" };
  const linked = (view?.linked || []).find((c) => c.role === "homeowner") || (view?.linked || []).find((c) => c.role === "customer");
  if (linked) return { key: linked.key, name: linked.name || "", phone: linked.phone || "", email: linked.email || "", source: "linked" };
  const sug = (view?.suggestions || []).find((s) => s.role === "homeowner" && s.contact?.key && !s.already_linked && s.confidence === "high");
  if (sug) return { key: sug.contact.key, name: sug.contact.name || "", phone: sug.contact.phone || "", email: sug.contact.email || "", source: "suggestion", reason: sug.reasons?.[0] || "" };
  const pre = homeownerPrefill(job);
  if (pre) return { key: "", name: pre.name, phone: "", email: "", source: "job", note: pre.note };
  return null;
}
