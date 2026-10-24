import { computeFeeAmt, computeLaborAmt } from './feeMath.js';

// Groups and sums for the Invoicing lines grid (M1b, Oct 24). Pure: the grid's day
// subtotal rows and its total row both come from here, and add labor and fee the
// same way the money bar does (computeLaborAmt / computeFeeAmt), so a subtotal of the
// lines under one Show filter ties to that filter's money bar segment.
const round = (n) => Math.round(n * 100) / 100;

export function lineSums(rows = []) {
  return {
    count: rows.length,
    labor: round(rows.reduce((n, r) => n + (computeLaborAmt(r) || 0), 0)),
    fee: round(rows.reduce((n, r) => n + (computeFeeAmt(r) || 0), 0)),
  };
}

// Date sort: one group per job day, oldest first, each with its subtotal. Fee sort:
// one ungrouped list, largest fee first.
export function groupLines(rows = [], sort = 'date') {
  if (sort === 'fee') {
    const sorted = [...rows].sort((a, b) => (computeFeeAmt(b) || 0) - (computeFeeAmt(a) || 0));
    return [{ date: null, rows: sorted, ...lineSums(sorted) }];
  }
  const groups = new Map();
  for (const r of rows) {
    const d = r.job_date || '—';
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(r);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rs]) => ({ date, rows: rs, ...lineSums(rs) }));
}

// "Oct 3" for the Date column; the day subtotal row carries the weekday.
export function shortDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '—';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// In-cell edits: labor in dollars, fee as a percent. Returns the FeeLines patch or
// null when the typed value is not a valid amount.
export function cellPatch(field, text) {
  const raw = String(text ?? '').replace(/[$,%\s]/g, '');
  if (raw === '' || !/^\d*\.?\d*$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (field === 'labor') return { labor_amt: round(n) };
  if (field === 'fee_pct') return n > 100 ? null : { fee_pct: Math.round(n * 100) / 10000 };
  return null;
}
