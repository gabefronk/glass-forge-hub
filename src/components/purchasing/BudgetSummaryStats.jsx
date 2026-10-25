import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { HERO_INK, HERO_MUTED, HeroStat } from '@/components/PageShell';
import { money, percent, messageOf } from '@/components/budgets/ProcurementForms';
import { budgetSummary, parseDollars } from '@/lib/budgetSummary';

// The Budget & Orders summary (Gabriel, Oct 24). Budget cost and Customer total are
// typed straight into the box and saved on the job (manual_budget_cost /
// manual_customer_total). A typed number is his own estimate (Oct 25): it is labelled
// "My estimate" and the budget's own figure (the included quotes) sits beside it.
// Margin dollars and Margin % follow from the two, with the budget's margin beside them.
// Nothing needs a vendor quote, a verified checkbox or a status record. Display only:
// these numbers change nothing on Purchasing, invoicing or any other page.
const BOX = { backgroundColor: 'rgba(207,227,218,.08)', border: '1px solid rgba(207,227,218,.18)' };
const LABEL = 'text-[10.5px] font-semibold tracking-[.14em]';
const TONE = { green: '#86d3a5', amber: '#e0c994', red: '#f3a29a' };

function EditableStat({ label, field, value, quote, emptySub, job, disabled, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const cancelled = useRef(false);
  const manual = job?.[field] != null && job[field] !== '';
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  async function save(next) {
    if (busy) return;
    const current = manual ? Number(job[field]) : null;
    if (next === current) { setEditing(false); return; }
    setBusy(true); setError('');
    try {
      await base44.entities.Jobs.update(job.id, { [field]: next });
      setEditing(false);
      await onSaved?.(next == null ? `${label} now comes from the quotes.` : `${label} saved.`);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  function commit() {
    // Escape closes the box; the blur that follows must not save.
    if (cancelled.current) { cancelled.current = false; return; }
    const next = parseDollars(text);
    if (next === undefined) { setError('Type a dollar amount, like 12480.50'); return; }
    save(next);
  }

  return (
    <div className="flex min-w-[120px] flex-col rounded-[12px] px-3.5 py-2.5" style={BOX}>
      <div className={LABEL} style={{ color: '#9fc3b6' }}>{label.toUpperCase()}</div>
      {editing ? (
        <input ref={inputRef} autoFocus inputMode="decimal" aria-label={label} value={text} disabled={busy}
          onChange={(e) => { setText(e.target.value); setError(''); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { cancelled.current = true; setEditing(false); setError(''); } }}
          placeholder="Leave blank to use quotes"
          className="mt-1 h-10 w-full min-w-0 rounded-[8px] px-2.5 text-[18px] font-bold tabular-nums outline-none focus:ring-2 focus:ring-[#e0c994]"
          style={{ backgroundColor: 'rgba(255,255,255,.1)', color: HERO_INK, border: '1px solid rgba(255,255,255,.28)' }} />
      ) : (
        <button type="button" disabled={disabled} onClick={() => { cancelled.current = false; setText(value != null ? String(value) : ''); setEditing(true); }}
          aria-label={`Edit ${label.toLowerCase()}`} title={`Tap to type the ${label.toLowerCase()}`}
          className="group -mx-1 mt-0.5 flex min-h-10 items-center gap-2 rounded-[8px] px-1 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e0c994] disabled:cursor-default disabled:hover:bg-transparent">
          <span className="text-[20px] font-bold tabular-nums [overflow-wrap:anywhere]" style={{ color: HERO_INK, letterSpacing: '-0.02em' }}>{money(value)}</span>
          <Pencil className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" style={{ color: '#e0c994' }} aria-hidden="true" />
        </button>
      )}
      {error ? <div role="alert" className="mt-0.5 text-[11.5px] font-semibold" style={{ color: '#f3a29a' }}>{error}</div> : null}
      {manual && quote != null ? (
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11.5px]" style={{ color: HERO_MUTED }}>
          <span>My estimate · Budget {money(quote)}</span>
          {Number(job[field]) !== quote ? (
            <button type="button" disabled={disabled || busy} onClick={() => save(null)} className="font-semibold underline underline-offset-2 disabled:opacity-60" style={{ color: '#e0c994' }}>Use budget</button>
          ) : null}
        </div>
      ) : manual ? (
        <div className="mt-0.5 text-[11.5px]" style={{ color: HERO_MUTED }}>My estimate</div>
      ) : emptySub ? (
        <div className="mt-0.5 text-[11.5px] break-words" style={{ color: HERO_MUTED }}>{emptySub}</div>
      ) : null}
    </div>
  );
}

export default function BudgetSummaryStats({ job, rollup, disabled, onSaved }) {
  const s = budgetSummary(job, rollup);
  const toneColor = s.tone ? TONE[s.tone] : HERO_INK;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <EditableStat label="Budget cost" field="manual_budget_cost" value={s.cost} quote={s.quoteCost} job={job} disabled={disabled} onSaved={onSaved}
        emptySub={`${rollup.count} included scope${rollup.count === 1 ? '' : 's'}`} />
      <EditableStat label="Customer total" field="manual_customer_total" value={s.sell} quote={s.quoteSell} job={job} disabled={disabled} onSaved={onSaved}
        emptySub="Budget estimate, not an invoice" />
      <HeroStat label="Margin dollars" value={money(s.marginDollars)} sub={s.anyManual && s.quoteMarginDollars != null ? `On my estimate · Budget ${money(s.quoteMarginDollars)}` : undefined} />
      <div className="min-w-[120px] rounded-[12px] px-3.5 py-2.5" style={BOX}>
        <div className={LABEL} style={{ color: '#9fc3b6' }}>MARGIN</div>
        <div className="mt-0.5 flex items-center gap-2 text-[20px] font-bold tabular-nums" style={{ color: toneColor, letterSpacing: '-0.02em' }}>
          {s.tone ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: toneColor }} aria-hidden="true" /> : null}
          {percent(s.marginPct)}
        </div>
        {s.anyManual ? (
          <div className="mt-0.5 text-[11.5px]" style={{ color: HERO_MUTED }}>
            {s.tone ? (s.tone === 'green' ? 'Healthy (25%+)' : s.tone === 'amber' ? 'Thin (15–25%)' : 'Low (under 15%)') : 'On my estimate'}
            {s.quoteMarginPct != null ? ` · Budget ${percent(s.quoteMarginPct)}` : ''}
          </div>
        ) : (
          <div className="mt-0.5 text-[11.5px]" style={{ color: HERO_MUTED }}>{s.reviewWarning ? 'Review incomplete or duplicate costs' : 'Based on included scopes'}</div>
        )}
      </div>
    </div>
  );
}
