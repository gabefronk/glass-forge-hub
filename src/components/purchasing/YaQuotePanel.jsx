// Make YA quote (Gabe, Oct 31): from a supplier quote budget, a copy that looks the same but
// carries Y A Windows & Doors' details and logo (distributor names, addresses, phones, faxes,
// emails and sales reps covered) with every price at sell, a YA summary / approval page and
// the flashing / install method guide the customer picks from the Hub's Install guides (the
// builder's default preselected). Preview shows it in the panel; Save puts it in the job's Drive
// folder and pins that guide version on the job for the installers. Nothing is emailed.
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';
import { companyDetails } from '@/lib/yaInvoice';
import { productSell, quoteTotal, priceFactor, money } from '@/lib/quoteRebrand';
import { builderDefault, jobGuidePatch, pdfProblem, sortGuides } from '@/lib/installGuides';
import { uploadToJobFolder } from '@/lib/jobFileUpload';

const INK = '#101617', INK3 = '#34403F', EDGE = '#E2DCD1', RED = '#A43432';
const BTN = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium no-underline disabled:opacity-60';
const SEC = { border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: INK3 };
const PRI = { border: '1px solid #0B3F3B', backgroundColor: '#0B3F3B', color: '#FFFFFF', fontWeight: 600 };
const invoke = (name, body) => base44.functions.invoke(name, body);
const dataOf = (r) => { const d = r?.data ?? r; if (d?.error) throw new Error(d.error); return d; };
const safeHref = (v) => { try { return v && new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; } };

// The private copy the quote reader kept, else the quote's own PDF link.
async function sourceBytes(budget) {
  const signed = await invoke('purchasingQuoteIngest', { action: 'sign_source', budget_id: budget.id }).then((r) => dataOf(r).signed_url).catch(() => '');
  const url = signed || safeHref(budget.source_pdf_url);
  if (!url) throw new Error('The original quote PDF is not on file for this budget.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load the original quote (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

// The guide's current version, from its private Hub file.
async function guideBytes(guide) {
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: guide.file_uri, expires_in: 300 });
  const res = await fetch(signed_url);
  if (!res.ok) throw new Error(`Couldn't load the ${guide.name} guide (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const problem = pdfProblem(bytes, guide.name);
  if (problem) throw new Error(problem);
  return bytes;
}

export default function YaQuotePanel({ job, budget, onDone, onCancel }) {
  const [guides, setGuides] = useState(null), [guideId, setGuideId] = useState('');
  const [settings, setSettings] = useState(null);
  const [step, setStep] = useState(''), [error, setError] = useState('');
  const [built, setBuilt] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(''), [pages, setPages] = useState([]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const split = productSell(budget);
  const factor = split ? priceFactor(quoteTotal(budget), split.product) : null;
  const brand = budget.manufacturer || budget.quote?.manufacturer || '';
  const quoteLabel = [brand, budget.quote_number ? `quote ${budget.quote_number}` : ''].filter(Boolean).join(' ') || 'quote';

  useEffect(() => {
    let live = true;
    // The job's saved guide while it is still offered, else the builder's default.
    base44.entities.InstallGuides.list('sort_order', 200).then((rows) => {
      if (!live) return;
      const list = sortGuides(rows || []);
      setGuides(list);
      setGuideId((list.find((g) => g.id === job.flashing_guide_id) || builderDefault(list, job.builder))?.id || '');
    }).catch((e) => { if (live) { setGuides([]); setError(messageOf(e)); } });
    base44.entities.AppSettings.list('-created_date', 5).then((rows) => { if (live) setSettings(rows?.[0] || {}); }).catch(() => { if (live) setSettings({}); });
    return () => { live = false; };
  }, [job.id, job.flashing_guide_id, job.builder]);

  // Built once per guide choice; Preview and Save use the same file.
  async function make() {
    const guide = (guides || []).find((g) => g.id === guideId) || null;
    if (built && built.guideId === guideId) return { ...built, guide };
    setStep('Reading the supplier quote…');
    const src = await sourceBytes(budget);
    const gBytes = guide ? (setStep('Getting the install guide…'), await guideBytes(guide)) : null;
    setStep('Building the YA quote…');
    const { buildYaQuote } = await import('@/lib/quoteRebrandRender');
    const { bytes, supplier } = await buildYaQuote({ sourceBytes: src, factor, company: companyDetails(settings || {}), job, quoteLabel, split, guideName: guide ? guide.name : '', guideBytes: gBytes });
    const name = `${job.canonical_name || 'Job'} - YA Quote${budget.quote_number ? ` ${budget.quote_number}` : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
    const next = { bytes, supplier, name, guideId };
    setBuilt(next);
    return { ...next, guide };
  }

  // Shown in the panel as page images: a script-opened tab can't be pointed at the file, and
  // Chrome may be set to download PDFs instead of showing them.
  async function preview() {
    if (step || !split || !factor) return;
    setError('');
    try {
      const { bytes } = await make();
      setStep('Drawing the preview…');
      const { previewImages } = await import('@/lib/quoteRebrandRender');
      setPages(await previewImages(bytes));
      setPreviewUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
    } catch (e) { setError(messageOf(e)); } finally { setStep(''); }
  }

  async function build() {
    if (step || !split || !factor) return;
    setError('');
    try {
      const { bytes, supplier, name, guide } = await make();
      setStep('Saving to the job’s Drive folder…');
      const file = await uploadToJobFolder({ invoke, jobId: job.id, file: new File([bytes], name, { type: 'application/pdf' }) });
      await base44.entities.JobBudgets.update(budget.id, { ya_quote_file_id: file.id, ya_quote_url: file.url, ya_quote_at: new Date().toISOString() });
      await base44.entities.Jobs.update(job.id, jobGuidePatch(guide));
      onDone(`YA quote saved to ${file.folder?.name || 'the job folder'}${guide ? `, with ${guide.name} (version ${guide.version || 1})` : ''}.${supplier === 'generic' ? ' This quote layout is not mapped yet: check that no supplier details are left.' : ''} Nothing was emailed.`);
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
        <select value={guideId} onChange={(e) => { setGuideId(e.target.value); setPreviewUrl(''); setPages([]); }} disabled={!guides || Boolean(step)} className="h-9 rounded-[8px] border bg-white px-2.5 text-[13.5px]" style={{ borderColor: EDGE, color: INK }}>
          <option value="">{guides ? 'No install guide' : 'Loading guides…'}</option>
          {(guides || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      {error ? <p role="alert" className="text-[13.5px] font-semibold" style={{ color: RED }}>{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={Boolean(step) || !split || !factor || !settings} onClick={build} className={BTN} style={PRI}>{step || 'Save to job Drive folder'}</button>
        <button type="button" disabled={Boolean(step) || !split || !factor || !settings} onClick={preview} className={BTN} style={SEC}>Preview</button>
        <button type="button" disabled={Boolean(step)} onClick={onCancel} className={BTN} style={SEC}>Cancel</button>
        {previewUrl ? <a href={previewUrl} target="_blank" rel="noreferrer" className="text-[13.5px] font-semibold underline-offset-2 hover:underline" style={{ color: '#0B3F3B' }}>Open in a new tab</a> : null}
      </div>
      {pages.length ? (
        <div aria-label="YA quote preview" className="flex max-h-[760px] flex-col items-center gap-3 overflow-auto rounded-[8px] p-3" style={{ border: `1px solid ${EDGE}`, backgroundColor: '#E9E5DC' }}>
          {pages.map((src, i) => <img key={i} src={src} alt={`Page ${i + 1}`} className="w-full max-w-[900px] bg-white shadow-sm" />)}
        </div>
      ) : null}
    </div>
  );
}
