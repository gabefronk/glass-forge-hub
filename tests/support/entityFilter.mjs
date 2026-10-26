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
  if (typeof sort === 'string' && sort) {
    const desc = String(sort).startsWith('-');
    const key = String(sort).replace(/^[-+]/, '');
    const cmp = (a, b) => { const x = String(a[key] ?? ''), y = String(b[key] ?? ''); return x < y ? -1 : x > y ? 1 : 0; };
    out = [...out].sort((a, b) => cmp(a, b) * (desc ? -1 : 1));
  }
  return typeof limit === 'number' ? out.slice(0, limit) : out;
}
