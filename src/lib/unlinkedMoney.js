// Money records the Unlinked Records page lists as needing a job. Shop / overhead purchases
// (purchase_type 'shop') belong to no job on purpose, so they are never listed here.
const live = (p) => p.status !== 'cancelled';
const isShop = (p) => p.purchase_type === 'shop';

export function unlinkedMoneyGroups({ lines = [], pos = [], budgets = [] } = {}) {
  return {
    lines: lines.filter((r) => !r.job_id && r.billable && !r.billed_to_bfs),
    posNoJob: pos.filter((p) => live(p) && !p.job_id && !isShop(p)),
    posNoBudget: pos.filter((p) => live(p) && p.job_id && !p.budget_id && !isShop(p)),
    budgets: budgets.filter((b) => !b.job_id && !b.deleted_at),
  };
}
