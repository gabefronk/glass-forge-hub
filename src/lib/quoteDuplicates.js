import { sameVendor, pText } from './purchasingCoreTwin.js';

// Spotting a second copy of the same quote on one job (Gabriel, Oct 24): the same PDF
// uploaded twice (same file fingerprint), or the same quote number from the same supplier
// (AMSCO and AMSCO WINDOWS count as one). Pure; the server re-checks before removing.
const live = (b) => b && !pText(b.deleted_at);
const quoteRef = (b) => pText(b?.quote_number).toUpperCase();

export function duplicateOf(budget, jobBudgets = []) {
  if (!live(budget)) return null;
  return jobBudgets.find((b) => live(b) && b.id !== budget.id && b.job_id === budget.job_id && (
    (budget.source_sha256 && b.source_sha256 === budget.source_sha256) ||
    (quoteRef(budget) && quoteRef(b) === quoteRef(budget) && sameVendor(b, budget))
  )) || null;
}

// A "job money (no vendor quote)" budget is stale once a real vendor quote is on the job.
export function replacedByQuote(budget, jobBudgets = []) {
  if (!live(budget) || quoteRef(budget) || budget.quote) return false;
  return jobBudgets.some((b) => live(b) && b.id !== budget.id && b.job_id === budget.job_id && quoteRef(b));
}
