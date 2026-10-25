import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { denverDate } from '@/lib/feeMath';
import { REQUEST_KINDS, requestKind, suggestedRequest, receivedSoFar, requestAmounts, requestChecks, buildPaymentPrompt, customerLabel } from '@/lib/paymentRequest';

// Request payment (Gabe, Oct 25): pick Half down / Final payment / Full amount, copy the prompt
// into ChatGPT, which builds a DRAFT invoice in QuickBooks. The Hub sends nothing. After the
// invoice exists, Record invoice logs its QuickBooks number on the job.
// useRequestPayment returns the dropdown (`trigger`), the menu items alone (`items`, for a page
// that already has an Add menu) and the `panel` that opens under it.
const INK = '#101617', SECOND = '#566063', RULE = '#D6CCBA', TEAL = '#0B3F3B', RED = '#A43432';
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const item = 'flex min-h-9 cursor-pointer items-center justify-between gap-6 text-[14px]';

export function useRequestPayment({ job, sale, budgets = [], invoices: given, onRecorded, enabled = true }) {
  const [loaded, setLoaded] = useState([]);
  const [open, setOpen] = useState(null);
  const invoices = given ?? loaded;
  useEffect(() => {
    if (given !== undefined || !job?.id || !enabled) return undefined;
    let active = true;
    base44.entities.Invoices.filter({ job_id: job.id }, 'invoice_date', 200)
      .then((rows) => { if (active) setLoaded(Array.isArray(rows) ? rows : []); })
      .catch(() => {});
    return () => { active = false; };
  }, [given, job?.id, enabled]);

  const stage = job?.payment_status || '';
  const received = receivedSoFar({ sale, stage, invoices });
  const amounts = requestAmounts({ sale, received: received.value });
  const suggested = suggestedRequest(stage);
  const order = suggested ? [suggested, ...REQUEST_KINDS.map((k) => k.key).filter((k) => k !== suggested)] : REQUEST_KINDS.map((k) => k.key);

  const items = order.map((key) => (
    <DropdownMenuItem key={key} className={item} onSelect={() => setOpen(key)}>
      <span>{requestKind(key).label}{key === suggested ? <span style={{ color: SECOND }}> · suggested</span> : null}</span>
      <span className="tabular-nums" style={{ color: SECOND }}>{fmt(amounts[key])}</span>
    </DropdownMenuItem>
  ));

  const trigger = (style) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-semibold" style={style}>
          Request payment<ChevronDown className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[280px] p-1">{items}</DropdownMenuContent>
    </DropdownMenu>
  );

  const panel = open ? (
    <RequestPanel key={open} requestKey={open} job={job} sale={sale} budgets={budgets} stage={stage}
      received={received} amount={amounts[open]} onClose={() => setOpen(null)}
      onRecorded={(row) => { if (given === undefined) setLoaded((l) => [...l, row]); onRecorded?.(row); }} />
  ) : null;
  return { trigger, items, panel, open: (key) => setOpen(key) };
}

function RequestPanel({ requestKey, job, sale, budgets, stage, received, amount, onClose, onRecorded }) {
  const k = requestKind(requestKey);
  const prompt = useMemo(() => buildPaymentPrompt({ key: requestKey, job, budgets, sale, received: received.value, receivedFrom: received.from, amount }), [requestKey, job, budgets, sale, received.value, received.from, amount]);
  const checks = requestChecks({ sale, budgets, job, stage, amount });
  const [copied, setCopied] = useState(false);
  const [number, setNumber] = useState('');
  const [msg, setMsg] = useState({ text: '', bad: false });
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); }
    catch { box.current?.select(); document.execCommand('copy'); }
    setCopied(true);
  };

  const record = async () => {
    const n = number.trim();
    if (!n) { setMsg({ text: 'Enter the QuickBooks invoice number first', bad: true }); return; }
    if (amount == null || amount <= 0) { setMsg({ text: 'There is no amount to record', bad: true }); return; }
    setBusy(true); setMsg({ text: '', bad: false });
    try {
      const taken = await base44.entities.Invoices.filter({ invoice_number: n }, '-created_date', 5);
      if ((taken || []).some((i) => !i.voided_at)) { setMsg({ text: `Invoice #${n} is already recorded`, bad: true }); setBusy(false); return; }
      const me = await base44.auth.me().catch(() => null);
      const row = await base44.entities.Invoices.create({
        invoice_number: n, invoice_date: denverDate(), kind: k.kind, job_id: job.id,
        customer_name: customerLabel(job), amount, notes: `${k.label} requested from the Hub`, created_by_email: me?.email || '',
      });
      onRecorded?.(row);
      setNumber('');
      setMsg({ text: `Recorded #${n}: ${k.label.toLowerCase()}, ${fmt(amount)}`, bad: false });
    } catch (e) { setMsg({ text: `The invoice was not recorded. ${e?.message || ''}`.trim(), bad: true }); }
    setBusy(false);
  };

  return (
    <section aria-label={`Request payment: ${k.label}`} className="px-4 py-3" style={{ backgroundColor: '#FAF8F3', borderBottom: `1px solid ${RULE}` }}>
      <div className="flex items-baseline gap-3">
        <h3 className="m-0 text-[15px] font-bold" style={{ color: INK }}>{k.label}</h3>
        <span className="text-[20px] font-bold tabular-nums" style={{ color: INK }}>{fmt(amount)}</span>
        <button type="button" onClick={onClose} aria-label="Close request payment" className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ border: '1px solid #E2DCD1', background: '#fff', color: SECOND }}><X className="h-4 w-4" /></button>
      </div>
      {checks.length > 0 && (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {checks.map((c) => <li key={c} className="rounded-[8px] px-3 py-1.5 text-[14px]" style={{ background: '#FAF0DA', color: '#6F4E10' }}>{c}</li>)}
        </ul>
      )}
      <textarea ref={box} readOnly value={prompt} aria-label="Prompt for ChatGPT" rows={20}
        className="mt-2 w-full rounded-[8px] p-3 text-[13px] leading-[1.55]"
        style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', border: '1px solid #9A9080', background: '#fff', color: INK, resize: 'vertical' }} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[14px] font-semibold text-white" style={{ background: TEAL }}><Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy prompt'}</button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <input value={number} onChange={(e) => { setNumber(e.target.value); setMsg({ text: '', bad: false }); }} placeholder="QuickBooks invoice #" aria-label="QuickBooks invoice number"
            className="h-9 w-[180px] rounded-[8px] px-2.5 text-[14px]" style={{ border: '1px solid #9A9080', color: INK }} />
          <button type="button" disabled={busy} onClick={record} className="inline-flex h-9 items-center rounded-[9px] px-3 text-[14px] font-semibold disabled:opacity-50" style={{ border: '1px solid #9A9080', background: '#fff', color: INK }}>{busy ? 'Saving…' : 'Record invoice'}</button>
        </span>
      </div>
      {msg.text && <p role={msg.bad ? 'alert' : 'status'} className="m-0 mt-1.5 text-right text-[14px]" style={{ color: msg.bad ? RED : TEAL }}>{msg.text}</p>}
    </section>
  );
}
