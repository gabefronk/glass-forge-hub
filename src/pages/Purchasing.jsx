import { headerFigures, applyPurchasingFilter, purchasingFilterCounts, supplierPayables, sortCards, cardFigures, etaDate, etaEarliest, PURCHASING_FILTERS, DEFAULT_PURCHASING_SORT } from '@/lib/purchasingSummary';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { paymentStage } from '@/lib/jobPayment';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isPurchasingMoneyOwner } from '@/lib/purchasingMoneyAccess';
import { purchasingRequest, messageOf } from '@/components/budgets/ProcurementForms';
import { buildPurchasingCards, cardMatchesSearch, unlinkedEntities } from '@/lib/purchasingViewModel';
import { scopesForJob, applyScopeRollup } from '@/lib/purchasingScopes';
import { PageShell } from '@/components/PageShell';
import PurchasingHeader from '@/components/purchasing/PurchasingHeader';
import PageNotFound from '@/lib/PageNotFound';
import PurchasingTable, { supplierText } from '@/components/purchasing/PurchasingTable';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState(DEFAULT_PURCHASING_SORT);
  const [addQuoteSignal, setAddQuoteSignal] = useState(0);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const v = ++loadSeq.current;
    setLoading(true); setError('');
    try {
      const overview = await purchasingRequest({ action: 'overview' });
      if (v !== loadSeq.current) return;
      setData(overview);
    } catch (e) {
      if (v === loadSeq.current) setError(messageOf(e));
    } finally {
      if (v === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); return () => { loadSeq.current++; }; }, [load]);

  const today = denverDate();
  const cards = useMemo(() => {
    if (!data) return [];
    const built = buildPurchasingCards({
      jobs: data.jobs, budgets: data.budgets, purchase_orders: data.purchase_orders,
      vendor_orders: data.vendor_orders, conflicts: data.conflicts, today,
    });
    // Each job also carries its scopes: the board adds one row per scope when a
    // job holds more than one (a second budget, a reorder PO, an order with no
    // PO). Multi-scope job rows then withhold scope-derived money via
    // applyScopeRollup so the roll-up can never read as a job total.
    // The header figures and the filter also read what we owe suppliers (raw PO
    // amounts) and the customer payment stage, so each card carries both.
    const jobsById = new Map((data.jobs || []).map((j) => [j.id, j]));
    return built.map((card) => applyScopeRollup({
      ...card,
      scopes: scopesForJob(card.job.id, data),
      payables: supplierPayables(card.job.id, data),
      paymentStage: jobsById.get(card.job.id)?.payment_status || '',
    }));
  }, [data, today]);
  const searched = useMemo(() => cards.filter((c) => cardMatchesSearch(c, query)), [cards, query]);
  const filterCounts = useMemo(() => purchasingFilterCounts(searched, today), [searched, today]);
  const filtered = useMemo(() => sortCards(applyPurchasingFilter(searched, filter, today), sort), [searched, filter, today, sort]);
  // Clicking the active column header flips it; a new one starts soonest / A-Z / largest.
  const changeSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: ['windows', 'sale', 'profit'].includes(key) ? 'desc' : 'asc' }));
  const exportCsv = () => {
    const cols = ['Builder', 'Job', 'Supplier', 'ETA', 'Job stage', 'Windows + tax', 'Sale', 'Est. profit'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = filtered.map((c) => {
      const f = cardFigures(c);
      const eta = (c.scopes || []).length > 1 ? etaEarliest(c.scopes.map((s) => s.etaLabel)) : etaDate(c.refs?.etaLabel);
      return [c.job.builder || '', c.job.canonical_name || '', supplierText(c), eta, paymentStage(c.paymentStage)?.label || '', f.windows, f.sale, f.profit].map(esc).join(',');
    });
    const blob = new Blob([[cols.join(','), ...body].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `purchasing-${today}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const shownFilters = PURCHASING_FILTERS.filter((f) => f.key === 'all' || f.key === filter || filterCounts[f.key] > 0);
  const currentFilter = PURCHASING_FILTERS.find((f) => f.key === filter) || PURCHASING_FILTERS[0];
  const figures = useMemo(() => headerFigures(filtered, today), [filtered, today]);
  const unlinked = useMemo(() => (data ? unlinkedEntities({ budgets: data.budgets, purchase_orders: data.purchase_orders }) : { unlinkedQuotes: [], shopPOs: [] }), [data]);

  if (loading && !data) {
    return (
      <PageShell>
        <p className="rounded-[14px] border bg-white p-5 text-sm" style={{ borderColor: C.border, color: C.textSecondary }}>Loading purchasing…</p>
      </PageShell>
    );
  }

  return (
    <PageShell width="max-w-[1440px]">
      <PurchasingHeader figures={figures} onExport={exportCsv} onReload={load} reloading={loading} />

      <div className="flex items-center gap-2 max-[1023px]:flex-wrap">
        <label className="relative flex min-w-0 items-center max-[1023px]:w-full" style={{ flex: '1 1 260px', maxWidth: 440 }}>
          <Search className="pointer-events-none absolute left-3 h-4 w-4" style={{ color: '#6B7276' }} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search jobs, builders, POs, quotes" aria-label="Search jobs, builders, POs and quotes" className="h-9 w-full rounded-[8px] pl-[36px] pr-3 text-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)] max-[1023px]:h-11" style={{ border: '1px solid #9A9080', color: '#101617', backgroundColor: '#F4F1EA' }} />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label={`Show: ${currentFilter.label}`} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-white pl-3 pr-2.5 text-[14px] max-[1023px]:h-11" style={{ border: '1px solid #9A9080', color: '#101617', cursor: 'pointer' }}>
              <span style={{ color: '#566063', fontWeight: 500 }}>Show</span>
              <span style={{ fontWeight: 600 }}>{currentFilter.label}</span>
              <span className="tabular-nums" style={{ color: '#566063', fontWeight: 500 }}>{filterCounts[currentFilter.key] || 0}</span>
              <ChevronDown style={{ width: 16, height: 16, color: '#566063' }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[230px] p-1">
            {shownFilters.map((f) => (
              <DropdownMenuItem key={f.key} onSelect={() => setFilter(f.key)} className="flex min-h-9 cursor-pointer items-center gap-2 text-[14px]">
                <Check style={{ width: 15, height: 15, color: '#0B3F3B', visibility: f.key === filter ? 'visible' : 'hidden' }} />
                <span className="flex-1" style={{ fontWeight: f.key === filter ? 600 : 400 }}>{f.label}</span>
                <span className="tabular-nums" style={{ color: '#566063' }}>{filterCounts[f.key] || 0}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && <p role="alert" className="rounded-[12px] p-3.5 text-[13px]" style={{ backgroundColor: 'var(--gf-error-bg)', color: 'var(--gf-error)', border: '1px solid var(--gf-error-border)' }}>{error}</p>}

      {filtered.length === 0 ? (
        <p className="rounded-[14px] border bg-white p-6 text-center text-[13px]" style={{ borderColor: C.border, color: C.textSecondary }}>{query || filter !== 'all' ? 'No jobs match your search or filter.' : 'No purchasing activity yet. Add a quote to begin.'}</p>
      ) : (
        <PurchasingTable cards={filtered} data={data} sort={sort} onSort={changeSort} today={today} onSaved={load} />
      )}

      <UnlinkedReview unlinkedQuotes={unlinked.unlinkedQuotes} shopPOs={unlinked.shopPOs} onUploaded={load} focusSignal={addQuoteSignal} onReload={load} loading={loading} />

    </PageShell>
  );
}