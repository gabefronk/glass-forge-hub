// Print invoice (Gabe, Oct 31): a YA Windows & Doors customer invoice from a job's budget,
// laid out like his Arena invoice and the same every time. Before printing he picks the type
// (full / half down / final balance), checks the filled-in bill to, project and lines (they
// add up to the job's customer total), and ticks what goes on it (wire details, ACH link,
// check, terms, signature, W-9, insurance certificate). Download saves the PDF and records the
// invoice in the Invoices ledger with the exact document, so a reprint is identical. The Hub
// never emails it. Payment details (bank numbers, W-9, certificate) are typed or uploaded by
// Gabe into AppSettings (admin only); none of them is in code.
import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';
import { receivedSoFar } from '@/lib/paymentRequest';
import {
  INVOICE_TYPES, INVOICE_OPTIONS, COMPANY_FIELDS, invoiceType, defaultOptions, companyDetails, hasBankDetails,
  nextInvoiceNumber, defaultBillTo, defaultProject, defaultLines, customerTotal, lineAmount, invoiceTotals,
  paymentSchedule, invoiceChecks,
} from '@/lib/yaInvoice';

const INK = '#101617', INK2 = '#566063', INK3 = '#34403F', RULE = '#EEE9E0', EDGE = '#E2DCD1', RED = '#A43432';
const BTN = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium no-underline disabled:opacity-60';
const SEC = { border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: INK3 };
const PRI = { border: '1px solid #0B3F3B', backgroundColor: '#0B3F3B', color: '#FFFFFF', fontWeight: 600 };
const FIELD = 'h-9 w-full min-w-0 rounded-[8px] border bg-white px-2.5 text-[13.5px]';
const FIELD_STYLE = { borderColor: EDGE, color: INK };
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const denverToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
const SETTINGS_LABELS = {
  invoice_company_name: 'Company name', invoice_company_address: 'Mailing address (header and checks)', invoice_phone: 'Phone (for ACH link requests)',
  invoice_email: 'Email (for ACH link requests)', invoice_checks_payable_to: 'Checks payable to', invoice_bank_name: 'Bank',
  invoice_bank_address: 'Bank address', invoice_account_name: 'Account name', invoice_routing_number: 'ABA routing number', invoice_account_number: 'Account number',
};

function Labeled({ label, children, className = '' }) {
  return <label className={`flex min-w-0 flex-col gap-1 text-[13px] font-medium ${className}`} style={{ color: INK3 }}>{label}{children}</label>;
}

async function loadSettings() {
  const rows = await base44.entities.AppSettings.list('-created_date', 5);
  return rows[0] || null;
}

// Payment details: what the invoice prints for wire / ACH / checks, plus the W-9 and the
// insurance certificate it can attach. Saved on AppSettings.
function PaymentDetails({ settings, onSaved, onCancel }) {
  const [draft, setDraft] = useState(() => companyDetails(settings || {}));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [files, setFiles] = useState({ w9: null, coi: null });
  async function save(e) {
    e.preventDefault(); if (busy) return;
    if (!settings?.id) { setError('No app settings record to save into. Refresh and try again.'); return; }
    setBusy(true); setError('');
    try {
      const patch = {};
      for (const k of COMPANY_FIELDS) patch[k] = String(draft[k] || '').trim();
      for (const [key, file] of Object.entries(files)) {
        if (!file) continue;
        const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
        patch[`invoice_${key}_file_uri`] = file_uri; patch[`invoice_${key}_file_name`] = file.name;
      }
      await base44.entities.AppSettings.update(settings.id, patch);
      onSaved({ ...settings, ...patch });
    } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-[10px] p-3.5" style={{ border: `1px solid ${EDGE}`, backgroundColor: '#FAF8F3' }}>
      <h4 className="text-[14px] font-semibold" style={{ color: INK }}>Payment details on every invoice</h4>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {COMPANY_FIELDS.map((k) => (
          <Labeled key={k} label={SETTINGS_LABELS[k]}>
            <input value={draft[k] || ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className={FIELD} style={FIELD_STYLE}
              autoComplete="off" inputMode={/routing|account_number/.test(k) ? 'numeric' : undefined} />
          </Labeled>
        ))}
        {[['w9', 'Form W-9 (PDF or image)'], ['coi', 'Certificate of insurance (PDF or image)']].map(([key, label]) => (
          <Labeled key={key} label={`${label}${settings?.[`invoice_${key}_file_name`] ? ` · on file: ${settings[`invoice_${key}_file_name`]}` : ''}`}>
            <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFiles((f) => ({ ...f, [key]: e.target.files?.[0] || null }))} className="text-[13px]" style={{ color: INK }} />
          </Labeled>
        ))}
      </div>
      {error ? <p role="alert" className="text-[13.5px] font-semibold" style={{ color: RED }}>{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={BTN} style={PRI}>{busy ? 'Saving…' : 'Save payment details'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className={BTN} style={SEC}>Cancel</button>
      </div>
    </form>
  );
}

async function attachmentBytes(attachments = {}, options = {}) {
  const out = [];
  for (const key of ['w9', 'coi']) {
    const a = attachments[key];
    if (!options[key] || !a?.uri) continue;
    const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: a.uri, expires_in: 300 });
    const res = await fetch(signed_url);
    if (!res.ok) throw new Error(`Couldn't load the ${key === 'w9' ? 'W-9' : 'insurance certificate'} file.`);
    const type = res.headers.get('content-type') || (/\.png$/i.test(a.name) ? 'image/png' : /\.jpe?g$/i.test(a.name) ? 'image/jpeg' : 'application/pdf');
    out.push({ type: type.split(';')[0], bytes: new Uint8Array(await res.arrayBuffer()) });
  }
  return out;
}

export async function downloadInvoice(doc) {
  const { yaInvoiceBytes, saveBytes } = await import('@/lib/yaInvoicePdf');
  const files = await attachmentBytes(doc.attachments, doc.options);
  const { bytes, filename } = await yaInvoiceBytes(doc, files);
  saveBytes(bytes, filename);
}

// The job's printed YA invoices, newest first, each downloadable again exactly as printed.
export function PrintedInvoices({ invoices }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const rows = invoices.filter((i) => i.document && !i.voided_at);
  if (!rows.length) return null;
  async function again(inv) {
    setBusy(inv.id); setError('');
    try { await downloadInvoice(inv.document); } catch (e) { setError(messageOf(e)); } finally { setBusy(''); }
  }
  return (
    <div style={{ borderTop: `1px solid ${EDGE}` }}>
      {rows.map((inv) => (
        <div key={inv.id} className="grid items-center gap-x-4 px-4 py-1.5 text-[13.5px] [grid-template-columns:minmax(0,1fr)_120px_auto] max-[767px]:[grid-template-columns:minmax(0,1fr)_auto]" style={{ borderTop: `1px solid ${RULE}`, color: INK }}>
          <span className="min-w-0 truncate"><span className="font-semibold" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{inv.invoice_number}</span> · {invoiceType(inv.document.type).label} · {inv.invoice_date}{inv.paid_date ? ` · paid ${inv.paid_date}` : ''}</span>
          <span className="whitespace-nowrap text-right font-semibold tabular-nums max-[767px]:hidden">{money(inv.amount)}</span>
          <button type="button" disabled={busy === inv.id} onClick={() => again(inv)} className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] font-medium hover:bg-black/5 disabled:opacity-60" style={{ color: INK3 }}>
            <Download className="h-4 w-4" />{busy === inv.id ? 'Building…' : 'Download'}
          </button>
        </div>
      ))}
      {error ? <p role="alert" className="px-4 py-2 text-[13.5px] font-semibold" style={{ color: RED }}>{error}</p> : null}
    </div>
  );
}

export function useJobInvoices(jobId, refresh) {
  const [invoices, setInvoices] = useState([]);
  useEffect(() => {
    let live = true;
    base44.entities.Invoices.filter({ job_id: jobId }, '-created_date', 100).then((rows) => { if (live) setInvoices(rows || []); }).catch(() => { if (live) setInvoices([]); });
    return () => { live = false; };
  }, [jobId, refresh]);
  return invoices;
}

export default function InvoicePanel({ job, budgets, invoices, onDone, onCancel }) {
  const [settings, setSettings] = useState(null), [loaded, setLoaded] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const sell = customerTotal(job, budgets);
  const hasQuoteLines = budgets.some((b) => (b.quote?.lines || []).length > 0);
  const [type, setType] = useState(() => (['', 'sent_to_customer', 'ordered'].includes(job.payment_status || '') && hasQuoteLines ? 'half' : 'full'));
  const [date, setDate] = useState(denverToday);
  const [number, setNumber] = useState('');
  const [numberTouched, setNumberTouched] = useState(false);
  const [billTo, setBillTo] = useState(() => defaultBillTo(job));
  const [project, setProject] = useState(() => defaultProject(job, budgets));
  const [options, setOptions] = useState(() => defaultOptions(type, { hasQuoteLines }));
  const [lines, setLines] = useState(() => defaultLines({ job, budgets, sell, itemize: options.itemize }));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    loadSettings().then((s) => {
      if (!live) return;
      setSettings(s); setLoaded(true);
      setOptions((o) => ({ ...o, wire: hasBankDetails(companyDetails(s || {})) }));
    }).catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);
  // The day's next YA number, from every invoice on record (all jobs), until typed over.
  useEffect(() => {
    if (numberTouched) return undefined;
    let live = true;
    base44.entities.Invoices.list('-created_date', 500).then((rows) => {
      if (live) setNumber(nextInvoiceNumber(date, (rows || []).map((r) => r.invoice_number)));
    }).catch(() => { if (live) setNumber(nextInvoiceNumber(date, [])); });
    return () => { live = false; };
  }, [date, numberTouched]);

  const company = companyDetails(settings || {});
  const bank = hasBankDetails(company);
  const attachments = {
    w9: settings?.invoice_w9_file_uri ? { uri: settings.invoice_w9_file_uri, name: settings.invoice_w9_file_name || 'W-9' } : null,
    coi: settings?.invoice_coi_file_uri ? { uri: settings.invoice_coi_file_uri, name: settings.invoice_coi_file_name || 'Certificate of insurance' } : null,
  };
  const received = useMemo(() => receivedSoFar({ sale: sell, stage: job.payment_status || '', invoices }).value, [sell, job.payment_status, invoices]);
  const totals = invoiceTotals(lines);
  const schedule = paymentSchedule(type, totals.total, received);
  const checks = invoiceChecks({ lines, sell, type, received, billTo });
  const taken = invoices.some((i) => i.invoice_number === number.trim());

  const pickType = (next) => { setType(next); setOptions((o) => ({ ...o, terms: next === 'half', signature: next === 'half' })); };
  const toggle = (key) => {
    const next = { ...options, [key]: !options[key] };
    setOptions(next);
    if (key === 'itemize') setLines(defaultLines({ job, budgets, sell, itemize: next.itemize }));
  };
  const patchLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const optionDisabled = (key) => (key === 'wire' && !bank) || (key === 'itemize' && !hasQuoteLines) || ((key === 'w9' || key === 'coi') && !attachments[key]);

  async function print() {
    if (busy) return;
    if (!number.trim()) { setError('Enter an invoice number.'); return; }
    if (taken) { setError(`${number} is already on this job. Use Download on it below, or change the number.`); return; }
    setBusy(true); setError('');
    const doc = {
      v: 1, type, number: number.trim(), date, received: type === 'final' ? received : 0,
      bill_to: billTo, project, lines: lines.map((l) => ({ ...l, amount: lineAmount(l) })), options,
      company, attachments: { w9: options.w9 ? attachments.w9 : null, coi: options.coi ? attachments.coi : null },
    };
    try {
      await downloadInvoice(doc);
      const t = invoiceType(type);
      await base44.entities.Invoices.create({
        invoice_number: doc.number, invoice_date: date, kind: t.kind, customer_name: billTo.name,
        job_id: job.id, amount: schedule.due, document: doc,
        notes: `${t.label} printed from Budget & Orders. Project total ${money(totals.total)}.`,
      });
      onDone(`Invoice ${doc.number} downloaded and recorded (${money(schedule.due)} due). Nothing was emailed.`);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  if (editingDetails) {
    return <PaymentDetails settings={settings} onCancel={() => setEditingDetails(false)} onSaved={(s) => { setSettings(s); setEditingDetails(false); setOptions((o) => ({ ...o, wire: hasBankDetails(companyDetails(s)) })); }} />;
  }

  return (
    <div className="flex flex-col gap-4 rounded-[10px] p-3.5" style={{ border: `1px solid ${EDGE}`, backgroundColor: '#FAF8F3' }}>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <Labeled label="Invoice type">
          <select value={type} onChange={(e) => pickType(e.target.value)} className={FIELD} style={FIELD_STYLE}>
            {INVOICE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Labeled>
        <Labeled label="Invoice #"><input value={number} onChange={(e) => { setNumber(e.target.value); setNumberTouched(true); }} className={FIELD} style={{ ...FIELD_STYLE, fontFamily: 'var(--font-mono)' }} /></Labeled>
        <Labeled label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} style={FIELD_STYLE} /></Labeled>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <div className="flex flex-col gap-2">
          <Labeled label="Bill to"><input value={billTo.name} onChange={(e) => setBillTo((b) => ({ ...b, name: e.target.value }))} className={FIELD} style={FIELD_STYLE} /></Labeled>
          <Labeled label="Attn (optional)"><input value={billTo.attn} onChange={(e) => setBillTo((b) => ({ ...b, attn: e.target.value }))} className={FIELD} style={FIELD_STYLE} placeholder="Accounts payable" /></Labeled>
          <Labeled label="Billing address"><input value={billTo.address} onChange={(e) => setBillTo((b) => ({ ...b, address: e.target.value }))} className={FIELD} style={FIELD_STYLE} /></Labeled>
        </div>
        <div className="flex flex-col gap-2">
          <Labeled label="Project"><input value={project.title} onChange={(e) => setProject((p) => ({ ...p, title: e.target.value }))} className={FIELD} style={FIELD_STYLE} /></Labeled>
          <Labeled label="Work description"><input value={project.detail} onChange={(e) => setProject((p) => ({ ...p, detail: e.target.value }))} className={FIELD} style={FIELD_STYLE} placeholder="Removal of old front door and install new door" /></Labeled>
          <Labeled label="Job site"><input value={project.address} onChange={(e) => setProject((p) => ({ ...p, address: e.target.value }))} className={FIELD} style={FIELD_STYLE} /></Labeled>
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] bg-white" style={{ border: `1px solid ${EDGE}` }}>
        <div className="grid gap-2 px-3 py-1.5 text-[13px] font-semibold [grid-template-columns:136px_minmax(0,1fr)_90px_60px_100px_100px_28px] max-[767px]:hidden" style={{ color: INK3, backgroundColor: '#FAF8F3' }}>
          <span>Line</span><span>Description</span><span>Size</span><span className="text-right">Qty</span><span className="text-right">Unit / amount</span><span className="text-right">Amount</span><span />
        </div>
        {lines.map((l, idx) => (
          <div key={idx} className="grid items-center gap-2 px-3 py-1.5 [grid-template-columns:136px_minmax(0,1fr)_90px_60px_100px_100px_28px] max-[767px]:[grid-template-columns:1fr_1fr]" style={{ borderTop: `1px solid ${RULE}` }}>
            <select aria-label="Line type" value={l.kind} onChange={(e) => patchLine(idx, e.target.value === 'item' ? { kind: 'item', qty: 1, unit: lineAmount(l) } : { kind: 'charge', amount: lineAmount(l) })} className={FIELD} style={FIELD_STYLE}>
              <option value="item">Window / door</option>
              <option value="charge">Labor / other</option>
            </select>
            <input aria-label="Description" value={l.description} onChange={(e) => patchLine(idx, { description: e.target.value })} className={`${FIELD} max-[767px]:col-span-2`} style={FIELD_STYLE} />
            {l.kind === 'item' ? (
              <>
                <input aria-label="Size" value={l.size || ''} onChange={(e) => patchLine(idx, { size: e.target.value })} className={FIELD} style={FIELD_STYLE} placeholder="35 × 71" />
                <input aria-label="Qty" inputMode="decimal" value={l.qty ?? ''} onChange={(e) => patchLine(idx, { qty: e.target.value })} className={`${FIELD} text-right`} style={FIELD_STYLE} />
                <input aria-label="Unit price" inputMode="decimal" value={l.unit ?? ''} onChange={(e) => patchLine(idx, { unit: e.target.value })} className={`${FIELD} text-right`} style={FIELD_STYLE} />
              </>
            ) : (
              <>
                <span className="max-[767px]:hidden" /><span className="max-[767px]:hidden" />
                <input aria-label="Amount" inputMode="decimal" value={l.amount ?? ''} onChange={(e) => patchLine(idx, { amount: e.target.value })} className={`${FIELD} text-right`} style={FIELD_STYLE} />
              </>
            )}
            <span className="text-right text-[13.5px] font-semibold tabular-nums" style={{ color: INK }}>{money(lineAmount(l))}</span>
            <button type="button" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="inline-flex h-8 w-7 items-center justify-center rounded-[7px] hover:bg-black/5" style={{ color: INK3 }}><X className="h-4 w-4" /></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-[13.5px]" style={{ borderTop: `1.5px solid #9A9080`, backgroundColor: '#FAF8F3', color: INK }}>
          <button type="button" onClick={() => setLines((ls) => [...ls, { kind: 'charge', description: '', amount: '' }])} className="inline-flex items-center gap-1 font-medium" style={{ color: INK3 }}><Plus className="h-4 w-4" />Add line</button>
          <span className="flex-1" />
          <span>Project total <strong className="tabular-nums">{money(totals.total)}</strong></span>
          <span>{type === 'half' ? 'Deposit due' : type === 'final' ? `Received ${money(received)} · due` : 'Due'} <strong className="tabular-nums">{money(schedule.due)}</strong></span>
        </div>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13.5px] font-semibold" style={{ color: INK }}>Add to this invoice</legend>
        <div className="grid gap-x-5 gap-y-1.5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {INVOICE_OPTIONS.map((o) => {
            const off = optionDisabled(o.key);
            const why = o.key === 'wire' && !bank ? ' · add bank details first' : (o.key === 'w9' || o.key === 'coi') && off ? ' · upload it in Payment details' : '';
            return (
              <label key={o.key} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: off ? INK2 : INK }}>
                <input type="checkbox" checked={Boolean(options[o.key]) && !off} disabled={off} onChange={() => toggle(o.key)} className="h-4 w-4" />
                {o.label}{why}
              </label>
            );
          })}
        </div>
      </fieldset>

      {checks.length ? <ul className="flex flex-col gap-1 rounded-[9px] px-3 py-2 text-[13.5px]" style={{ backgroundColor: '#FAF0DA', border: '1px solid #EFDFB7', color: '#6F4E10' }}>{checks.map((c) => <li key={c}>{c}</li>)}</ul> : null}
      {error ? <p role="alert" className="text-[13.5px] font-semibold" style={{ color: RED }}>{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !loaded} onClick={print} className={BTN} style={PRI}><Download className="h-4 w-4" />{busy ? 'Building…' : 'Download invoice PDF'}</button>
        <button type="button" disabled={busy || !loaded} onClick={() => setEditingDetails(true)} className={BTN} style={SEC}>Payment details</button>
        <button type="button" disabled={busy} onClick={onCancel} className={BTN} style={SEC}>Cancel</button>
      </div>
    </div>
  );
}
