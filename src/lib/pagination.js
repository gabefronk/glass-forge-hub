/**
 * Fetch all pages of an entity using list() with skip-based pagination.
 *
 * The SDK's list() supports a third `skip` parameter; filter() does NOT.
 * Use this only when you genuinely need ALL records (cross-job aggregates,
 * full timelines). For month-scoped or job-scoped views, prefer filter()
 * with a high limit — a single month or job will never approach 5000 rows.
 *
 * Safety cap at 50 pages (50,000 rows at pageSize 1000) prevents infinite
 * loops on a bug.
 */
export async function fetchAllPages(entity, sort = '-created_date', pageSize = 1000) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Invalid pagination page size.");
  const all = [];
  let skip = 0;
  for (let i = 0; i < 50; i++) {
    const batch = await entity.list(sort, pageSize, skip);
    if (!Array.isArray(batch) || batch.length > pageSize) throw new Error("Entity pagination returned an invalid page.");
    all.push(...batch);
    if (batch.length < pageSize) return all;
    skip += pageSize;
  }
  throw new Error("Entity pagination exceeded 50 pages; completeness is not verified.");
}
