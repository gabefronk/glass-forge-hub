import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import DotText from './DotText';
import { refTone } from './PurchasingCard';
import { messageOf } from '@/components/budgets/ProcurementForms';

const INK = '#101617', LINE = '#E2E8F0';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// The Quote cell: "Supplier - quote #". Click it to correct the supplier name or
// the quote number in place (Enter saves, Escape cancels). It writes to the same
// quote the cell reads from, so what you type is what the row shows afterwards.
export default function QuoteCell({ card, onSaved }) {
  const { refs, brand, quoteBudgetId, quoteManufacturer, quoteRawNumber } = card;
  const [editing, setEditing] = useState(false);
  const [mfr, setMfr] = useState('');
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = refs.quoteNumber ? [brand, refs.quoteNumber].filter(Boolean).join(' - ') : null;

  const start = () => {
    if (!quoteBudgetId) return;
    setMfr(quoteManufacturer || brand || '');
    setNum(quoteRawNumber || '');
    setError('');
    setEditing(true);
  };

  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await base44.entities.JobBudgets.update(quoteBudgetId, { manufacturer: clean(mfr), quote_number: clean(num) });
      setEditing(false);
      await onSaved?.();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') setEditing(false);
  };

  if (!editing) {
    const dot = <DotText tone={refTone(refs.quoteStatus) || 'gray'}>{text}</DotText>;
    if (!quoteBudgetId) return dot;
    return (
      <button type="button" onClick={start} title="Click to edit the supplier and quote number"
        aria-label={`Edit quote: ${text || 'no quote number'}`}
        className="w-full cursor-pointer rounded-md px-1 py-0.5 hover:bg-stone-100">{dot}</button>
    );
  }

  const input = 'w-full min-w-0 rounded-md border px-1.5 py-1 text-[11.5px] font-semibold outline-none';
  const style = { borderColor: LINE, color: INK, backgroundColor: '#FFFFFF' };
  return (
    <div className="flex flex-col gap-1">
      <input autoFocus aria-label="Supplier" placeholder="Supplier" value={mfr}
        onChange={(e) => setMfr(e.target.value)} onKeyDown={onKey} className={input} style={style} />
      <input aria-label="Quote number" placeholder="Quote #" value={num}
        onChange={(e) => setNum(e.target.value)} onKeyDown={onKey} className={input} style={style} />
      <div className="flex gap-1">
        <button type="button" onClick={save} disabled={busy}
          className="inline-flex h-6 flex-1 items-center justify-center rounded-md text-[11px] font-semibold disabled:opacity-60"
          style={{ backgroundColor: '#0b3f3b', color: '#FFFFFF', minHeight: 0 }}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setEditing(false)}
          className="inline-flex h-6 flex-1 items-center justify-center rounded-md text-[11px] font-semibold"
          style={{ backgroundColor: '#F0F1ED', color: INK, minHeight: 0 }}>Cancel</button>
      </div>
      {error && <span role="alert" className="text-[10px] font-semibold" style={{ color: '#A43432' }}>{error}</span>}
    </div>
  );
}