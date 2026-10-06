// Nonblocking label for a budget whose openings_qty could not be confidently
// recomputed from line items (unknown/missing qty, or a summary/detail overlap
// that would double-count). The flag lives on the stored normalized quote
// (record.quote.openings_qty_review), set by normalizeVendorQuote. Returns null
// when the quantity is trusted, so the UI renders nothing extra in the common case.
export function quantityReviewLabel(budget) {
  return budget?.quote?.openings_qty_review ? 'Quantity needs review' : null;
}