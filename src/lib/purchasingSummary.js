// Totals + filters for the Purchasing summary bar. Pure: no React, no SDK.
// Totals add only figures that are actually showing on the rows (the same
// display values the table renders), so the bar always ties to the rows below.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (cards, pick) => cards.reduce((s, c) => s + (num(pick(c)) ?? 0), 0);

export function summarizeCards(cards = []) {
  return {
    jobs: cards.length,
    windows: sum(cards, (c) => c.windows?.display?.value),
    rough: sum(cards, (c) => c.rough?.display?.value),
    sale: sum(cards, (c) => c.sale?.display?.value),
    profit: sum(cards, (c) => c.profitDisplay?.value),
    quotes: cards.filter((c) => c.refs?.quoteNumber).length,
    pos: cards.filter((c) => c.refs?.yaPo).length,
    // Jobs whose roll-up row withholds multi-scope money: the totals then
    // exclude those amounts, so the bar must say it is partial.
    partialScopes: cards.filter((c) =>
      [c.windows?.display, c.rough?.display, c.sale?.display, c.profitDisplay].some((d) => d?.suppressed)).length,
  };
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