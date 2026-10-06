// Pure, injectable field-reports loader for a job group. No base44 import —
// the reader is injected so this is unit-testable. The reader must implement
// the SDK options-form filter contract:
//   reader(query, { sort, limit, cursor }) -> { items, next_cursor, has_more }
//
// Matching mirrors reportsForJob() in jobGroupData.js (no rule changes):
//   - direct: reports whose job_id is a member (fresh scoped query per member)
//   - post-id edge: reports whose post_id matches one of this job's FeeLines
//     (fresh scoped query), excluding any with an explicit foreign job_id
//   - legacy-name edge: reports from the hub's preloaded collection whose
//     job_name matches a unique legacy name (no fresh full scan in the workspace)
// Reports with an explicit job_id on another job are never included. Results
// are deduped by exact id; report/photo associations are retained. Read errors
// and a max-page cap throw (never a silent partial []).

const MAX_PAGES = 50;
const PAGE_LIMIT = 2000;

const normName = (s) => String(s || "").trim().toLowerCase();

// Paginate a scoped query by cursor. Dedupes by id within the query. Throws on
// a truncated page (has_more without a cursor), a repeated cursor, and when the
// page cap is hit, so completeness is never silently lost.
export async function paginateFieldReports(reader, query, { sort = "-created_date", limit = PAGE_LIMIT, maxPages = MAX_PAGES } = {}) {
  const out = [];
  const seen = new Set();
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const res = await reader(query, { sort, limit, cursor });
    const items = (res && res.items) || [];
    for (const r of items) {
      if (r && r.id && !seen.has(r.id)) { seen.add(r.id); out.push(r); }
    }
    if (!res || !res.has_more) return out;
    if (!res.next_cursor) throw new Error("FieldReports pagination truncated (more records exist but no cursor was returned)");
    if (cursor === res.next_cursor) throw new Error("FieldReports pagination stalled (cursor repeated)");
    cursor = res.next_cursor;
  }
  throw new Error(`FieldReports pagination exceeded ${maxPages} pages; completeness is not verified`);
}

// Core loader. reader is injectable; all other args mirror loadJobFieldReports.
export async function loadFieldReportsCore(reader, { memberIds, postIds = [], preloadedAllReports = null, legacyNames = [], limit, maxPages } = {}) {
  const members = new Set(memberIds || []);
  const postSet = new Set(postIds || []);
  const legacySet = new Set((legacyNames || []).map(normName).filter(Boolean));
  const opts = limit || maxPages ? { limit, maxPages } : {};

  // Direct: fresh scoped query per member job_id.
  const direct = [];
  for (const id of [...members]) {
    const rows = await paginateFieldReports(reader, { job_id: id }, opts);
    for (const r of rows) direct.push(r);
  }

  // Post-id edge: fresh scoped query by post_id. Exclude reports already found
  // directly and any with an explicit foreign job_id (a report filed under
  // another job belongs to that job, not this one).
  let postIdEdge = [];
  if (postSet.size) {
    const directIds = new Set(direct.map((r) => r.id));
    const all = await paginateFieldReports(reader, { post_id: { $in: [...postSet] } }, opts);
    postIdEdge = all.filter((r) => {
      if (directIds.has(r.id)) return false;
      if (r.job_id && !members.has(r.job_id)) return false;
      return true;
    });
  }

  // Legacy-name edge: from the preloaded hub collection only (no fresh full
  // scan in the workspace). Normalize consistently with reportsForJob. Exclude
  // already-found reports and any with an explicit foreign job_id.
  const seen = new Set([...direct, ...postIdEdge].map((r) => r.id));
  const legacyEdge = (preloadedAllReports || []).filter((r) => {
    if (seen.has(r.id)) return false;
    if (r.job_id && !members.has(r.job_id)) return false;
    return legacySet.has(normName(r.job_name));
  });

  // Final dedupe by exact id, preserve order, retain photos.
  const finalSeen = new Set();
  const out = [];
  for (const r of [...direct, ...postIdEdge, ...legacyEdge]) {
    if (r && r.id && !finalSeen.has(r.id)) { finalSeen.add(r.id); out.push(r); }
  }
  return out;
}