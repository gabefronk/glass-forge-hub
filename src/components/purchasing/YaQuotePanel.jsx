// Make YA quote (Gabe, Oct 31): from a supplier quote budget, a copy that looks the same but
// carries Y A Windows & Doors' details and logo (distributor names, addresses, phones, faxes,
// emails and sales reps covered) with every price at sell, a YA summary / approval page and
// the flashing / install method guide the customer picks from Drive › INSTALL BUDGET SHEET ›
// Install Type Guides. Saved to the job's Drive folder and downloaded; the method is saved on
// the job for the installers. Nothing is emailed.
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';
import { companyDetails } from '@/lib/yaInvoice';
import { productSell, quoteTotal, priceFactor, guideLabel, money } from '@/lib/quoteRebrand';
import { uploadToJobFolder } from '@/lib/jobFileUpload';

const INK = '#101617', INK3 = '#34403F', EDGE = '#E2DCD1', RED = '#A43432';
const BTN = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium no-underline disabled:opacity-60';
const SEC = { border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: INK3 };
const PRI = { border: '1px solid #0B3F3B', backgroundColor: '#0B3F3B', color: '#FFFFFF', fontWeight: 600 };
const invoke = (name, body) => base44.functions.invoke(name, body);
const dataOf = (r) => { const d = r?.data ?? r; if (d?.error) throw new Error(d.error); return d; };
const safeHref = (v) => { try { return v && new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; } };

function fromBase64(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; }

// The private copy the quote reader kept, else the quote's own PDF link.
async function sourceBytes(budget) {
  const signed = await invoke('purchasingQuoteIngest', { action: 'sign_source', budget_id: budget.id }).then((r) => dataOf(r).signed_url).catch(() => '');
  const url = signed || safeHref(budget.source_pdf_url);
  if (!url) throw new Error('The original quote PDF is not on file for this budget.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load the original quote (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function guideBytes(jobId, fileId) {
  const parts = []; let offset = 0;
  for (;;) {
    const r = dataOf(await invoke('job-documents', { action: 'guide_chunk', job_id: jobId, file_id: fileId, offset }));
    const bytes = fromBase64(r.data); parts.push(bytes); offset += bytes.length;
    if (r.done || !bytes.length) break;
  }
  const out = new Uint8Array(offset); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export default function YaQuotePanel({ job, budget, onDone, onCancel }) {
  const [guides, setGuides] = useState(null), [guideId, setGuideId] = useState(job.flashing_guide_file_id || '');
  const [settings, setSettings] = useState(null);
  const [step, setStep] = useState(''), [error, setError] = useState('');
  const split = productSell(budget);
  const factor = split ? priceFactor(quoteTotal(budget), split.product) : null;
  const brand = budget.manufacturer || budget.quote?.manufacturer || '';
  const quoteLabel = [brand, budget.quote_number ? `quote ${budget.quote_number}` : ''].filter(Boolean).join(' ') || 'quote';

  useEffect(() => {
    let live = true;
    invoke('job-documents', { action: 'install_guides', job_id: job.id }).then((r) => { if (live) setGuides(dataOf(r).guides || []); }).catch((e) => { if (live) { setGuides([]); setError(messageOf(e)); } });
    base44.entities.AppSettings.list('-created_date', 5).then((rows) => { if (live) setSettings(rows?.[0] || {}); }).catch(() => { if (live) setSettings({}); });
    return () => { live = false; };
  }, [job.id]);

  async function build() {
    if (step || !split || !factor) return;
    setError('');
    try {
      const guide = (guides || []).find((g) => g.id === guideId) || null;
      setStep('Reading the supplier quote…');
      const src = await sourceBytes(budget);
      const gBytes = guide ? (setStep('Getting the install guide…'), await guideBytes(job.id, guide.id)) : null;
      setStep('Building the YA quote…');
      const { buildYaQuote } = await import('@/lib/quoteRebrandRender');
      const { bytes, supplier } = await buildYaQuote({ sourceBytes: src, factor, company: companyDetails(settings || {}), job, quoteLabel, split, guideName: guide ? guideLabel(guide.name) : '', guideBytes: gBytes });
      const name = `${job.canonical_name || 'Job'} - YA Quote${budget.quote_number ? ` ${budget.quote_number}` : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
      const { saveBytes } = await import('@/lib/yaInvoicePdf');
      saveBytes(bytes, name);
      setStep('Saving to the job’s Drive folder…');
      const file = await uploadToJobFolder({ invoke, jobId: job.id, file: new File([bytes], name, { type: 'application/pdf' }) });
      await base44.entities.JobBudgets.update(budget.id, { ya_quote_file_id: file.id, ya_quote_url: file.url, ya_quote_at: new Date().toISOString() });
      await base44.entities.Jobs.update(job.id, guide
        ? { flashing_method: guideLabel(guide.name), flashing_guide_file_id: guide.id, flashing_guide_url: guide.url }
        : { flashing_method: null, flashing_guide_file_id: null, flashing_guide_url: null });
      onDone(`YA quote saved to ${file.folder?.name || 'the job folder'} and downloaded${guide ? `, with ${guideLabel(guide.name)}` : ''}.${supplier === 'generic' ? ' This quote layout is not mapped yet: check that no supplier details are left.' : ''} Nothing was emailed.`);
    } catch (e) { setError(messageOf(e)); } finally { setStep(''); }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] p-3.5" style={{ border: `1px solid ${EDGE}`, backgroundColor: '#FAF8F3' }}>
      <h4 className="text-[14px] font-semibold" style={{ color: INK }}>Make YA quote</h4>
      {split ? (
        <p className="text-[13.5px]" style={{ color: INK3 }}>
          The supplier&apos;s details are covered with YA&apos;s and every price goes to sell: this quote comes to <strong style={{ color: INK }}>{money(split.product)}</strong>
          {split.install > 0 ? <> plus <strong style={{ color: INK }}>{money(split.install)}</strong> installation</> : null} = <strong style={{ color: INK }}>{money(split.sell)}</strong>.
        </p>
      ) : <p role="alert" className="text-[13.5px] font-semibold" style={{ color: RED }}>Add the customer price with Edit numbers first, so the quote can be priced at sell.</p>}
      <label className="flex max-w-[520px] flex-col gap-1 text-[13px] font-medium" style={{ color: INK3 }}>
        Flashing / install method (sent with the quote for approval)
        <select value={guideId} onChange={(e) => setGuideId(e.target.value)} disabled={!guides || Boolean(step)} className="h-9 rounded-[8px] border bg-white px-2.5 text-[13.5px]" style={{ borderColor: EDGE, color: INK }}>
          <option value="">{guides ? 'No install guide' : 'Loading guides…'}</option>
          {(guides || []).map((g) => <option key={g.id} value={g.id}>{guideLabel(g.name)}</option>)}
        </select>
      </label>
      {error ? <p role="alert" className="text-[13.5px] font-semibold" style={{ color: RED }}>{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={Boolean(step) || !split || !factor || !settings} onClick={build} className={BTN} style={PRI}>{step || 'Make YA quote'}</button>
        <button type="button" disabled={Boolean(step)} onClick={onCancel} className={BTN} style={SEC}>Cancel</button>
      </div>
    </div>
  );
}
