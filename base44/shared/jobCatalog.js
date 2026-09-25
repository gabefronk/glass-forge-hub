const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 50;

/** Read a complete entity. A full last page is not proof that the read is complete. */
export async function fetchCompleteEntity(entity, { sort = '-created_date', pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES } = {}) {
  if (!entity || typeof entity.list !== 'function') throw new TypeError('A listable entity is required.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(maxPages) || maxPages < 1) throw new TypeError('Invalid pagination options.');
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await entity.list(sort, pageSize, page * pageSize);
    if (!Array.isArray(batch) || batch.length > pageSize) throw new Error('Entity pagination returned an invalid page.');
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error(`Entity pagination reached ${maxPages} pages; completeness could not be verified.`);
}

const values = value => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
const searchable = value => String(value || '').trim().toLocaleLowerCase();

/** Search every stable job identifier shown by Hub pickers. */
export function jobMatchesSearch(job, query, yaPurchaseOrders = []) {
  const needle = searchable(query);
  if (!needle) return true;
  const fields = [
    job?.id,
    job?.canonical_name,
    ...values(job?.aliases),
    ...values(job?.po_numbers), // BFS POs
    ...values(job?.oe_numbers),
    ...values(job?.ya_po_numbers),
    ...values(yaPurchaseOrders),
  ];
  return fields.some(value => searchable(value).includes(needle));
}

export function filterJobPickerOptions(jobs, query, { selectedId = '', yaPurchaseOrdersByJob = new Map() } = {}) {
  return values(jobs).filter(job =>
    String(job?.id || '') === String(selectedId || '') || jobMatchesSearch(job, query, yaPurchaseOrdersByJob.get(job?.id) || [])
  );
}

/** Conservative budget/plan-inbox matching over an already complete catalog. */
export function matchJobTokens(jobs, tokens, normalize) {
  if (!Array.isArray(tokens) || !tokens.length) return { status: 'needs_review', reason: 'no usable match tokens on quote', candidates: [] };
  const scored = [];
  for (const job of values(jobs)) {
    const hay = normalize([job.canonical_name, job.builder, job.customer_name, job.address].filter(Boolean).join(' '));
    const hits = tokens.filter(token => hay.includes(token));
    if (hits.length) scored.push({ id: job.id, name: job.canonical_name, hits, score: hits.length });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) {
    return { status: 'matched', job_id: scored[0].id, job_name: scored[0].name, hits: scored[0].hits, candidates: scored.slice(0, 5) };
  }
  return { status: 'needs_review', reason: scored.length ? 'several jobs match the quote tokens' : 'no Hub job matches the quote tokens', candidates: scored.slice(0, 5) };
}
