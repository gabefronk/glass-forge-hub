// Fail-closed page reading shared by the purchasing backends (purchasingQuoteIngest,
// customerCollections). No SDK, no I/O. (The file keeps its old name; the
// purchasingMoney endpoint it was written for was retired Oct 24.)
//
// SDK contract (installed @base44/sdk 0.8.53, entities.types.d.ts):
// list(options)/filter(query, options) with an options object resolve to an
// EntityPage { items, next_cursor: string|null, has_more: boolean }. A plain
// array means the cursor contract was not honoured; a full array cannot prove
// completeness, so arrays are rejected (fail closed). items must be an array no
// longer than the requested limit, has_more a boolean; has_more=true needs a fresh
// non-empty cursor; has_more=false needs next_cursor === null; truncated=true is
// rejected. Errors carry fixed safe codes only; raw SDK error text is never returned.

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
