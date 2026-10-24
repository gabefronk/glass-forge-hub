// Totals + filters for the Purchasing summary bar. Pure: no React, no SDK.
// Totals add only figures that are actually showing on the rows (the same
// display values the table renders), so the bar always ties to the rows below.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (n) => Math.round(n * 100) / 100;

// Each money column: a job row's own figure, or, when a multi-scope job row
// withholds it (applyScopeRollup), the figures its scope rows show. Scope rows
// never overlap (each PO and order belongs to one scope) and share one cost
// basis (materials incl tax), so adding them ties the bar to the rows below.
const FIELDS = {
  windows: { job: (c) => c.windows?.display, scope: (s) => s.windows },
  rough: { job: (c) => c.rough?.display, scope: (s) => s.rough },
  sale: { job: (c) => c.sale?.display, scope: (s) => s.sale },
  profit: { job: (c) => c.profitDisplay, scope: (s) => s.profit },
};

function column(card, field) {
  const f = FIELDS[field];
  const own = f.job(card);
  if (!own?.suppressed) return { value: num(own?.value) ?? 0, missing: false };
  const values = (card.scopes || []).map((s) => num(f.scope(s)?.value));
  return { value: values.reduce((n, v) => n + (v ?? 0), 0), missing: !values.length || values.some((v) => v == null) };
}

export function summarizeCards(cards = []) {
  const totals = { jobs: cards.length };
  const incomplete = new Set();
  for (const field of Object.keys(FIELDS)) {
    totals[field] = round(cards.reduce((n, c) => {
      const col = column(c, field);
      if (col.missing) incomplete.add(c);
      return n + col.value;
    }, 0));
  }
  totals.quotes = cards.filter((c) => c.refs?.quoteNumber).length;
  totals.pos = cards.filter((c) => c.refs?.yaPo).length;
  // Multi-scope jobs with a scope row that has no figure for a column: the
  // bar then says it is partial instead of reading as a complete total.
  totals.partialScopes = incomplete.size;
  return totals;
}

// ETA filter buckets, read from the same refs the ETA cell shows.
export const ETA_FILTERS = [
  { key: 'all', label: 'All ETAs' },
  { key: 'none', label: 'No ETA yet' },
  { key: 'upcoming', label: 'ETA set' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'delivered', label: 'Delivered' },
];

export function etaBucket(card, today = '') {
  const label = card?.refs?.etaLabel || '';
  if (label === 'Delivered') return 'delivered';
  if (!label) return 'none';
  if (/^\d{4}-\d{2}-\d{2}$/.test(label) && today && label < today) return 'overdue';
  return 'upcoming';
}

// Payment filter: the job's customer payment stage, or 'none' when untracked.
export function paymentKey(card, jobsById) {
  return jobsById?.get(card?.job?.id)?.payment_status || 'none';
}

export function applySummaryFilters(cards, { eta = 'all', payment = 'all' } = {}, { jobsById, today } = {}) {
  return cards.filter((c) =>
    (eta === 'all' || etaBucket(c, today) === eta) &&
    (payment === 'all' || paymentKey(c, jobsById) === payment));
}