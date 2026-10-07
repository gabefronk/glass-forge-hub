import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isPurchasingMoneyOwner } from '@/lib/purchasingMoneyAccess';
import { purchasingRequest, messageOf } from '@/components/budgets/ProcurementForms';
import { buildPurchasingCards, cardMatchesSearch, unlinkedEntities } from '@/lib/purchasingViewModel';
import { PageShell } from '@/components/PageShell';
import PurchasingHeader from '@/components/purchasing/PurchasingHeader';
import PageNotFound from '@/lib/PageNotFound';
import PurchasingCard from '@/components/purchasing/PurchasingCard';
import MoneyEditDialog from '@/components/purchasing/MoneyEditDialog';
import UnlinkedReview from '@/components/purchasing/UnlinkedReview';
import { C } from '@/lib/feeUI';

// Inlined twin of denverDate (base44/shared/billingCore.js) — platform guard
// blocks new src files from importing base44/shared. America/Denver today.
const denverDate = (value = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

export default function Purchasing() {
  const { user } = useAuth();
  if (!isPurchasingMoneyOwner(user)) return <PageNotFound />;
  return <PurchasingWorkspace />;
}

function PurchasingWorkspace() {
  const [data, setData] = useState(null);
  const [moneyInputs, setMoneyInputs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moneyError, setMoneyError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [addQuoteSignal, setAddQuoteSignal] = useState(0);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const v = ++loadSeq.current;
    setLoading(true); setError(''); setMoneyError('');
    try {
      const overview = await purchasingRequest({ action: 'overview' });
      // Money list: surface backend errors — no silent empty fallback. A
      // failure withholds money tiles and shows a visible warning, but the
      // job cards still render from the procurement overview.
      let money = [];
      try {
        const moneyRes = await base44.functions.invoke('purchasingMoney', { action: 'list' });
        const r = moneyRes?.data ?? moneyRes;
        if (!r || !Array.isArray(r.inputs)) throw new Error('invalid_money_response');
        money = r.inputs;
      } catch (e) {
        if (v === loadSeq.current) setMoneyError('Money data unavailable: ' + messageOf(e));
      }
      if (v !== loadSeq.current) return;
      setData(overview);
      setMoneyInputs(money);
    } catch (e) {
      if (v === loadSeq.current) setError(messageOf(e));
    } finally {
      if (v === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); return () => { loadSeq.current++; }; }, [load]);

  const today = denverDate();
  const cards = useMemo(() => (data ? buildPurchasingCards({
    jobs: data.jobs, budgets: data.budgets, purchase_orders: data.purchase_orders,
    vendor_orders: data.vendor_orders, moneyInputs, conflicts: data.conflicts, today,
  }) : []), [data, moneyInputs, today]);
  const filtered = useMemo(() => cards.filter((c) => cardMatchesSearch(c, query)), [cards, query]);
  const unlinked = useMemo(() => (data ? unlinkedEntities({ budgets: data.budgets, purchase_orders: data.purchase_orders }) : { unlinkedQuotes: [], shopPOs: [] }), [data]);
  const counts = useMemo(() => ({
    jobs: cards.length,
    budgets: data?.budgets?.length || 0,
    orders: data?.purchase_orders?.length || 0,
    tracking: data?.vendor_orders?.length || 0,
  }), [cards, data]);

  const saveMoney = async (payload) => {
    if (!editing) return;
    setSaving(true); setEditError('');
    try {
      const res = await base44.functions.invoke('purchasingMoney', { action: 'save', job_id: editing.jobId, ...payload });
      const r = res?.data ?? res;
      if (r?.error) throw new Error(r.error);
      // No fake readback: only the backend-returned row updates state. On
      // failure the previous values are preserved (no stale wipe).
      if (!r.input) throw new Error('no_input_returned');
      const item = r.input;
      setMoneyInputs((prev) => {
        const idx = prev.findIndex((m) => m.job_id === editing.jobId);
        return idx >= 0 ? prev.map((m, i) => (i === idx ? { ...m, ...item } : m)) : [...prev, item];
      });
      setEditing(null);
    } catch (e) { setEditError(messageOf(e)); }
    finally { setSaving(false); }
  };

  if (loading && !data) {
    return (
      <PageShell>
        <p className="rounded-[14px] border bg-white p-5 text-sm" style={{ borderColor: C.border, color: C.textSecondary }}>Loading purchasing…</p>
      </PageShell>
    );
  }

  return (
    <PageShell width="max-w-[1280px]">
      <PurchasingHeader counts={counts} />
      <div className="flex justify-end max-[699px]:hidden">
        <button type="button" disabled={loading} onClick={load} className="text-[11.5px] font-medium underline disabled:opacity-60" style={{ color: C.textSecondary, minHeight: 0 }}>{loading ? 'Reloading…' : 'Reload'}</button>
      </div>

      <div className="flex items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4" style={{ color: C.textFaint }} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search job, quote, PO, supplier" aria-label="Search purchasing" className="min-h-11 w-full rounded-[9px] bg-white pl-[38px] pr-3 text-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]" style={{ border: `1px solid ${C.border}`, color: C.text }} />
        </label>
        <button type="button" onClick={() => setAddQuoteSignal((n) => n + 1)} className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] px-4 text-[13.5px] font-semibold" style={{ backgroundColor: '#0B3F3B', color: '#FFFFFF' }}><Plus size={15} />Add quote</button>
      </div>

      {error && <p role="alert" className="rounded-[12px] p-3.5 text-[13px]" style={{ backgroundColor: 'var(--gf-error-bg)', color: 'var(--gf-error)', border: '1px solid var(--gf-error-border)' }}>{error}</p>}
      {moneyError && <p role="alert" className="rounded-[12px] p-3.5 text-[13px]" style={{ backgroundColor: '#FFF3DF', color: '#89511A', border: '1px solid #F0DBA8' }}>{moneyError}</p>}

      {filtered.length === 0 ? (
        <p className="rounded-[14px] border bg-white p-6 text-center text-[13px]" style={{ borderColor: C.border, color: C.textSecondary }}>{query ? 'No jobs match your search.' : 'No purchasing activity yet. Add a quote to begin.'}</p>
      ) : (
        <div className="grid gap-2.5">{filtered.map((card) => (
          <PurchasingCard key={card.job.id} card={card} data={data} onSaved={load} onEdit={() => setEditing({ jobId: card.job.id, jobName: card.job.canonical_name, rough: card.rough.value, sale: card.sale.value })} />
        ))}</div>
      )}

      <UnlinkedReview unlinkedQuotes={unlinked.unlinkedQuotes} shopPOs={unlinked.shopPOs} onUploaded={load} focusSignal={addQuoteSignal} onReload={load} loading={loading} />

      {editing && (
        <MoneyEditDialog
          jobName={editing.jobName}
          initialRough={editing.rough}
          initialSale={editing.sale}
          busy={saving}
          error={editError}
          onSave={saveMoney}
          onCancel={() => { setEditing(null); setEditError(''); }}
        />
      )}
    </PageShell>
  );
}