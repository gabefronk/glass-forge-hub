import { LegacyPurchasingRedirect } from './Procurement';

// Keep old bookmarks working; all budget records live in the same workspace.
export default function JobBudgets() {
  return <LegacyPurchasingRedirect section="budgets" />;
}
