import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { budgetVersion } from '../../../base44/shared/procurementCore.js';
import { purchasingRequest, messageOf, buttonClass } from './ProcurementForms';

export default function DeleteUnusedQuoteButton({ budget, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const key = useRef(null);
  if (!budget?.id || budget.job_id || budget.deleted_at) return null;

  async function remove() {
    if (pending.current) return;
    const label = budget.title || `Quote ${budget.quote_number || budget.id}`;
    if (!window.confirm(`Delete this unused quote attempt?\n\n${label}\n\nIt will leave the active list. The source files and a recovery record will stay. No job, purchase order or invoice will be deleted.`)) return;
    pending.current = true; setBusy(true); setError('');
    key.current ||= crypto.randomUUID();
    try {
      const result = await purchasingRequest({ action: 'delete_unused_quote', budget_id: budget.id,
        expected_version: budgetVersion(budget), request_key: key.current, review_confirmed: true,
        reason: 'Unused quote attempt deleted by owner from Purchasing.' });
      if (!result?.deleted || result.budget_id !== budget.id) throw new Error('Quote removal was not confirmed. Refresh before trying again.');
      onDeleted?.(result, 'Unused quote deleted. Jobs, POs, invoices and source files are unchanged.');
    } catch (e) { setError(messageOf(e)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <span className="inline-flex max-w-full flex-col gap-1">
    <button type="button" disabled={busy} onClick={remove} className={`${buttonClass} border-red-200 bg-white text-red-700 hover:bg-red-50`} title="Delete an unused quote attempt; linked financial records are protected">
      <Trash2 size={14} aria-hidden="true" />{busy ? 'Deleting...' : 'Delete unused quote'}
    </button>
    {error && <span role="alert" className="max-w-md text-xs text-red-700">{error}</span>}
  </span>;
}
