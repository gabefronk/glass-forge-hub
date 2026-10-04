// Optional exact job scope for navigation from Budget & Orders. No fuzzy matching.
export function inInvoiceScope(row, month, jobId = '') {
  return row?.invoice_month === month && (!jobId || row.job_id === jobId);
}
export function selectedInvoiceRows(rows, selectedIds, month, jobId = '') {
  return rows.filter(row => selectedIds.has(row.id) && inInvoiceScope(row, month, jobId));
}
