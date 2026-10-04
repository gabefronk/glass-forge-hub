import { activeBudgets, budgetRollup, isLiveBudget } from '../../base44/shared/procurementCore.js';
import { contractReviewIssues } from './jobSetup.js';
import { procurementPath } from './procurementRoutes.js';

// A suggested next review, never permission to order, invoice or infer payment.
export function purchasingWorkflow({ job, budgets = [], purchaseOrders = [], supplierOrders = [], conflicts = [], setups = [], setupState = 'loaded', month = '' }) {
  const id = job.id;
  const quotes = budgets.filter(row => row.job_id === id && isLiveBudget(row));
  const included = activeBudgets(quotes);
  const rollup = budgetRollup(quotes);
  const pos = purchaseOrders.filter(row => row.job_id === id && row.status !== 'cancelled');
  const suppliers = supplierOrders.filter(row => row.job_id === id);
  const jobConflicts = conflicts.filter(row => row.job_ids?.includes(id));
  const setupRows = setups.filter(row => row.job_id === id);
  const setup = setupRows.length === 1 ? setupRows[0] : null;
  const setupIssues = setup ? contractReviewIssues(setup) : [];
  // An existing install job does not require a new YA sales contract.
  // Only continue a setup already started or a sale converted from Window Quotes.
  const usesSetup = Boolean(job.source_window_quote_id || setupRows.length);
  const pendingPO = included.filter(budget => !pos.some(po => po.budget_id === budget.id));
  // Only explicit same-job links support coverage claims.
  const missingConfirmations = pos.filter(po => !suppliers.some(row => row.purchase_order_id === po.id));
  const unmatched = suppliers.filter(row => !pos.some(po => po.id === row.purchase_order_id));
  const waitingDelivery = suppliers.filter(row => !row.received_date);
  const path = section => procurementPath(id, section, month);
  const steps = [
    { key: 'budgets', title: 'Quote & budget', href: path('budgets'), status: !included.length ? 'Review scope' : rollup.status === 'ready' ? 'Numbers reviewed' : 'Needs review', detail: `${quotes.length} quotes · ${included.length} included scopes` },
    { key: 'setup', title: 'Customer setup', href: `/jobs/${encodeURIComponent(id)}/setup`, status: setupState !== 'loaded' ? 'Status unavailable' : setupRows.length > 1 ? 'Resolve saved versions' : !setup ? usesSetup ? 'Draft not saved' : 'Available if needed' : setupIssues.length ? 'Needs review' : setup.status === 'approved' ? 'Approval recorded' : 'Ready for your review', detail: setupState !== 'loaded' ? 'Open setup to check its saved details' : setupIssues.length ? `${setupIssues.length} details to review` : 'Customer, scope, tax and terms' },
    { key: 'orders', title: 'Purchase orders', href: path('orders'), status: jobConflicts.length ? 'Reference conflict' : pendingPO.length ? 'Review order coverage' : pos.length ? 'POs recorded' : 'No POs recorded', detail: `${pos.length} active POs${pendingPO.length ? ` · ${pendingPO.length} scopes without an explicit PO link` : ''}` },
    { key: 'tracking', title: 'Supplier follow-up', href: path('tracking'), status: unmatched.length ? 'Check PO links' : missingConfirmations.length ? 'Awaiting supplier confirmation' : waitingDelivery.length ? 'Track delivery' : suppliers.length ? 'Receiving recorded' : 'No confirmations', detail: `${suppliers.length} confirmations · ${missingConfirmations.length} POs without an explicit confirmation` },
    { key: 'invoicing', title: 'Billing', href: path('invoicing'), status: month ? `Accounting month ${month}` : 'Open job billing', detail: 'Estimates, billed work and payments are separate' },
  ];
  let next = steps[4];
  if (jobConflicts.length) next = { ...steps[2], title: 'Resolve the PO reference conflict', detail: 'Compare the original supplier documents before changing job links.' };
  else if (quotes.length && (!included.length || rollup.status !== 'ready')) next = { ...steps[0], title: 'Review quote scope and numbers' };
  else if (setupState !== 'loaded' || (usesSetup && (!setup || setupRows.length > 1 || setupIssues.length || setup.status !== 'approved'))) next = { ...steps[1], title: 'Review customer setup' };
  else if (pendingPO.length) next = { ...steps[2], title: 'Review which scopes need ordering' };
  else if (unmatched.length || missingConfirmations.length || waitingDelivery.length) next = { ...steps[3], title: 'Review supplier follow-up' };
  else next = { ...steps[4], title: 'Review billing for this job' };
  return { steps, next };
}
