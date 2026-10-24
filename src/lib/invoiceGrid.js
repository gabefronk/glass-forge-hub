import { computeFeeAmt, computeLaborAmt } from './feeMath.js';

// Sorting, groups and sums for the Invoicing lines grid. Pure: the day subtotal rows and
// the total row come from here and add labor and fee the same way the money strip does
// (computeLaborAmt / computeFeeAmt), so a filter's total ties to its strip figure.
const round = (n) => Math.round(n * 100) / 100;

export function lineSums(rows = []) {
  return {
    count: rows.length,
    labor: round(rows.reduce((n, r) => n + (computeLaborAmt(r) || 0), 0)),
    fee: round(rows.reduce((n, r) => n + (computeFeeAmt(r) || 0), 0)),
  };
}

// Columns you can sort by clicking their header. Default: Fee, largest first.
export const SORT_KEYS = ['date', 'job', 'labor', 'fee'];
export const DEFAULT_SORT = { key: 'fee', dir: 'desc' };

const jobName = (r) => String(r.job_name_raw || r.job_name_norm || r.line_description || '').toLowerCase();
const VALUE = {
  date: (r) => r.job_date || '',
  job: jobName,
  labor: (r) => computeLaborAmt(r) || 0,
  fee: (r) => computeFeeAmt(r) || 0,
};

export function normalizeSort(sort) {
  if (sort && SORT_KEYS.includes(sort.key) && (sort.dir === 'asc' || sort.dir === 'desc')) return sort;
  return DEFAULT_SORT;
}

// Clicking the active header flips it; a new header starts largest-first for money and
// oldest-first / A-Z for date and job.
export function nextSort(current, key) {
  const cur = normalizeSort(current);
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'labor' || key === 'fee' ? 'desc' : 'asc' };
}

export function sortLines(rows = [], sort) {
  const { key, dir } = normalizeSort(sort);
  const get = VALUE[key];
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return c * sign || jobName(a).localeCompare(jobName(b));
  });
}

// Sorted by date: one group per job day with its subtotal (day order follows the sort).
// Any other sort: one ungrouped list.
export function groupLines(rows = [], sort) {
  const s = normalizeSort(sort);
  const sorted = sortLines(rows, s);
  if (s.key !== 'date') return [{ date: null, rows: sorted, ...lineSums(sorted) }];
  const groups = new Map();
  for (const r of sorted) {
    const d = r.job_date || '—';
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(r);
  }
  return [...groups.entries()].map(([date, rs]) => ({ date, rows: rs, ...lineSums(rs) }));
}

// "10/14" for the Date column (Gabe reads dates month/day).
export function shortDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

// Header checkbox state over the lines in the current filter.
export function selectionState(ids = [], selected = new Set()) {
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}
