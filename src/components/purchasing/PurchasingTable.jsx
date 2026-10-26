import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ArrowUpRight } from 'lucide-react';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import { useRequestPayment } from './RequestPayment';
import PurchasingRowTitle from './PurchasingRowTitle';
import EtaCell from './EtaCell';
import { money } from '@/components/budgets/ProcurementForms';
import { etaDate, etaEarliest } from '@/lib/purchasingSummary';
import { procurementPath } from '@/lib/procurementRoutes';
import { PAYMENT_STAGES, PAYMENT_TONES, paymentPatch, paymentStage } from '@/lib/jobPayment';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';

// Purchasing grid (redesign, Oct 24): Builder / Job · Supplier · ETA · Job stage ·
// Windows + tax · Sale · Est. profit. One clean line per job - the builder sits above the
// job name, the supplier column names only the supplier, ETA is just the date. PO, order
// and quote numbers live in the open row, not on the grid. Clicking a job opens its
// purchase orders, budget and quote upload under the row. A multi-scope job shows the sum
// of its scopes; the open row lists each scope. Supplier and Windows drop out below
// 1280px. Below 1024px each job is one row that links to the job's Budget & Orders page.
const INK = '#101617', INK2 = '#566063', INK3 = '#34403F', RULE = '#EEE9E0', EDGE = '#E2DCD1';
const GRID = 'lg:grid lg:[grid-template-columns:var(--pc-l)] xl:[grid-template-columns:var(--pc-x)]';
const XL = 'hidden xl:block';
const VARS = {
  '--pc-l': '40px minmax(200px,1fr) 104px 200px 120px 116px',
  '--pc-x': '40px minmax(220px,1.6fr) minmax(120px,1fr) 104px 200px 124px 120px 116px',
};
const COLUMNS = [
  { label: '', key: 'chev' },
  { label: 'Builder / Job', sort: 'job' },
  { label: 'Supplier', cls: XL },
  { label: 'ETA', sort: 'eta' },
  { label: 'Job stage', sort: 'payment' },
  { label: 'Cost', sort: 'windows', right: true, cls: XL, title: 'Job cost: windows plus labor & material (or the typed Budget cost), shown as money out. Sale less Cost is Est. profit' },
  { label: 'Sale', sort: 'sale', right: true },
  { label: 'Est. profit', sort: 'profit', right: true, title: 'Sale less Cost' },
];
const cell = { padding: '0 10px', minWidth: 0 };
const dash = <span style={{ color: INK2 }}>—</span>;
const moneyCell = (v, bold, negative) => (v == null ? dash : <span style={{ fontWeight: bold ? 700 : 500, color: negative ? '#A43432' : bold ? INK : INK3 }}>{money(v)}</span>);
// Figures as the grid shows them. A sold job reads its row of the canonical job ledger
// (card.ledger, jobLedger.js): all-in cost, sale and profit, the same figures the Company overview
// shows. A quote not sold yet has no ledger row: its own figures, or the sum of its scopes (a dash
// when none of them has a figure yet - never a made-up $0).
function jobMoney(card, scopes) {
  if (card.ledger) return { cost: card.ledger.cost, sale: card.ledger.sale.value, profit: card.ledger.profit };
  const pick = (own, k) => {
    if (!own?.suppressed && own?.value != null) return own.value;
    if (!scopes.length) return null;
    const vals = scopes.map((s) => s[k]?.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  };
  const windows = pick(card.windows?.display, 'windows');
  const rough = pick(card.rough?.display, 'rough');
  // Cost is the whole job cost: windows plus labor & material.
  return { windows, cost: windows == null ? null : Math.round((windows + (rough ?? 0)) * 100) / 100, sale: pick(card.sale?.display, 'sale'), profit: pick(card.profitDisplay, 'profit') };
}

// Names typed in ALL CAPS or all lower case read as noise on the grid; show them in title
// case (display only - the job record keeps what was typed). Short all-caps words (AMSCO
// is 5, but ABC, LLC, AV24) stay as they are unless they are plain words like RES.
const SHORT_WORDS = new Set(['RES', 'LOT', 'THE', 'AND', 'OF']);
export function tidyName(value) {
  const s = String(value || '').trim();
  const caps = !/[a-z]/.test(s) && /[A-Z]{2}/.test(s);
  const lower = !/[A-Z]/.test(s) && /[a-z]/.test(s);
  if (!caps && !lower) return s;
  return s.replace(/[A-Za-z][A-Za-z']*/g, (w) => {
    if (/\d/.test(w)) return w;
    if (caps && w.length <= 3 && !SHORT_WORDS.has(w)) return w;
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  });
}

// Every supplier on the job, once each (a multi-scope job can have two).
export function supplierText(card) {
  const names = [];
  const add = (n) => { const t = String(n || '').trim(); if (t && !names.some((x) => x.toLowerCase() === t.toLowerCase())) names.push(t); };
  (card.scopes || []).forEach((s) => add(s.quoteCard?.brand));
  add(card.brand || card.supplier);
  return names.join(', ');
}

// Job stage, in the cell: a tinted pill in the stage's colour; picking one saves to the
// job (the same Jobs.payment_status field the job page reads).
function StageSelect({ stageKey, busy, onChange, label }) {
  const tone = PAYMENT_TONES[stageKey] || PAYMENT_TONES.none;
  const stage = paymentStage(stageKey);
  return (
    <Select disabled={busy} value={stage ? stageKey : ''} onValueChange={onChange}>
      <SelectTrigger aria-label={`Job stage for ${label}`} className="h-8 w-full gap-1.5 rounded-[7px] px-2.5 text-left text-[12.5px] font-semibold shadow-none focus:ring-2 focus:ring-[#10524C] focus:ring-offset-1 [&>svg]:opacity-70"
        style={{ backgroundColor: tone.bg, color: tone.text, border: `1px ${stage ? 'solid' : 'dashed'} ${stage ? tone.border : '#CEC6B8'}` }}>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
          <span className="truncate">{stage?.label || 'Set stage'}</span>
        </span>
      </SelectTrigger>
      <SelectContent className="min-w-[13rem]">
        {PAYMENT_STAGES.map((st) => (
          <SelectItem key={st.key} value={st.key} className="text-[13.5px]">
            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: st.key === 'paid' ? '#0B3F3B' : (PAYMENT_TONES[st.key] || PAYMENT_TONES.none).dot }} />{st.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useJobRow(card, data, onSaved) {
  const { job } = card;
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stageError, setStageError] = useState('');
  const fullJob = data?.jobs?.find((j) => j.id === job.id) || job;
  async function saveStage(key) {
    if (busy || !key || key === fullJob?.payment_status) return;
    setBusy(true); setStageError('');
    try {
      await base44.entities.Jobs.update(job.id, paymentPatch(fullJob, key));
      await onSaved?.();
    } catch (e) { setStageError(messageOf(e)); } finally { setBusy(false); }
  }
  return {
    fullJob, expanded, busy, stageError, saveStage,
    stageKey: fullJob?.payment_status || '',
    toggle: () => setExpanded((e) => !e),
    open: () => setExpanded(true),
    scopes: (card.scopes || []).length > 1 ? card.scopes : [],
  };
}

function JobTitle({ job, extra }) {
  const builder = String(job.builder || '').trim();
  return (
    <span className="flex min-w-0 flex-col gap-0.5 text-left">
      {builder ? <span className="truncate text-[12px] font-medium" style={{ color: INK2 }}>{tidyName(builder)}</span> : null}
      <span className="job-name truncate text-[14.5px] font-semibold" style={{ color: INK }} title={job.canonical_name}>{tidyName(job.canonical_name) || 'Unnamed job'}{extra ? <span className="font-normal" style={{ color: INK2 }}> · {extra}</span> : null}</span>
    </span>
  );
}

function JobRows({ card, data, onSaved }) {
  const { job, refs } = card;
  const row = useJobRow(card, data, onSaved);
  const multi = row.scopes.length > 1;
  const f = jobMoney(card, row.scopes);
  const supplier = supplierText(card);
  const label = [job.builder, job.canonical_name].filter(Boolean).join(' - ');
  const panelId = `purchasing-row-${job.id}`;
  const pay = useRequestPayment({ job: row.fullJob || { ...job, payment_status: row.stageKey }, sale: f.sale, budgets: data?.budgets || [], enabled: row.expanded });
  return (
    <>
      <div role="row" className={`group items-center ${GRID} ${row.expanded ? 'bg-[#EEF5F3]' : 'bg-white hover:bg-[#F6F3EC]'}`}
        style={{ minHeight: '60px', borderTop: `1px solid ${RULE}`, transition: 'background-color .12s' }}>
        <span style={{ ...cell, padding: '0 0 0 12px' }}>
          <button type="button" onClick={row.toggle} aria-expanded={row.expanded} aria-controls={panelId} aria-label={`${row.expanded ? 'Close' : 'Open'} ${label}`}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] hover:bg-[#E2DCD1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#10524C]" style={{ color: INK2 }}>
            <ChevronRight className="h-4 w-4" style={{ transform: row.expanded ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }} />
          </button>
        </span>
        <span style={cell}>
          <button type="button" onClick={row.toggle} aria-expanded={row.expanded} aria-controls={panelId}
            className="flex w-full min-w-0 py-2 [&:hover_.job-name]:underline [&:hover_.job-name]:underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#10524C] focus-visible:rounded-[4px]"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <JobTitle job={job} extra={multi ? `${row.scopes.length} scopes` : ''} />
          </button>
        </span>
        <span className={`${XL} truncate text-[13.5px] font-medium`} style={{ ...cell, color: supplier ? INK : INK2 }} title={supplier}>{supplier || '—'}</span>
        <span style={cell}>
          {multi
            ? <span className="whitespace-nowrap text-[14px] font-medium" style={{ color: INK }}>{etaEarliest(row.scopes.map((s) => s.etaLabel)) || '—'}</span>
            : <EtaCell compact job={job} data={data} etaLabel={refs.etaLabel} onSaved={onSaved} onOpenSupplier={row.open} />}
        </span>
        <span style={{ ...cell, padding: '0 8px' }}>
          <StageSelect stageKey={row.stageKey} busy={row.busy} onChange={row.saveStage} label={label} />
          {row.stageError && <span role="alert" className="mt-1 block text-[12px] font-semibold" style={{ color: '#A43432' }}>{row.stageError}</span>}
        </span>
        <span className={`${XL} text-right text-[14px] tabular-nums`} style={cell}>{moneyCell(f.cost == null ? null : 0 - f.cost)}</span>
        <span className="text-right text-[14px] tabular-nums" style={cell}>{moneyCell(f.sale, true)}</span>
        <span className="text-right text-[14px] tabular-nums" style={{ ...cell, paddingRight: '20px' }}>{moneyCell(f.profit, false, f.profit < 0)}</span>
      </div>
      {row.expanded && row.fullJob && data && (
        <div id={panelId} style={{ backgroundColor: '#EEF5F3', padding: '2px 20px 20px 52px' }}>
          <div className="overflow-hidden rounded-[12px] bg-white" style={{ border: `1px solid ${EDGE}`, boxShadow: '0 1px 2px rgba(21,24,26,.05), 0 3px 8px -3px rgba(21,24,26,.10)' }}>
            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5" style={{ backgroundColor: '#FAF8F3', borderBottom: `1px solid ${RULE}` }}>
              <span className="mr-auto">{pay.trigger({ border: '1px solid #9A9080', background: '#FFFFFF', color: INK })}</span>
              <PurchasingRowTitle job={job} onSaved={onSaved} compact />
              <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold no-underline hover:brightness-95"
                style={{ backgroundColor: '#E2EEEB', color: '#082F2C', border: '1px solid #C7E4D2' }}>Open in Jobs<ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </div>
            {pay.panel}
            <PurchasingJobWorkspace job={row.fullJob} data={data} onSaved={onSaved} />
          </div>
        </div>
      )}
    </>
  );
}

// Phone and tablet: one row per job, the whole row a link to the job's Budget & Orders.
const BADGE = 'inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 text-[13px] font-semibold';
function PhoneRow({ card }) {
  const { job, refs } = card;
  const scopes = (card.scopes || []).length > 1 ? card.scopes : [];
  const f = jobMoney(card, scopes);
  const eta = scopes.length ? etaEarliest(scopes.map((s) => s.etaLabel)) : etaDate(refs.etaLabel);
  const stage = paymentStage(card.paymentStage);
  const tone = PAYMENT_TONES[card.paymentStage] || PAYMENT_TONES.none;
  const supplier = supplierText(card);
  const builder = String(job.builder || '').trim();
  return (
    <Link to={procurementPath(job.id, 'budgets')} className="flex flex-col gap-1.5 no-underline active:bg-[#F6F3EC]" style={{ padding: '12px 16px', borderTop: `1px solid ${RULE}`, color: INK }}>
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          {builder ? <span className="truncate text-[12.5px] font-medium" style={{ color: INK2 }}>{tidyName(builder)}</span> : null}
          <span className="min-w-0 text-[16px] font-semibold leading-snug" style={{ overflowWrap: 'anywhere' }}>{tidyName(job.canonical_name) || 'Unnamed job'}</span>
        </span>
        <span className="whitespace-nowrap pt-0.5 text-[15px] font-bold tabular-nums">{f.sale == null ? '—' : money(f.sale)}</span>
      </span>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[13.5px]" style={{ color: INK3 }}>{supplier || 'Supplier not set'}{scopes.length ? ` · ${scopes.length} scopes` : ''}</span>
        <span className="whitespace-nowrap text-[14px] tabular-nums" style={{ color: f.profit < 0 ? '#A43432' : INK2 }}>{f.profit == null ? '' : `Profit ${money(f.profit)}`}</span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        <span className={BADGE} style={{ backgroundColor: '#F3EFE7', color: INK3 }}>{eta ? `ETA ${eta}` : 'No ETA'}</span>
        <span className={BADGE} style={{ backgroundColor: tone.bg, color: tone.text, border: `1px solid ${stage ? tone.border : '#E2DCD1'}` }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone.dot }} />{stage?.label || 'No stage'}
        </span>
      </span>
    </Link>
  );
}

export default function PurchasingTable({ cards, data, onSaved, sort, onSort }) {
  return (
    <>
      <div role="table" aria-label="Purchasing jobs" className="hidden rounded-[12px] bg-white lg:block"
        style={{ ...VARS, border: `1px solid ${EDGE}`, overflow: 'clip', boxShadow: '0 1px 2px rgba(21,24,26,.04), 0 16px 40px -28px rgba(21,24,26,.25)' }}>
        <div role="row" className={`items-center ${GRID}`} style={{ position: 'sticky', top: 0, zIndex: 5, minHeight: '42px', backgroundColor: '#FAF8F3', borderBottom: `1px solid ${EDGE}` }}>
          {COLUMNS.map((c) => {
            const active = c.sort && sort?.key === c.sort;
            const text = <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: active ? INK : INK2 }}>{c.label}</span>;
            return (
              <span key={c.key || c.label} role="columnheader" title={c.title} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className={`${c.cls || ''} ${c.right ? 'text-right' : ''}`} style={{ ...cell, whiteSpace: 'nowrap', paddingRight: c.label === 'Est. profit' ? '20px' : '10px' }}>
                {c.sort ? (
                  <button type="button" onClick={() => onSort(c.sort)} className={`inline-flex items-center gap-1 ${c.right ? 'flex-row-reverse' : ''}`} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    {text}<span aria-hidden="true" style={{ fontSize: '9px', color: INK3, visibility: active ? 'visible' : 'hidden' }}>{sort?.dir === 'asc' ? '▲' : '▼'}</span>
                  </button>
                ) : text}
              </span>
            );
          })}
        </div>
        {cards.map((card) => <Fragment key={card.job.id}><JobRows card={card} data={data} onSaved={onSaved} /></Fragment>)}
      </div>
      <div className="overflow-hidden rounded-[12px] bg-white lg:hidden" style={{ border: `1px solid ${EDGE}`, marginTop: '-1px' }}>
        {cards.map((card) => <PhoneRow key={card.job.id} card={card} />)}
      </div>
    </>
  );
}
