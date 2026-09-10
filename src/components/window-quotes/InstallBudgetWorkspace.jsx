import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Plus, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { inputClass, secondaryClass } from './TakeoffEditor';
import InstallBudgetEditor, { installMoney } from './InstallBudgetEditor';
import { newInstallBudget } from '../../../base44/shared/installBudget.js';

const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#2A5EA8] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50';
const errorText = e => e?.response?.data?.error || e?.message || 'The budget could not be saved. Please try again.';
async function api(action, data = {}) { const response = await base44.functions.invoke('windowQuotes', { action, ...data }); if (response.data?.error) throw new Error(response.data.error); return response.data; }

export function QuoteInstallPanel({ quote, onSaved }) {
  const [config, setConfig] = useState(() => structuredClone(quote.install_budget || newInstallBudget()));
  const [revision, setRevision] = useState(quote.install_revision || 0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const accepted = quote.sales_status === 'won' || !!quote.accepted_revision || !!quote.job_id;
  const totals = quote.result?.totals || {};
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('update_install', { quote_id: quote.id, expected_install_revision: revision, install_budget: config });
      setConfig(result.quote.install_budget); setRevision(result.quote.install_revision); setDirty(false); setNotice('Installation saved. Quote totals now include the selected install.');
      await onSaved?.();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <div className="space-y-4"><div><h3 className="text-lg font-semibold text-[#131A26]">Install budget</h3><p className="mt-1 text-sm text-[#616D81]">Connected to this window schedule. Sizes and quantities update from the quote.</p></div>
    {accepted && <p className="rounded-lg bg-[#EAF5EE] p-3 text-sm text-[#276449]">Accepted installation budget. Create a revised quote to change it.</p>}
    {error && <p role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error}</p>}{notice && <p role="status" className="text-sm text-[#276449]">{notice}</p>}
    <InstallBudgetEditor lines={quote.lines || []} config={config} onChange={value => { setConfig(value); setDirty(true); setNotice(''); }} context={{ linked: true, settings: quote.settings, product_cost: totals.dealer_total ?? totals.dealer_cost, product_sell: quote.worker_status === 'ready' && quote.result?.verified ? totals.total ?? totals.customer_total : null }} disabled={busy || accepted} />
    {!accepted && <div className="sticky bottom-2 flex flex-wrap items-center gap-3 rounded-xl border border-[#DDE3EC] bg-white p-3 shadow-sm"><button type="button" className={primary} onClick={save} disabled={busy || !dirty}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Save installation</button><span className="text-xs text-[#616D81]">{dirty ? 'Unsaved changes. Save before leaving this tab.' : 'Installation is saved with this quote.'}</span></div>}
  </div>;
}

export default function InstallBudgetWorkspace({ quotes = [], onBack, onQuote }) {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['installBudgets'], queryFn: () => api('install_list'), retry: 1 });
  const [record, setRecord] = useState(null), [title, setTitle] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [config, setConfig] = useState(() => newInstallBudget(true));
  const [lines, setLines] = useState(() => [{ id: crypto.randomUUID(), label: '', qty: 1, width: '', height: '', units: 'in' }]);
  const [selectedQuote, setSelectedQuote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false), [dirty, setDirty] = useState(false);
  const mayLeave = () => !dirty || window.confirm('Discard unsaved install budget changes?');
  const reset = () => { if (!mayLeave()) return; setRecord(null); setTitle(''); setConfig(newInstallBudget(true)); setLines([{ id: crypto.randomUUID(), label: '', qty: 1, width: '', height: '', units: 'in' }]); setRequestId(crypto.randomUUID()); setError(''); setSaved(false); setDirty(false); };
  const open = async id => {
    if (!mayLeave()) return;
    setBusy(true); setError('');
    try { const { budget } = await api('install_detail', { budget_id: id }); setRecord(budget); setTitle(budget.title); setLines(budget.lines || []); setConfig(budget.install_budget); setRequestId(budget.request_id); setDirty(false); setSaved(false); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const result = await api('install_save', { budget_id: record?.id, expected_version: record?.version || 0, request_id: requestId, title, lines: lines.map(line => ({ ...line, qty: Number(line.qty), width: line.width === '' ? '' : Number(line.width), height: line.height === '' ? '' : Number(line.height) })), install_budget: config });
      setRecord(result.budget); setConfig(result.budget.install_budget); setDirty(false); setSaved(true); await client.invalidateQueries({ queryKey: ['installBudgets'] });
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <div className="min-h-screen bg-[#F6F8FC] px-4 py-5 sm:px-6">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><button className="mb-2 flex min-h-11 items-center gap-2 text-sm text-[#1E4A85]" disabled={busy} onClick={() => { if (mayLeave()) onBack(); }}><ArrowLeft size={15} />Window Quotes</button><h1 className="font-heading text-[28px] font-semibold text-[#131A26]">Install Budget</h1><p className="mt-1 text-sm text-[#616D81]">Quick labor and material budgeting from the 2026 BFS price sheet.</p></div><button type="button" className={secondaryClass} disabled={busy} onClick={reset}><Plus size={16} />New budget</button></header>
    <section className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[#DDE3EC] bg-white p-4"><label className="min-w-[220px] flex-1 text-xs font-semibold text-[#535E72]">Start from a window quote<select className={inputClass + ' mt-1.5'} value={selectedQuote} onChange={e => setSelectedQuote(e.target.value)} disabled={busy}><option value="">Choose a quote</option>{quotes.map(quote => <option key={quote.id} value={quote.id}>{quote.title || 'Window quote'} · {quote.lines?.reduce((sum, line) => sum + (Number(line.qty) || 0), 0) || 0} units</option>)}</select></label><button type="button" className={secondaryClass} disabled={!selectedQuote || busy} onClick={() => { if (mayLeave()) onQuote(selectedQuote); }}>Use quote sizes and quantities</button></section>
    <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)]"><aside className="rounded-xl border border-[#DDE3EC] bg-white p-3"><h2 className="p-2 text-sm font-semibold">Saved install budgets</h2>{list.isPending ? <p className="p-2 text-sm text-[#616D81]">Loading budgets…</p> : list.isError ? <p role="alert" className="p-2 text-sm text-[#8A4038]">{errorText(list.error)}</p> : list.data?.budgets?.length ? list.data.budgets.map(budget => <button key={budget.id} type="button" className={'mb-1 block w-full rounded-lg p-3 text-left ' + (record?.id === budget.id ? 'bg-[#E7EEFA]' : 'hover:bg-[#F6F8FC]')} disabled={busy} onClick={() => open(budget.id)}><span className="block break-words text-sm font-semibold">{budget.title}</span><span className="mt-1 block text-xs text-[#616D81]">Install sale {installMoney(budget.summary?.sell)} · Cost {installMoney(budget.summary?.cost)}</span></button>) : <p className="p-2 text-sm text-[#616D81]">Saved estimates appear here.</p>}</aside>
      <main className="min-w-0 rounded-2xl border border-[#DDE3EC] bg-white p-4 sm:p-5"><label className="mb-4 block text-xs font-semibold text-[#535E72]">Job / budget name<input className={inputClass + ' mt-1.5'} value={title} maxLength={200} disabled={busy} onChange={e => { setTitle(e.target.value); setDirty(true); setSaved(false); }} placeholder="Builder · Job or lot" /></label>{error && <p role="alert" className="mb-4 rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error}</p>}{saved && <p role="status" className="mb-3 text-sm text-[#276449]">Budget saved.</p>}<InstallBudgetEditor lines={lines} config={config} onChange={value => { setConfig(value); setDirty(true); setSaved(false); }} onLinesChange={value => { setLines(value); setDirty(true); setSaved(false); }} standalone disabled={busy} />
      <div className="sticky bottom-2 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#DDE3EC] bg-white p-3 shadow-sm"><button className={primary} type="button" disabled={busy || !title.trim()} onClick={save}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Save budget</button>{dirty && <span className="text-xs text-[#616D81]">Unsaved changes</span>}</div></main>
    </div>
  </div>;
}
