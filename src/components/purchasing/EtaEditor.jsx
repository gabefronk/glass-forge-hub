import { useEffect, useState } from 'react';
import { saveEtaTarget } from '@/lib/etaTarget';
import { ETA_CALENDAR_OPTIONS, DEFAULT_ETA_CALENDAR, loadEtaCalendarChoice, deliveryChoice, supplierName, etaKeyFor } from '@/lib/etaCalendar';

// Entering a supplier ETA (Gabriel, Oct 30): the date, whose calendar it goes on
// (Israel / Milan / both) and, for a supplier order, delivered or will call. One
// Save writes the ETA and creates or moves the calendar event(s); saving an empty
// date clears the ETA and removes them. Used by the grid's ETA cell and an order's
// Manage panel, so both enter an ETA the same way.
const INK = '#101617', INK2 = '#566063', EDGE = '#E2DCD1';
const FIELD = 'h-9 w-full rounded-[9px] border bg-white px-2 text-[13px] font-semibold disabled:opacity-60';
const BTN = 'inline-flex h-9 items-center whitespace-nowrap rounded-[9px] px-3 text-[13px] font-semibold disabled:opacity-60';

function Labeled({ label, children }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[13px] font-medium" style={{ color: INK2 }}>
      {label}
      {children}
    </label>
  );
}

export default function EtaEditor({ jobId, order = null, budgetId = '', date = '', onSaved, onDone, onCancel, inline = false }) {
  const [value, setValue] = useState(date || '');
  const [calendars, setCalendars] = useState(DEFAULT_ETA_CALENDAR);
  const [loaded, setLoaded] = useState(false);
  const [delivery, setDelivery] = useState(() => deliveryChoice(order));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const etaKey = etaKeyFor({ order, budgetId });

  useEffect(() => {
    let live = true;
    setLoaded(false);
    loadEtaCalendarChoice(etaKey).then((choice) => { if (live) { setCalendars(choice); setLoaded(true); } });
    return () => { live = false; };
  }, [etaKey]);

  async function save(e) {
    e.preventDefault();
    if (busy || !loaded) return;
    setBusy(true); setError('');
    try {
      const result = await saveEtaTarget({ jobId, order, budgetId, date: value, calendars, delivery: order?.id ? delivery : '' });
      if (result.error) setError(result.error);
      if (result.saved) {
        await onSaved?.();
        if (!result.error) onDone?.();
      }
    } finally { setBusy(false); }
  }

  const supplier = supplierName(order?.vendor) || 'supplier';
  const cleared = !value && Boolean(date);
  return (
    <form onSubmit={save} className={inline ? 'flex flex-wrap items-end gap-2' : 'flex flex-col gap-2.5'}>
      <div className={inline ? 'contents' : 'grid gap-2.5'}>
        <Labeled label="Supplier ETA">
          <input type="date" value={value} disabled={busy} onChange={(e) => setValue(e.target.value)}
            aria-label="Supplier ETA" className={FIELD} style={{ borderColor: EDGE, color: INK }} />
        </Labeled>
        <Labeled label="Calendar">
          <select value={calendars} disabled={busy || !loaded} onChange={(e) => setCalendars(e.target.value)}
            className={FIELD} style={{ borderColor: EDGE, color: INK }}>
            {ETA_CALENDAR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Labeled>
        {order?.id ? (
          <Labeled label="Pickup">
            <select value={delivery} disabled={busy} onChange={(e) => setDelivery(e.target.value)}
              className={FIELD} style={{ borderColor: EDGE, color: INK }}>
              <option value="delivery">Delivered</option>
              <option value="will_call">Will call at {supplier}</option>
            </select>
          </Labeled>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !loaded || (!value && !date)} className={BTN}
          style={{ border: '1px solid #0B3F3B', backgroundColor: '#0B3F3B', color: '#FFFFFF' }}>
          {busy ? 'Saving…' : cleared ? 'Clear ETA' : 'Save ETA'}
        </button>
        {onCancel ? <button type="button" onClick={onCancel} disabled={busy} className={BTN} style={{ border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: INK }}>Cancel</button> : null}
      </div>
      {error ? <p role="alert" className="text-[13px] font-semibold" style={{ color: '#A43432' }}>{error}</p> : null}
    </form>
  );
}
