// Shared pagination helper for backend functions.
// Use this when you need ALL records (duplicate detection, cross-job aggregates).
// Pages walk the records by id (keyset: filter id > last id, sorted by id), never by
// skip on a sort field: many records share a created_date (bulk creates), and skip on
// a tied sort repeats or misses rows between pages. The ids are unique and ascending,
// so every record is read exactly once. The rows are then sorted by `sort` (id breaks
// ties) so callers keep the order they asked for. Works with every SDK version
// (array-form filter(query, sort, limit)).
// Safety cap at 50 pages (50k rows at pageSize 1000) prevents infinite loops.
// Reaching a full final page throws: partial results must not appear complete.
export async function fetchAllPages(entity: any, sort = '-created_date', pageSize = 1000): Promise<any[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid pagination page size.');
  const all: any[] = [];
  let after: string | null = null;
  for (let i = 0; i < 50; i++) {
    const batch = await entity.filter(after == null ? {} : { id: { $gt: after } }, 'id', pageSize);
    if (!Array.isArray(batch) || batch.length > pageSize) throw new Error('Entity pagination returned an invalid page.');
    for (const row of batch) {
      const id = row && row.id != null ? String(row.id) : '';
      if (!id || (after != null && id <= after)) throw new Error('Entity pagination returned rows out of id order.');
      after = id;
    }
    all.push(...batch);
    if (batch.length < pageSize) return sortRows(all, sort);
  }
  throw new Error('Entity pagination exceeded 50 pages; completeness is not verified.');
}

// Mongo-like order: missing/null first ascending, then numbers, then everything else as text.
const rank = (v: any) => (v == null || v === '' ? 0 : typeof v === 'number' ? 1 : 2);
function compareValues(a: any, b: any): number {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  if (ra === 1) return a - b;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function sortRows(rows: any[], sort = '-created_date'): any[] {
  const spec = String(sort || '').trim();
  const desc = spec.startsWith('-');
  const field = spec.replace(/^[-+]/, '');
  const dir = desc ? -1 : 1;
  return rows.sort((x, y) => dir * ((field ? compareValues(x?.[field], y?.[field]) : 0) || compareValues(String(x?.id), String(y?.id))));
}
