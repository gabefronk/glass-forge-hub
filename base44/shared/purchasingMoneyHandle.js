// Injectable request handler for the purchasingMoney endpoint. No SDK, no
// I/O beyond the injected adapter — so tests can mock every entity read/write.
// entry.ts builds the real adapter and wraps the result into a Response.
//
// SDK contract (installed @base44/sdk 0.8.53, entities.types.d.ts):
// list(options)/filter(query, options) with an options object resolve to an
// EntityPage { items, next_cursor: string|null, has_more: boolean }. A plain
// array means the cursor contract was not honoured; a full array cannot prove
// completeness, so arrays are rejected (fail closed).
//
// Fail-closed rules:
//  - Pages: items must be an array no longer than the requested limit,
//    has_more a boolean; has_more=true needs a fresh non-empty cursor;
//    has_more=false needs next_cursor === null; truncated=true is rejected.
//    Repeated cursors and more than MAX_PAGES pages are rejected.
//  - Stored rows must carry exact ids; a malformed amount withholds that job.
//  - Read-only since Oct 24: the budget is the job's money source, so the old
//    "save" (the retired Edit money button) is gone. list stays only as the
//    fallback for jobs whose sale has no budget yet.
//  - Errors return fixed safe codes only; raw SDK error text is never returned.
import {
  isPurchasingMoneyOwner, validateListBody, parseStoredRow, sanitizeInput,
} from './purchasingMoneyPure.js';

export const LIST_LIMIT = 500;
export const MAX_PAGES = 200;

export class SafeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new SafeError(code); };

export function readPage(page, limit) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) fail('invalid_page');
  if (!Array.isArray(page.items) || typeof page.has_more !== 'boolean') fail('invalid_page');
  if (page.truncated === true) fail('page_truncated');
  if (page.items.length > limit) fail('invalid_page');
  if (page.has_more) {
    if (typeof page.next_cursor !== 'string' || !page.next_cursor) fail('cursor_truncated');
  } else if (page.next_cursor !== null) {
    fail('cursor_inconsistent');
  }
  return { items: page.items, next: page.has_more ? page.next_cursor : null };
}

async function listMoney(adapter) {
  const rows = [];
  const seenCursors = new Set();
  let cursor = null;
  for (let i = 0; ; i++) {
    if (i >= MAX_PAGES) fail('list_unbounded');
    const opts = cursor ? { limit: LIST_LIMIT, cursor } : { sort: '-updated_date', limit: LIST_LIMIT };
    const { items, next } = readPage(await adapter.moneyList(opts), LIST_LIMIT);
    rows.push(...items);
    if (!next) break;
    if (seenCursors.has(next)) fail('cursor_repeated');
    seenCursors.add(next);
    cursor = next;
  }
  const byJob = new Map();
  const duplicates = new Set();
  const invalid = new Set();
  for (const raw of rows) {
    const parsed = parseStoredRow(raw);
    if (!parsed.ok && parsed.reason === 'invalid_identity') fail('invalid_row');
    const jobId = parsed.ok ? parsed.row.job_id : parsed.job_id;
    if (!parsed.ok) invalid.add(jobId);
    if (byJob.has(jobId)) duplicates.add(jobId);
    else byJob.set(jobId, parsed.ok ? parsed.row : { id: raw.id, job_id: jobId, rough_labor_material: null, sale_price: null });
  }
  const inputs = [];
  for (const [jobId, row] of byJob) {
    if (duplicates.has(jobId)) inputs.push({ ...row, duplicate: true, rough_labor_material: null, sale_price: null });
    else if (invalid.has(jobId)) inputs.push({ ...row, invalid: true, rough_labor_material: null, sale_price: null });
    else inputs.push(row);
  }
  return { inputs, duplicates: [...duplicates], invalid: [...invalid] };
}

const safeCode = (e, fallback) => (e instanceof SafeError ? e.code : fallback);

export async function handle(req, adapter) {
  // 1. Auth by id BEFORE any entity read.
  const user = await adapter.authMe().catch(() => null);
  if (!isPurchasingMoneyOwner(user)) return { status: 403, body: { error: 'forbidden' } };

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === 'list') {
    const v = validateListBody(body);
    if (!v.ok) return { status: 400, body: { error: v.error } };
    try {
      return { status: 200, body: await listMoney(adapter) };
    } catch (e) {
      return { status: 500, body: { error: safeCode(e, 'list_failed') } };
    }
  }

  return { status: 400, body: { error: 'unknown_action' } };
}