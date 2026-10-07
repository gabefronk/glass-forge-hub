import { useState } from 'react';
import { X } from 'lucide-react';
import { C } from '@/lib/feeUI';

// Owner-only Save/Cancel editor for the per-job rough labor/material and sale
// price. Local state only — nothing is written until Save. Blank = withhold.
export default function MoneyEditDialog({ jobName, initialRough, initialSale, onSave, onCancel, busy, error }) {
  const [rough, setRough] = useState(initialRough == null ? '' : String(initialRough));
  const [sale, setSale] = useState(initialSale == null ? '' : String(initialSale));

  const submit = (e) => {
    e.preventDefault();
    onSave({
      rough_labor_material: rough === '' ? null : Number(rough),
      sale_price: sale === '' ? null : Number(sale),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(16,22,23,.5)' }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-[14px] p-5" style={{ backgroundColor: '#FFFFFF', border: '1px solid #D3CABB', boxShadow: '0 12px 32px -8px rgba(21,24,26,.5)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-bold" style={{ color: C.text }}>Edit money · {jobName}</h3>
          <button type="button" onClick={onCancel} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ color: C.textMuted }}><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-[12px]" style={{ color: C.textSecondary }}>Owner-only. Profit is computed from these entries and the reviewed budget. Leave a field blank to withhold it.</p>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <label className="block text-[12px] font-semibold" style={{ color: C.textSecondary }}>Rough labor & material
            <input type="number" step="any" min="0" inputMode="decimal" value={rough} onChange={(e) => setRough(e.target.value)} className="mt-1 w-full rounded-[9px] px-3 py-2 text-sm" style={{ border: `1px solid ${C.border}`, color: C.text }} />
          </label>
          <label className="block text-[12px] font-semibold" style={{ color: C.textSecondary }}>Sale price
            <input type="number" step="any" min="0" inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value)} className="mt-1 w-full rounded-[9px] px-3 py-2 text-sm" style={{ border: `1px solid ${C.border}`, color: C.text }} />
          </label>
          {error && <p role="alert" className="text-[12px]" style={{ color: 'var(--gf-error)' }}>{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="inline-flex min-h-10 items-center rounded-[9px] border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: C.border, color: C.text, backgroundColor: '#FFFFFF' }}>Cancel</button>
            <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center rounded-[9px] px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ backgroundColor: '#0B3F3B', color: '#FFFFFF' }}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}