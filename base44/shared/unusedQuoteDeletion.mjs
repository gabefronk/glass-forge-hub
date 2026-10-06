import { text, budgetVersion } from './procurementCore.js';
import { procurementError } from './procurementLock.mjs';

// Deleting an unused attempt is reversible removal from active lists, not a
// cascade. Jobs, orders, accounting and source files are never changed here.
const containsId = (value, id) => {
  if (typeof value === 'string') return value.includes(id);
  if (Array.isArray(value)) return value.some(v => containsId(v, id));
  return value && typeof value === 'object' ? Object.values(value).some(v => containsId(v, id)) : false;
};
const exactQuote = (value, quote) => quote && text(value).toUpperCase().split(/[,;\s]+/).includes(quote);

export function unusedQuoteBlockers(row, sources = {}) {
  if (!text(row?.id)) return ['Quote not found.'];
  const required = ['budgets', 'purchaseOrders', 'vendorOrders', 'costInputs', 'setupSheets'];
  if (required.some(key => !Array.isArray(sources[key]))) return ['Linked records have not been completely checked.'];
  const blockers = [];
  if (text(row.job_id)) blockers.push('This quote is linked to a job. Keep it as a reference instead.');
  const quote = text(row.quote_number).toUpperCase();
  if (sources.purchaseOrders.some(p => containsId(p, row.id) || exactQuote(p.vendor_quote_ref, quote))) blockers.push('A purchase order uses this quote.');
  if (sources.vendorOrders.some(o => containsId(o, row.id) || exactQuote(o.quote_number, quote) || exactQuote(o.vendor_quote_ref, quote) || exactQuote(o.order_number, quote))) blockers.push('A supplier order uses this quote.');
  if (sources.costInputs.some(c => containsId(c, row.id) || exactQuote(c.quote_number, quote))) blockers.push('Accounting records use this quote.');
  if (sources.setupSheets.some(s => containsId(s, row.id) || exactQuote(s.quote_number, quote))) blockers.push('A job setup sheet uses this quote.');
  if (sources.budgets.some(b => b.id !== row.id && containsId({ replaces_budget_id: b.replaces_budget_id, link_history: b.link_history }, row.id))) blockers.push('Another quote references this version.');
  // Customer PO text is NOT a budget link. An abandoned draft can carry the
  // same YA number as the actual order while having a different quote number.
  return blockers;
}

export function unusedQuoteDeletionPatch(row, sources, body, actor, at) {
  if (body.review_confirmed !== true) throw procurementError(400, 'Confirm deleting this unused quote.');
  if (!body.expected_version || body.expected_version !== budgetVersion(row)) throw procurementError(409, 'This quote changed. Refresh before deleting.');
  if (text(row?.deleted_at)) throw procurementError(409, 'This quote is already deleted.');
  const blockers = unusedQuoteBlockers(row, sources);
  if (blockers.length) throw procurementError(409, blockers.join(' '));
  return {
    deleted_at: at,
    deleted_by: text(actor),
    deletion_reason: text(body.reason).slice(0, 500) || 'Unused quote attempt removed by owner.',
    deletion_request_key: text(body.request_key),
    budget_usage: 'reference',
    link_history: [...(row.link_history || []), {
      at, by: text(actor), action: 'delete unused quote',
      previous_budget_usage: row.budget_usage ?? null,
      note: 'Removed from active lists. Original values and Drive files retained for recovery. No linked records changed.',
    }],
  };
}
