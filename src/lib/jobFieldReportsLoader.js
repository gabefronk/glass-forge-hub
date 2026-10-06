// Pure, injectable field-reports loader for a job group. No base44 import.
//
// Reader contract (matches the documented SDK positional form
//   filter(filter, sort?, limit?, skip?, fields?) -> array):
//   reader(query, { sort, limit, skip }) -> array of records
// The workspace passes a thin adapter that forwards positionally:
//   (query, opts) => FieldReports.filter(query, opts.sort, opts.limit, opts.skip)
//
// Matching mirrors reportsForJob() (no rule changes):
//   - direct: reports whose job_id is a member (fresh scoped query per member)
//   - post-id edge: reports whose post_id matches one of this job's FeeLines
//     (fresh scoped query), excluding any with an explicit foreign job_id
//   - legacy-name edge: when the hub's preloaded collection is available, use
//     it (no fresh full scan). When preloaded is ABSENT (the main Jobs/workspace
//     situation) and unique legacy names exist, do a bounded complete read of
//     unlinked (job_id null) reports and filter by normalized name — the SDK
//     string filter is exact, so a scoped exact-name query would miss case and
//     whitespace variants. The read is bounded by the pagination cap; a cap hit
//     throws a completeness error rather than silently returning a partial set.
// Reports with an explicit job_id on another job are never included. Results
// are deduped by exact id; report/photo associations are retained.

const MAX_PAGES = 50;
const PAGE_LIMIT = 2000;

const normName = (s) => String(s || "").trim().toLowerCase();

// Skip-based pagination over a positional array reader. Stops when a page is
// shorter than limit (last page). Throws on a non-array response, when the
// reader ignores skip (same page returned again), and when the page cap is hit.
export async function paginateFieldReports(reader, query, { sort = "-created_date", limit = PAGE_LIMIT, maxPages = MAX_PAGES } = {}) {
  const out = [];
  const seen = new Set();
  let prevIds = null;
  for (let page = 0; page < maxPages; page++) {
    const res = await reader(query, { sort, limit, skip: page * limit });
    if (!Array.isArray(res)) throw new Error("FieldReports reader returned a non-array response; cannot paginate");
    const ids = res.map((r) => r && r.id).filter(Boolean);
    if (prevIds && ids.length && prevIds.size === ids.length && ids.every((id) => prevIds.has(id))) {
      throw new Error("FieldReports pagination stalled (skip ignored — same page returned again)");
    }
    for (const r of res) {
      if (r && r.id && !seen.has(r.id)) { seen.add(r.id); out.push(r); }
    }
    if (res.length < limit) return out; // last page
    prevIds = new Set(ids);
  }
  throw new Error(`FieldReports pagination exceeded ${maxPages} pages; completeness is not verified`);
}

export async function loadFieldReportsCore(reader, { memberIds, postIds = [], preloadedAllReports = null, legacyNames = [], limit, maxPages } = {}) {
  const members = new Set(memberIds || []);
  const postSet = new Set(postIds || []);
  const legacySet = new Set((legacyNames || []).map(normName).filter(Boolean));
  const opts = { limit, maxPages };

  // Direct: fresh scoped query per member job_id.
  const direct = [];
  for (const id of [...members]) {
    const rows = await paginateFieldReports(reader, { job_id: id }, opts);
    for (const r of rows) direct.push(r);
  }
  const directIds = new Set(direct.map((r) => r.id));

  // Post-id edge: fresh scoped query by post_id. Exclude reports already found
  // directly and any with an explicit foreign job_id.
  let postIdEdge = [];
  if (postSet.size) {
    const all = await paginateFieldReports(reader, { post_id: { $in: [...postSet] } }, opts);
    postIdEdge = all.filter((r) => {
      if (directIds.has(r.id)) return false;
      if (r.job_id && !members.has(r.job_id)) return false;
      return true;
    });
  }

  // Legacy-name edge.
  const seen = new Set([...direct, ...postIdEdge].map((r) => r.id));
  const legacyEdge = [];
  // From preloaded (no fresh scan) when available.
  for (const r of (preloadedAllReports || [])) {
    if (seen.has(r.id)) continue;
    if (r.job_id && !members.has(r.job_id)) continue;
    if (legacySet.has(normName(r.job_name))) { legacyEdge.push(r); seen.add(r.id); }
  }
  // Bounded complete fallback when preloaded is absent but legacy names exist
  // (the main Jobs/workspace situation): read unlinked (job_id null) reports
  // and filter by normalized name. The SDK string filter is exact, so a scoped
  // exact-name query would miss case/whitespace variants; this complete read is
  // bounded by the pagination cap.
  if (!preloadedAllReports && legacySet.size) {
    const unlinked = await paginateFieldReports(reader, { job_id: null }, opts);
    for (const r of unlinked) {
      if (seen.has(r.id)) continue;
      if (r.job_id && !members.has(r.job_id)) continue; // null -> passes
      if (legacySet.has(normName(r.job_name))) { legacyEdge.push(r); seen.add(r.id); }
    }
  }

  // Final dedupe by exact id, preserve order.
  const finalSeen = new Set();
  const out = [];
  for (const r of [...direct, ...postIdEdge, ...legacyEdge]) {
    if (r && r.id && !finalSeen.has(r.id)) { finalSeen.add(r.id); out.push(r); }
  }
  return out;
}