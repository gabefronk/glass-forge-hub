// The order email for one PO (Gabriel, Oct 30). The Hub fills it in the way he writes it
// (orderEmail prepare): his Outlook mailbox, the supplier's order contacts, "Campbell addition -
// Order - YA-0022", the greeting, the total and the vendor quote PDF. He can change any of
// it, then Send order email, or Save as Outlook draft. If Outlook won't let the Hub send, the
// email is kept as a draft and the panel links to it.
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Loader2, Paperclip, Send } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const INK = '#101617', INK2 = '#566063', RULE = '#EEE9E0', EDGE = '#E2DCD1', TEAL = '#0B3F3B', RED = '#A43432';
const BTN = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium no-underline disabled:opacity-60';
const SEC = { border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: '#34403F' };
const PRI = { border: `1px solid ${TEAL}`, backgroundColor: TEAL, color: '#FFFFFF', fontWeight: 600 };
const FIELD = 'w-full min-w-0 rounded-[9px] border bg-white px-2.5 py-2 text-[14px]';
const errorText = (e) => e?.response?.data?.error || e?.message || 'The order email could not be sent.';
const DRAFT_REASON = {
  no_send_permission: 'The Hub’s Outlook connection can save drafts but not send yet. Open the draft and click Send.',
  no_attachment: 'No quote PDF was found to attach, so it was not sent. Attach the quote in Outlook, then send.',
  attachment_too_large: 'The quote PDF is over 3 MB, so it was not attached or sent. Attach it in Outlook, then send.',
};
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

function Row({ label, children }) {
  return (
    <div className="grid items-start gap-3 py-2 [grid-template-columns:96px_minmax(0,1fr)] max-[599px]:[grid-template-columns:1fr]" style={{ borderTop: `1px solid ${RULE}` }}>
      <span className="pt-2 text-[13px] font-semibold" style={{ color: INK2 }}>{label}</span>
      <div className="min-w-0 text-[14px]" style={{ color: INK }}>{children}</div>
    </div>
  );
}

export default function OrderEmailPanel({ po, onDone, onCancel }) {
  const [prep, setPrep] = useState(null), [loadError, setLoadError] = useState('');
  const [to, setTo] = useState(''), [subject, setSubject] = useState(''), [body, setBody] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [drafted, setDrafted] = useState(null);
  const key = useRef(crypto.randomUUID());

  useEffect(() => {
    let on = true;
    base44.functions.invoke('orderEmail', { action: 'prepare', po_id: po.id })
      .then((r) => {
        const d = r?.data ?? r;
        if (d?.error) throw new Error(d.error);
        if (!on) return;
        setPrep(d); setTo(d.draft.to.join(', ')); setSubject(d.draft.subject); setBody(d.draft.body);
      })
      .catch((e) => { if (on) setLoadError(errorText(e)); });
    return () => { on = false; };
  }, [po.id]);

  const alreadySent = prep?.last?.status === 'sent';
  async function go(action) {
    if (busy) return;
    setBusy(action); setError('');
    try {
      const r = (await base44.functions.invoke('orderEmail', { action, po_id: po.id, request_key: key.current, to, subject, body, resend: alreadySent })).data;
      if (r?.error) throw new Error(r.error);
      key.current = crypto.randomUUID();
      if (r.status === 'sent') onDone(r, `Order emailed to ${r.to.join(', ')} from ${r.from || 'Outlook'}. ${po.po_number} is now Sent to supplier.`);
      else setDrafted(r);
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }

  return (
    <section className="flex flex-col gap-1 rounded-[12px] p-4" style={{ border: '1px solid #C7E4D2', backgroundColor: '#FFFFFF' }} aria-label={`Order email for ${po.po_number}`}>
      <h3 className="text-[15px] font-bold" style={{ color: INK }}>Order email · {po.po_number} · {po.vendor || 'Supplier'}</h3>
      {!prep && !loadError ? <p className="flex items-center gap-2 py-2 text-[13px]" style={{ color: INK2 }}><Loader2 className="h-4 w-4 animate-spin" />Filling in the email…</p> : null}
      {loadError ? <p role="alert" className="py-2 text-[13px] font-semibold" style={{ color: RED }}>{loadError}</p> : null}
      {drafted ? (
        <div className="flex flex-col gap-2 py-2 text-[14px]" style={{ color: INK }}>
          <p className="font-semibold">Saved as a draft in Outlook{prep?.from ? ` (${prep.from})` : ''}.</p>
          <p className="text-[13px]" style={{ color: INK2 }}>{DRAFT_REASON[drafted.reason] || 'Open it in Outlook to check it and click Send.'}</p>
          <div className="flex flex-wrap gap-2">
            {drafted.link ? <a href={drafted.link} target="_blank" rel="noreferrer" className={BTN} style={PRI}>Open draft in Outlook<ArrowUpRight className="h-4 w-4" /></a> : null}
            <button type="button" onClick={() => onDone(drafted, `Order email for ${po.po_number} saved as an Outlook draft.`)} className={BTN} style={SEC}>Done</button>
          </div>
        </div>
      ) : prep ? (
        <>
          {prep.last ? <p className="pb-1 text-[13px]" style={{ color: INK2 }}>{prep.last.status === 'sent' ? 'Already emailed' : 'Saved as a draft'} {shortDate(prep.last.at)} to {prep.last.to.join(', ')}.</p> : null}
          <Row label="From">{prep.from || <span style={{ color: RED }}>Outlook mailbox unknown - check the Outlook connection</span>}</Row>
          <Row label="To"><input aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setError(''); }} className={FIELD} style={{ borderColor: EDGE, color: INK }} placeholder="name@supplier.com, another@example.com" /></Row>
          <Row label="Subject"><input aria-label="Subject" value={subject} onChange={(e) => { setSubject(e.target.value); setError(''); }} className={FIELD} style={{ borderColor: EDGE, color: INK }} /></Row>
          <Row label="Message"><textarea aria-label="Message" rows={9} value={body} onChange={(e) => { setBody(e.target.value); setError(''); }} className={`${FIELD} leading-relaxed`} style={{ borderColor: EDGE, color: INK, fontFamily: 'Calibri, Arial, sans-serif', fontSize: 15 }} /></Row>
          <Row label="Attachment">
            {prep.attachment
              ? <span className="inline-flex items-center gap-1.5 pt-2"><Paperclip className="h-4 w-4" style={{ color: INK2 }} />{prep.attachment.name}</span>
              : <span className="inline-block pt-2" style={{ color: RED }}>No quote PDF on this PO&apos;s budget. It can only be saved as a draft to attach by hand.</span>}
          </Row>
          {error ? <p role="alert" className="pt-1 text-[13px] font-semibold" style={{ color: RED }}>{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: `1px solid ${RULE}` }}>
            <button type="button" disabled={Boolean(busy) || !prep.attachment} onClick={() => go('send')} className={BTN} style={PRI}>
              {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{alreadySent ? 'Send again' : 'Send order email'}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => go('draft')} className={BTN} style={SEC}>{busy === 'draft' ? 'Saving…' : 'Save as Outlook draft'}</button>
            <button type="button" disabled={Boolean(busy)} onClick={onCancel} className={BTN} style={SEC}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="pt-2"><button type="button" onClick={onCancel} className={BTN} style={SEC}>Close</button></div>
      )}
    </section>
  );
}
