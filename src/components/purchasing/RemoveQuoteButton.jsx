import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { budgetVersion } from '../../../base44/shared/procurementCore.js';
import { purchasingRequest, messageOf } from '@/components/budgets/ProcurementForms';

// Remove a duplicate or stale quote from its job. Reversible: the record and its files
// stay for recovery. The server refuses a quote a PO, order, accounting record or later
// revision still points at, and the last copy of a quote number a PO uses.
export default function RemoveQuoteButton({ budget, duplicate = false, className, style, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(null);
  if (!budget?.id || !budget.job_id || budget.deleted_at) return null;

  async function remove() {
    if (busy) return;
    const label = budget.title || `Quote ${budget.quote_number || ''}`.trim();
    if (!window.confirm(`Remove this ${duplicate ? 'duplicate ' : ''}quote from the job?\n\n${label}\n\nIt leaves the job's quotes and budget. Its record and files are kept for recovery. POs, orders and invoices are not changed.`)) return;
    setBusy(true); setError('');
    key.current ||= crypto.randomUUID();
    try {
      const result = await purchasingRequest({ action: 'remove_job_quote', budget_id: budget.id, expected_version: budgetVersion(budget),
        request_key: key.current, review_confirmed: true, reason: duplicate ? 'Duplicate quote removed by owner from Budget & Orders.' : 'Quote removed from the job by owner.' });
      if (!result?.deleted || result.budget_id !== budget.id) throw new Error('Removal was not confirmed. Refresh before trying again.');
      onRemoved?.(result.message || 'Quote removed from the job.');
    } catch (e) { setError(messageOf(e)); key.current = null; } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex max-w-full flex-col gap-1">
      <button type="button" disabled={busy} onClick={remove} className={className} style={{ ...style, color: '#a43432', borderColor: '#f0c9c5' }}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Removing…' : duplicate ? 'Remove duplicate' : 'Remove'}
      </button>
      {error ? <span role="alert" className="max-w-sm text-[12px] font-medium" style={{ color: '#a43432' }}>{error}</span> : null}
    </span>
  );
}
