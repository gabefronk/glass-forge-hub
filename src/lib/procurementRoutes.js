// Preserve existing job IDs while opening the job-specific purchasing workspace.
export function procurementPath(jobId, section = 'budgets') {
  const sections = new Set(['budgets', 'orders', 'tracking', 'invoicing']);
  const tab = sections.has(section) ? section : 'budgets';
  const base = jobId ? `/jobs/${encodeURIComponent(jobId)}/budget-orders` : '/purchasing';
  return `${base}?section=${tab}`;
}
