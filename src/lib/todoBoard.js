// Pure logic for the To-do board (no React, no "@/" imports, so node tests load it directly).
// Lane keys match TodoTask.category values validated by base44/shared/todoService.mjs.

export const BOARD_LANES = [
  { key: "quote_request", label: "Quote Requests", hint: "Quotes to price, prepare or send", accent: "#0B3F3B" },
  { key: "odd_end", label: "Odd End Items", hint: "Small fixes, punch items and loose ends", accent: "#B8955A" },
  { key: "order", label: "Orders to Place", hint: "Windows, glass and parts to order", accent: "#89511A" },
  { key: "follow_up", label: "Follow-ups", hint: "Calls, emails and check-ins owed", accent: "#34506A" },
];

// Tasks with no category (created before the board existed) or an unknown one.
export const UNCATEGORIZED_LANE = { key: "", label: "Needs a category", hint: "Pick a lane so these are not missed", accent: "#A43432" };

const LANE_KEYS = new Set(BOARD_LANES.map((l) => l.key));
export const laneKey = (task) => (LANE_KEYS.has(task?.category) ? task.category : "");
export const laneLabel = (key) => (BOARD_LANES.find((l) => l.key === key) || UNCATEGORIZED_LANE).label;

// An open task with no due date that has waited this long is flagged so it is not forgotten.
export const STALE_DAYS = 7;
const DUE_SOON_DAYS = 3;
const DAY_MS = 86400000;

function dayNumber(ymd) {
  const t = Date.parse(String(ymd || "").slice(0, 10) + "T12:00:00Z");
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

// Whole days from a (YYYY-MM-DD or ISO) date to `today` (YYYY-MM-DD, Denver calendar day).
export function daysBetween(fromDate, today) {
  const a = dayNumber(fromDate), b = dayNumber(today);
  return a === null || b === null ? null : b - a;
}

// "overdue" | "today" | "soon" (within 3 days) | "later" | "none"
export function dueState(task, today) {
  if (!task?.due_date) return "none";
  const days = daysBetween(today, task.due_date);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= DUE_SOON_DAYS) return "soon";
  return "later";
}

export function isStale(task, today) {
  if (task?.status !== "open") return false;
  if (["overdue", "today", "soon"].includes(dueState(task, today))) return false;
  const age = daysBetween(task.created_at, today);
  return age !== null && age >= STALE_DAYS;
}

const RANK = { overdue: 0, today: 1, soon: 2, later: 3, none: 4 };

// Most urgent first: overdue, due today, due soon; within each, work already in
// progress first, then the earliest due date, then the oldest task (most likely forgotten).
export function compareUrgency(today) {
  return (a, b) =>
    RANK[dueState(a, today)] - RANK[dueState(b, today)] ||
    Number(b.status === "in_progress") - Number(a.status === "in_progress") ||
    String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")) ||
    String(a.created_at || "").localeCompare(String(b.created_at || ""));
}

export function sortByUrgency(tasks, today) {
  return [...(tasks || [])].sort(compareUrgency(today));
}

function laneStats(tasks, today) {
  return {
    overdue: tasks.filter((t) => dueState(t, today) === "overdue").length,
    dueToday: tasks.filter((t) => dueState(t, today) === "today").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    stale: tasks.filter((t) => isStale(t, today)).length,
  };
}

// Active (not done) tasks grouped into the four lanes, plus the uncategorized lane
// only when it has tasks. Each lane is sorted by urgency and carries its counts.
export function buildBoard(tasks, today) {
  const active = (tasks || []).filter((t) => t && t.status !== "done" && !t.archived_at);
  const lanes = BOARD_LANES.map((lane) => {
    const items = sortByUrgency(active.filter((t) => laneKey(t) === lane.key), today);
    return { ...lane, tasks: items, ...laneStats(items, today) };
  });
  const loose = sortByUrgency(active.filter((t) => laneKey(t) === ""), today);
  const uncategorized = loose.length ? { ...UNCATEGORIZED_LANE, tasks: loose, ...laneStats(loose, today) } : null;
  return { lanes, uncategorized, summary: { total: active.length, ...laneStats(active, today) } };
}
