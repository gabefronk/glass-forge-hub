// Preserve existing job IDs while opening the job-specific purchasing workspace.
export function procurementPath(jobId, section = 'budgets', month = '') {
  const sections = new Set(['budgets', 'orders', 'tracking', 'invoicing']);
  const tab = sections.has(section) ? section : 'budgets';
  const base = jobId ? `/jobs/${encodeURIComponent(jobId)}/budget-orders` : '/purchasing';
  const monthQuery = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `&month=${encodeURIComponent(month)}` : '';
  return `${base}?section=${tab}${monthQuery}`;
}
