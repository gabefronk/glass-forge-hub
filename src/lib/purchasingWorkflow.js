import { activeBudgets, budgetRollup, budgetFigures, isLiveBudget } from '../../base44/shared/procurementCore.js';
import { contractReviewIssues } from './jobSetup.js';
import { procurementPath } from './procurementRoutes.js';
import { purchasingMatches } from './purchasingMatches.js';
import { denverDate } from '../../base44/shared/billingCore.js';

// A suggested next review, never permission to order, invoice or infer payment.
export function purchasingWorkflow({ job, budgets = [], purchaseOrders = [], supplierOrders = [], conflicts = [], setups = [], setupState = 'loaded', month = '', today = denverDate() }) {
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
  const matches = purchasingMatches(id, quotes, pos, suppliers, conflicts);
  const pendingPO = included.filter(budget => !matches.budgetPairs.some(pair => pair.budget.id === budget.id));
  const missingConfirmations = pos.filter(po => !matches.supplierPairs.some(pair => pair.po.id === po.id));
  const unmatched = suppliers.filter(row => !matches.supplierPairs.some(pair => pair.supplier.id === row.id));
  const waitingDelivery = suppliers.filter(row => !row.received_date);
  const needsETA = waitingDelivery.filter(row => !row.eta_date);
  const overdue = waitingDelivery.filter(row => row.eta_date && row.eta_date < today);
  const reviewQuote = quotes.filter(row => included.some(b => b.id === row.id) || row.budget_usage === 'draft').find(row => row.budget_usage === 'draft' || !budgetFigures(row).ready) || (!included.length ? quotes.find(row => row.budget_usage !== 'reference') : null);
  const path = section => procurementPath(id, section, month);
  const steps = [
    { key: 'budgets', title: 'Quote & budget', href: path('budgets'), status: !included.length ? 'Review scope' : rollup.status === 'ready' ? 'Numbers reviewed' : 'Needs review', detail: `${quotes.length} quotes · ${included.length} included scopes` },
    { key: 'setup', title: 'Customer setup', href: `/jobs/${encodeURIComponent(id)}/setup`, status: setupState !== 'loaded' ? 'Status unavailable' : setupRows.length > 1 ? 'Resolve saved versions' : !setup ? usesSetup ? 'Draft not saved' : 'Available if needed' : setupIssues.length ? 'Needs review' : setup.status === 'approved' ? 'Approval recorded' : 'Ready for your review', detail: setupState !== 'loaded' ? 'Open setup to check its saved details' : setupIssues.length ? `${setupIssues.length} details to review` : 'Customer, scope, tax and terms' },
    { key: 'orders', title: 'Purchase orders', href: path('orders'), status: jobConflicts.length ? 'Reference conflict' : pendingPO.length ? 'Review order coverage' : pos.length ? 'POs recorded' : 'No POs recorded', detail: `${pos.length} active POs${pendingPO.length ? ` · ${pendingPO.length} scopes without a matching PO` : ''}` },
    { key: 'tracking', title: 'Supplier follow-up', href: path('tracking'), status: unmatched.length ? 'Check PO links' : missingConfirmations.length ? 'Awaiting supplier confirmation' : overdue.length ? 'Delivery needs a check' : needsETA.length ? 'ETA needed' : waitingDelivery.length ? 'Awaiting delivery' : suppliers.length ? 'Receiving recorded' : 'No confirmations', detail: `${suppliers.length} confirmations · ${missingConfirmations.length} POs without a matching confirmation` },
    { key: 'invoicing', title: 'Billing', href: path('invoicing'), status: month ? `Accounting month ${month}` : 'Open job billing', detail: 'Estimates, billed work and payments are separate' },
  ];
  let next = steps[4];
  if (jobConflicts.length) next = { ...steps[2], title: 'Resolve the PO reference conflict', detail: 'Compare the original supplier documents before changing job links.' };
  else if (reviewQuote || (included.length && rollup.status !== 'ready')) next = { ...steps[0], title: 'Review quote scope and numbers', ...(reviewQuote ? { editor: { mode: budgetFigures(reviewQuote).ready ? 'usage' : 'numbers', budget_id: reviewQuote.id }, detail: reviewQuote.title || 'Quote details are already filled where known.' } : {}) };
  else if (setupState !== 'loaded' || (usesSetup && (!setup || setupRows.length > 1 || setupIssues.length || setup.status !== 'approved'))) next = { ...steps[1], title: 'Review customer setup' };
  else if (pendingPO.length) next = { ...steps[2], title: 'Prepare the next purchase order', detail: pendingPO[0].title || 'Supplier and source quote are filled in for you.', editor: { mode: 'po', budget_id: pendingPO[0].id, job_id: id } };
  else if (unmatched.length) next = { ...steps[3], title: 'Check the supplier order connection', editor: { mode: 'supplier', order_id: unmatched[0].id } };
  else if (missingConfirmations.length) next = { ...steps[3], title: 'Add the supplier confirmation', detail: missingConfirmations[0].po_number, editor: { mode: 'supplier', po_id: missingConfirmations[0].id, job_id: id } };
  else if (overdue.length || needsETA.length) { const order = overdue[0] || needsETA[0]; next = { ...steps[3], title: overdue.length ? 'Check the expected delivery' : 'Add the supplier delivery date', detail: order.title || order.order_number, editor: { mode: 'supplier', order_id: order.id } }; }
  else next = { ...steps[4], title: 'Review billing for this job' };
  return { steps, next, matchedCount: matches.budgetPairs.filter(p => !p.explicit).length + matches.supplierPairs.filter(p => !p.explicit).length };
}
