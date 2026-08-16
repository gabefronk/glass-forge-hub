// Shared pagination helper for backend functions.
// The SDK's list() supports a third `skip` parameter; filter() does NOT.
// Use this when you need ALL records (duplicate detection, cross-job aggregates).
// Safety cap at 50 pages (50k rows at pageSize 1000) prevents infinite loops.
export async function fetchAllPages(entity: any, sort = '-created_date', pageSize = 1000): Promise<any[]> {
  const all: any[] = [];
  let skip = 0;
  for (let i = 0; i < 50; i++) {
    const batch = await entity.list(sort, pageSize, skip);
    all.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}