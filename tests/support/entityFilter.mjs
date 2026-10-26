// In-memory stand-in for the SDK's array-form filter(query, sort, limit), enough for
// fetchAllPages (base44/shared/pagination.ts): equality conditions plus $gt / $ne / $in,
// a single sort field ('-' for descending) and a limit. Rows are not copied.
const matches = (value, cond) => {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, v]) => {
      if (op === '$gt') return value != null && String(value) > String(v);
      if (op === '$ne') return value !== v;
      if (op === '$in') return v.includes(value);
      throw new Error(`entityFilter: unsupported operator ${op}`);
    });
  }
  return value === cond;
};

export function filterRows(rows, query = {}, sort, limit) {
  let out = rows.filter((r) => Object.entries(query || {}).every(([k, cond]) => matches(r[k], cond)));
  if (sort) {
    const desc = String(sort).startsWith('-');
    const key = String(sort).replace(/^[-+]/, '');
    out = [...out].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1));
  }
  return limit ? out.slice(0, limit) : out;
}
