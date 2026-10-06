import { budgetForPO, supplierForPO, isLiveBudget } from '../../base44/shared/procurementCore.js';

// Read-time connections only. Preserve source IDs/history; never infer from a job name.
export function purchasingMatches(jobId, budgets = [], purchaseOrders = [], supplierOrders = [], conflicts = []) {
  const blocked = new Set(conflicts.filter(c => c.job_ids?.includes(jobId)).map(c => c.number));
  const pos = purchaseOrders.filter(p => p.job_id === jobId && p.status !== 'cancelled');
  const quotes = budgets.filter(b => b.job_id === jobId && isLiveBudget(b));
  const suppliers = supplierOrders.filter(o => o.job_id === jobId);
  const budgetPairs = pos.filter(p => !blocked.has(p.po_number)).flatMap(po => {
    const match = budgetForPO(po, quotes);
    return match.budget ? [{ po, budget: match.budget, explicit: Boolean(match.explicit) }] : [];
  });
  const proposed = pos.filter(p => !blocked.has(p.po_number)).flatMap(po => {
    const supplier = supplierForPO(po, suppliers);
    return supplier ? [{ po, supplier, explicit: Boolean(supplier.purchase_order_id) }] : [];
  });
  const supplierPairs = proposed.filter(pair => proposed.filter(other => other.supplier.id === pair.supplier.id).length === 1);
  return { budgetPairs, supplierPairs };
}
