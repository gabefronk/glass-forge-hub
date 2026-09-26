// Pure helpers for the Inbox agents page (the EmailRelay ledger). No React, no SDK: labels,
// relative time, filtering and the small pieces of row state the page renders. The Hub keeps
// no mail here — every row is what an agent concluded and changed, with a link back to the
// mailbox. Unit-tested in tests/inboxAgents.test.mjs.

// The ledger is an owner tool. Managers can query the YA mailbox rows through the API
// (inbox_search) but the page lives under Admin.
export const canViewInboxAgents = (user) => user?.role === "admin";

export const OPEN_STATUSES = ["new", "needs_reply", "waiting"];

export const STATUS_LABELS = { new: "New", needs_reply: "Needs reply", waiting: "Waiting", done: "Done", ignored: "Ignored" };

export const STATUS_CHIPS = [
  { key: "open", label: "Open" },
  { key: "needs_reply", label: "Needs reply" },
  { key: "changed", label: "Changed the Hub" },
  { key: "unmatched", label: "Which job?" },
  { key: "all", label: "All" },
];

export const CATEGORY_LABELS = {
  job_update: "Job update",
  schedule: "Schedule",
  quote_request: "Quote request",
  order_vendor: "Vendor order",
  invoice_billing: "Invoice / billing",
  service_warranty: "Service / warranty",
  builder_admin: "Builder admin",
  personal: "Personal",
  newsletter_promo: "Newsletter / promo",
  spam: "Spam",
  other: "Other",
};
export const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

export const statusLabel = (s) => STATUS_LABELS[s] || (s ? String(s).replace(/_/g, " ") : "");
export const categoryLabel = (c) => CATEGORY_LABELS[c] || (c ? String(c).replace(/_/g, " ") : "Uncategorized");

// Category chip tone: which of the fee-UI tag palettes a category reads in.
export function categoryTone(category) {
  if (category === "quote_request" || category === "job_update" || category === "schedule") return "teal";
  if (category === "service_warranty" || category === "invoice_billing") return "amber";
  if (category === "spam" || category === "newsletter_promo") return "faint";
  return "neutral";
}

export const PRIORITY_COLOR = { urgent: "var(--gf-error)", normal: "var(--gf-teal-600)", low: "#CEC6B8" };
export const priorityColor = (p) => PRIORITY_COLOR[p] || PRIORITY_COLOR.normal;

export function providerLabel(provider) {
  if (provider === "gmail") return "Gmail";
  if (provider === "outlook") return "Outlook";
  return "mail";
}

// "just now", "5m", "3h", "2d", then a short date (with the year once it differs).
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now - t);
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(t), n = new Date(now);
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== n.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

// A row the owner may still want to act on: unmatched with candidates, or a low match.
export const needsJobPick = (e) => !e?.job_id && (e?.job_match_confidence === "low" || (Array.isArray(e?.job_candidates) && e.job_candidates.length > 0));

export function matchesChip(entry, key) {
  if (!key || key === "all") return true;
  if (key === "open") return OPEN_STATUSES.includes(entry?.status);
  if (key === "changed") return Array.isArray(entry?.hub_changes) && entry.hub_changes.length > 0;
  if (key === "unmatched") return needsJobPick(entry);
  return entry?.status === key;
}

export function chipCounts(entries) {
  const counts = { all: 0, open: 0, needs_reply: 0, changed: 0, unmatched: 0 };
  for (const e of entries || []) {
    counts.all++;
    if (OPEN_STATUSES.includes(e.status)) counts.open++;
    if (e.status === "needs_reply") counts.needs_reply++;
    if (matchesChip(e, "changed")) counts.changed++;
    if (needsJobPick(e)) counts.unmatched++;
  }
  return counts;
}

const hay = (e) => [e.subject, e.from_name, e.from_email, e.account_hint, e.summary, e.job_name, ...(e.hub_changes || []), ...(e.extracted?.po_numbers || []), ...(e.extracted?.oe_numbers || []), e.extracted?.builder, e.extracted?.lot, e.extracted?.address].filter(Boolean).join(" ").toLowerCase();

// Client-side narrowing of a list the server already scoped by mailbox. The search text is
// also sent to the server (q); matching here keeps the list right when the server ignores
// a filter it does not know.
export function filterEntries(entries, { chip = "open", category = "", q = "", mailboxKey = "" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  return (entries || []).filter((e) =>
    matchesChip(e, chip)
    && (!category || e.category === category)
    && (!mailboxKey || mailboxKey === "all" || e.mailbox_key === mailboxKey)
    && (!needle || hay(e).includes(needle))
  );
}

// Urgent first, then newest mail first.
export function sortEntries(entries) {
  const rank = (p) => (p === "urgent" ? 0 : p === "low" ? 2 : 1);
  return [...(entries || [])].sort((a, b) => rank(a.priority) - rank(b.priority) || String(b.last_message_at || "").localeCompare(String(a.last_message_at || "")));
}

// What the draft chip says; null when there is nothing to show. The draft itself lives in
// the mailbox, so the chip names where to find it.
export function draftState(entry, provider) {
  const s = entry?.draft_status;
  if (s === "drafted") return { key: "drafted", label: `Draft waiting in ${providerLabel(provider)}`, tone: "amber" };
  if (s === "discarded") return { key: "discarded", label: "Draft discarded", tone: "neutral" };
  return null;
}

// One line under a mailbox chip: "12 fetched · 3 classified · 2 drafted · 1 error".
export function syncSummary(run) {
  if (!run) return "";
  const parts = [];
  const add = (n, word) => { if (Number(n) > 0) parts.push(`${n} ${word}`); };
  add(run.fetched, "fetched");
  add(run.threads_updated, "updated");
  add(run.classified, "classified");
  add(run.relayed, "relayed");
  add(run.drafted, "drafted");
  add(run.archived, "archived");
  const errors = Array.isArray(run.errors) ? run.errors.length : Number(run.errors) || 0;
  if (errors) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  return parts.join(" · ");
}

export const mailboxName = (m) => m?.display_name || m?.address || m?.key || "Mailbox";

export function errorText(e, fallback = "Something went wrong. Reload and try again.") {
  return e?.response?.data?.detail || e?.response?.data?.error || e?.message || fallback;
}
