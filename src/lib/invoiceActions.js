import { selectedInvoiceRows } from './invoiceScope.js';
import { isReady } from './invoicingFilters.js';

// Eligibility uses display annotations; writes use the original records only.
export function selectedReadyInvoiceRows(rawRows, billingRows, ids, month, jobId, reports, superseded) {
  const readyIds = new Set(billingRows.filter(row => isReady(row, reports, superseded)).map(row => row.id));
  return selectedInvoiceRows(rawRows, ids, month, jobId).filter(row => readyIds.has(row.id));
}
export function selectedLaborFeeRows(rows, ids, month, jobId) {
  return selectedInvoiceRows(rows, ids, month, jobId).filter(row => row.fee_type !== 'profit_split');
}
export async function deleteInvoiceRows(rows, remove) {
  const results = await Promise.allSettled(rows.map(row => Promise.resolve().then(() => remove(row.id))));
  return {
    deleted: rows.filter((_, index) => results[index].status === 'fulfilled'),
    failed: rows.filter((_, index) => results[index].status === 'rejected'),
  };
}
