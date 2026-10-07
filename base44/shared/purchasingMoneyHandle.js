// Injectable request handler for the purchasingMoney endpoint. No SDK, no
// I/O beyond the injected adapter — so tests can mock every entity read/write
// and prove auth-before-read, fail-closed reads, duplicate withholding, exact
// writes and readback. entry.ts builds the real adapter and wraps the result
// into a Response.
//
// Fail-closed rules:
//  - list: explicit cursor pagination until has_more is false. Unknown
//    response shape, a truncated page (has_more with no next_cursor), or an
//    unbounded loop throw. Duplicate job_id rows are withheld (values nulled)
//    and flagged for review — never last-row-wins.
//  - save: fresh recheck of existing rows before any write. Duplicate existing
//    rows withhold the write. A money key omitted from the payload is preserved
//    (never wiped). The returned input is a readback, never fabricated.
import {
  isPurchasingMoneyOwner, validateSavePayload, validateListBody, sanitizeInput,
} from './purchasingMoneyPure.js';

async function listMoney(adapter) {
  const all = [];
  let cursor;
  for (;;) {
    const page = await adapter.moneyList({ sort: '-updated_date', limit: 500, cursor });
    let items, next, hasMore;
    if (Array.isArray(page)) { items = page; next = undefined; hasMore = false; }
    else if (page && Array.isArray(page.items)) { items = page.items; next = page.next_cursor; hasMore = !!page.has_more; }
    else throw new Error('invalid_list_response');
    if (!Array.isArray(items)) throw new Error('invalid_list_response');
    all.push(...items);
    if (!hasMore) break;
    if (!next) throw new Error('cursor_truncated');
    cursor = next;
    if (all.length > 100000) throw new Error('list_overflow');
  }
  const seen = new Map();
  const duplicates = new Set();
  for (const row of all) {
    const s = sanitizeInput(row);
    if (!s || !s.job_id) continue;
    if (seen.has(s.job_id)) duplicates.add(s.job_id);
    else seen.set(s.job_id, s);
  }
  const inputs = [];
  for (const [jobId, row] of seen) {
    if (duplicates.has(jobId)) inputs.push({ ...row, duplicate: true, rough_labor_material: null, sale_price: null });
    else inputs.push(row);
  }
  return { inputs, duplicates: [...duplicates] };
}

async function saveMoney(adapter, parsed) {
  const job = await adapter.jobsGet(parsed.job_id).catch(() => null);
  if (!job) return { error: 'job_not_found' };
  if (job.merged_into) return { error: 'job_merged' };
  if (job.is_sample) return { error: 'sample_job' };

  // Fresh recheck of existing money rows for this exact job. Fail closed on
  // an unknown shape; withhold the write on duplicates or a truncated page.
  const page = await adapter.moneyFilter({ job_id: parsed.job_id }, { sort: '-updated_date', limit: 50 }).catch(() => null);
  let rows;
  if (Array.isArray(page)) rows = page;
  else if (page && Array.isArray(page.items)) { rows = page.items; if (page.has_more) return { error: 'duplicate_money' }; }
  else return { error: 'money_lookup_failed' };
  if (rows.length > 1) return { error: 'duplicate_money' };

  // Partial patch: only keys present in the payload are written. Omitted
  // keys preserve the existing row — never wipe.
  const patch = {};
  if (parsed.hasRough) patch.rough_labor_material = parsed.rough_labor_material;
  if (parsed.hasSale) patch.sale_price = parsed.sale_price;

  let savedId;
  if (rows.length === 1) {
    savedId = rows[0].id;
    await adapter.moneyUpdate(savedId, patch);
  } else {
    const created = await adapter.moneyCreate({ job_id: parsed.job_id, ...patch });
    if (!created?.id) return { error: 'create_failed' };
    savedId = created.id;
  }
  // Read back the stored row and return the sanitized readback — never fabricated.
  const readback = await adapter.moneyGet(savedId).catch(() => null);
  if (!readback) return { error: 'readback_failed' };
  return { input: sanitizeInput(readback) };
}

export async function handle(req, adapter) {
  // 1. Auth by id BEFORE any entity read. Null (scheduled) and non-owners
  //    are rejected with 403 before a single row is read or written.
  const user = await adapter.authMe().catch(() => null);
  if (!isPurchasingMoneyOwner(user)) return { status: 403, body: { error: 'forbidden' } };

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'list') {
    const v = validateListBody(body);
    if (!v.ok) return { status: 400, body: { error: v.error } };
    try {
      const { inputs, duplicates } = await listMoney(adapter);
      return { status: 200, body: { inputs, duplicates } };
    } catch (e) {
      return { status: 500, body: { error: e?.message || 'list_failed' } };
    }
  }

  if (action === 'save') {
    const parsed = validateSavePayload(body);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    try {
      const result = await saveMoney(adapter, parsed);
      if (result.error) return { status: 400, body: { error: result.error } };
      return { status: 200, body: { input: result.input } };
    } catch (e) {
      return { status: 500, body: { error: e?.message || 'save_failed' } };
    }
  }

  return { status: 400, body: { error: 'unknown_action' } };
}