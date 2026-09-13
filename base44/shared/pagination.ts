// Shared pagination helper for backend functions.
// The SDK's list() supports a third `skip` parameter; filter() does NOT.
// Use this when you need ALL records (duplicate detection, cross-job aggregates).
// Safety cap at 50 pages (50k rows at pageSize 1000) prevents infinite loops.
// Reaching a full final page throws: partial results must not appear complete.
export async function fetchAllPages(entity: any, sort = '-created_date', pageSize = 1000): Promise<any[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid pagination page size.');
  const all: any[] = [];
  let skip = 0;
  for (let i = 0; i < 50; i++) {
    const batch = await entity.list(sort, pageSize, skip);
    if (!Array.isArray(batch) || batch.length > pageSize) throw new Error('Entity pagination returned an invalid page.');
    all.push(...batch);
    if (batch.length < pageSize) return all;
    skip += pageSize;
  }
  throw new Error('Entity pagination exceeded 50 pages; completeness is not verified.');
}
