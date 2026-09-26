// Pure helpers for the Email tab (inbox agents). No React, no SDK: labels, relative
// time, status counts, client-side filtering and the small pieces of thread state the
// rows render. Kept here so they can be unit-tested (tests/emailInbox.test.mjs).

// Who sees the Email tab: admins and managers (owner-only mailboxes are filtered server-side).
export const canViewEmail = (user) => user?.role === "admin" || user?.role === "manager";

export const OPEN_STATUSES = ["new", "needs_reply", "waiting"];

export const STATUS_LABELS = { new: "New", needs_reply: "Needs reply", waiting: "Waiting", done: "Done", ignored: "Ignored" };

// Filter chips: "open" is the default view (everything not done or ignored).
export const STATUS_CHIPS = [
  { key: "open", label: "Open" },
  { key: "needs_reply", label: "Needs reply" },
  { key: "new", label: "New" },
  { key: "waiting", label: "Waiting" },
  { key: "done", label: "Done" },
  { key: "ignored", label: "Ignored" },
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

export function matchesStatus(thread, key) {
  if (!key || key === "all") return true;
  if (key === "open") return OPEN_STATUSES.includes(thread?.status);
  return thread?.status === key;
}

export function statusCounts(threads) {
  const counts = { all: 0, open: 0, new: 0, needs_reply: 0, waiting: 0, done: 0, ignored: 0 };
  for (const t of threads || []) {
    counts.all++;
    if (OPEN_STATUSES.includes(t.status)) counts.open++;
    if (t.status in counts) counts[t.status]++;
  }
  return counts;
}

const hay = (t) => [t.subject, t.from_name, t.from_email, t.account_hint, t.snippet, t.summary, t.job_name, ...(t.participants || []).map((p) => `${p.name || ""} ${p.email || ""}`)].filter(Boolean).join(" ").toLowerCase();

// Client-side narrowing of a list the server already scoped by mailbox. The search
// text is also sent to the server (q); matching here keeps the list right when the
// server ignores a filter it does not know.
export function filterThreads(threads, { status = "open", category = "", q = "", mailboxKey = "", jobIds = null } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  const jobs = jobIds ? new Set(jobIds.filter(Boolean)) : null;
  return (threads || []).filter((t) =>
    matchesStatus(t, status)
    && (!category || t.category === category)
    && (!mailboxKey || mailboxKey === "all" || t.mailbox_key === mailboxKey)
    && (!jobs || jobs.has(t.job_id))
    && (!needle || hay(t).includes(needle))
  );
}

// Urgent threads first, then newest message first.
export function sortThreads(threads) {
  const rank = (p) => (p === "urgent" ? 0 : p === "low" ? 2 : 1);
  return [...(threads || [])].sort((a, b) => rank(a.priority) - rank(b.priority) || String(b.last_message_at || "").localeCompare(String(a.last_message_at || "")));
}

export const threadsForJob = (threads, jobIds) => sortThreads(filterThreads(threads, { status: "all", jobIds: jobIds || [] }));

// What the draft chip says; null when there is nothing to show.
export function draftState(thread) {
  const s = thread?.draft_status;
  if (s === "drafted") return { key: "drafted", label: "Draft ready", tone: "amber" };
  if (s === "sent") return { key: "sent", label: "Reply sent", tone: "teal" };
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
