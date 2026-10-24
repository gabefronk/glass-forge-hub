import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import PurchasingJobWorkspace from './PurchasingJobWorkspace';
import PurchasingRowTitle, { rowTitle } from './PurchasingRowTitle';
import EtaCell from './EtaCell';
import QuoteCell from './QuoteCell';
import { money } from '@/components/budgets/ProcurementForms';
import { cardFigures, etaRange, etaShort } from '@/lib/purchasingSummary';
import { procurementPath } from '@/lib/procurementRoutes';
import { PAYMENT_STAGES, PAYMENT_TONES, paymentPatch, paymentStage } from '@/lib/jobPayment';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';

// Purchasing as one flat grid (declutter, Oct 24): Job · Order · PO · ETA · Payment ·
// Windows + tax · Sale · Est. profit, one sticky header, 40px ruled rows, money
// right-aligned with no captions (the basis is in the header's hover title). Clicking a
// job opens its details and Money workspace under the row. A multi-scope job shows
// "N scopes" and a dash in each money cell, with one 36px row per scope under it. Columns
// drop out as the screen narrows: Order below 1536px, PO and Windows below 1280px. Below
// 1024px each job is one ~110px row that links to the job's Budget & Orders page.
const INK = '#101617', INK2 = '#566063', INK3 = '#34403F', RULE = '#D6CCBA';
const GRID = 'lg:grid lg:[grid-template-columns:var(--pc-l)] xl:[grid-template-columns:var(--pc-x)] 2xl:[grid-template-columns:var(--pc-2)]';
const XL = 'hidden xl:block', XXL = 'hidden 2xl:block';
const VARS = {
  '--pc-l': 'minmax(200px,1fr) 132px 176px 124px 116px',
  '--pc-x': 'minmax(200px,1fr) 92px 132px 176px 132px 124px 116px',
  '--pc-2': '260px minmax(128px,1fr) 92px 132px 176px 132px 124px 116px',
};
const COLUMNS = [
  { label: 'Job', sort: 'job' },
  { label: 'Order', cls: XXL },
  { label: 'PO', cls: XL },
  { label: 'ETA', sort: 'eta' },
  { label: 'Payment', sort: 'payment' },
  { label: 'Windows + tax', sort: 'windows', right: true, cls: XL, title: 'Window and door material including the 7.45% use tax' },
  { label: 'Sale', sort: 'sale', right: true },
  { label: 'Est. profit', sort: 'profit', right: true, title: 'Sale less windows + tax less labor & material' },
];
const cell = { padding: '0 10px', minWidth: 0 };
const mono = { fontFamily: 'var(--font-mono)', fontSize: '13px', color: INK3 };

const orderRef = (card) => [card.brand, card.refs?.mfrOrder || card.refs?.quoteNumber].filter(Boolean).join(' ');
const dash = <span style={{ color: INK2 }}>—</span>;
const moneyCell = (v, bold, negative) => (v == null ? dash : <span style={{ fontWeight: bold ? 700 : 400, color: negative ? '#A43432' : INK }}>{money(v)}</span>);

// Customer payment stage, in the cell: borderless until hover, a dot and the full stage
// name. Same Jobs.payment_status patch as before; Gabe's stage order.
function PaymentSelect({ payKey, busy, onChange }) {
  const tone = PAYMENT_TONES[payKey] || PAYMENT_TONES.none;
  const label = paymentStage(payKey)?.label || 'Not tracked';
  return (
    <Select disabled={busy} value={payKey} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
      <SelectTrigger aria-label="Customer payment status" className="h-9 w-full gap-1 rounded-[8px] border border-transparent bg-transparent px-2 text-left text-[14px] shadow-none hover:border-[#9A9080] focus:ring-0">
        <span className="flex min-w-0 flex-1 items-center gap-2" style={{ color: payKey === 'none' ? INK2 : INK }}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
          <span className="whitespace-nowrap">{label}</span>
        </span>
      </SelectTrigger>
      <SelectContent className="min-w-[15rem]">
        <SelectItem value="none" className="text-[14px]">Not tracked</SelectItem>
        {PAYMENT_STAGES.map((st) => (
          <SelectItem key={st.key} value={st.key} className="text-[14px]">
            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: (PAYMENT_TONES[st.key] || PAYMENT_TONES.none).dot }} />{st.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useJobRow(card, data, onSaved) {
  const { job } = card;
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState('budgets');
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const fullJob = data?.jobs?.find((j) => j.id === job.id) || job;
  async function savePayment(key) {
    if (busy) return;
    setBusy(true); setPayError('');
    try {
      const patch = key ? paymentPatch(fullJob, key) : { payment_status: null, payment_status_at: null };
      await base44.entities.Jobs.update(job.id, patch);
      await onSaved?.();
    } catch (e) { setPayError(messageOf(e)); } finally { setBusy(false); }
  }
  return {
    fullJob, expanded, section, setSection, busy, payError, savePayment,
    payKey: fullJob?.payment_status || 'none',
    toggle: () => setExpanded((e) => { if (!e) setSection('budgets'); return !e; }),
    openSupplierSection: () => { setExpanded(true); setSection('tracking'); },
    scopes: (card.scopes || []).length > 1 ? card.scopes : [],
  };
}

function ScopeRows({ scopes, job, onSaved, onOpenTracking }) {
  return scopes.map((s) => {
    const sup = s.payment?.label && s.payment.label !== '—' ? `Supplier · ${s.payment.label}` : '';
    return (
      <div key={s.key} role="row" className={`items-center ${GRID}`} style={{ minHeight: '36px', backgroundColor: '#FAF8F3', borderBottom: `1px solid ${RULE}`, color: INK3 }}>
        <span className="truncate text-[14px]" style={{ ...cell, paddingLeft: '40px' }} title={s.label}>{s.label || 'Scope'}</span>
        <span className={`${XXL} truncate`} style={{ ...cell, ...mono }}>{[s.quoteCard?.brand, s.quoteCard?.refs?.quoteNumber].filter(Boolean).join(' ')}</span>
        <span className={`${XL} truncate`} style={{ ...cell, ...mono }}>{s.poNumber || ''}</span>
        <span style={cell}><EtaCell compact job={job} etaTarget={s.etaTarget} etaLabel={s.etaLabel} onSaved={onSaved} onOpenSupplier={onOpenTracking} /></span>
        <span className="truncate text-[14px]" style={cell}>{sup}</span>
        <span className={`${XL} text-right text-[14px] tabular-nums`} style={cell}>{moneyCell(s.windows?.value)}</span>
        <span className="text-right text-[14px] tabular-nums" style={cell}>{moneyCell(s.sale?.value, true)}</span>
        <span className="text-right text-[14px] tabular-nums" style={cell}>{moneyCell(s.profit?.value, false, s.profit?.value < 0)}</span>
      </div>
    );
  });
}

function JobRows({ card, data, onEdit, onSaved, today }) {
  const { job, refs } = card;
  const row = useJobRow(card, data, onSaved);
  const [hover, setHover] = useState(false);
  const multi = row.scopes.length > 1;
  const f = cardFigures(card);
  const scopesText = `${row.scopes.length} scopes`;
  const eta = multi ? etaRange(row.scopes.map((s) => s.etaLabel), today) : null;
  return (
    <>
      <div role="row" className={`items-center ${GRID}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ minHeight: '40px', borderBottom: `1px solid ${RULE}`, backgroundColor: row.expanded ? '#FAF8F3' : hover ? '#F6F3EC' : '#FFFFFF' }}>
        <span style={cell}>
          <button type="button" onClick={row.toggle} aria-expanded={row.expanded} aria-controls={`purchasing-row-${job.id}`}
            className="text-left text-[14px] font-semibold" style={{ color: INK, background: 'none', border: 'none', padding: '8px 0', cursor: 'pointer', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
            {rowTitle(job)}{multi && <span className="2xl:hidden" style={{ color: INK2, fontWeight: 400 }}> · {scopesText}</span>}
          </button>
        </span>
        <span className={`${XXL} truncate`} style={{ ...cell, ...mono }}>{multi ? scopesText : orderRef(card)}</span>
        <span className={`${XL} truncate`} style={{ ...cell, ...mono }}>{refs.yaPo || ''}</span>
        <span style={cell}>
          {multi
            ? <span className="whitespace-nowrap text-[14px]" style={{ color: eta.late ? '#A43432' : INK, fontWeight: eta.late ? 600 : 400 }}>{eta.text || '—'}</span>
            : <EtaCell compact job={job} data={data} etaLabel={refs.etaLabel} onSaved={onSaved} onOpenSupplier={row.openSupplierSection} />}
        </span>
        <span style={{ ...cell, padding: '0 4px' }}>
          <PaymentSelect payKey={row.payKey} busy={row.busy} onChange={(v) => row.savePayment(v)} />
          {row.payError && <span className="block text-[13px] font-semibold" style={{ color: '#A43432' }}>{row.payError}</span>}
        </span>
        <span className={`${XL} text-right text-[14px] tabular-nums`} style={cell}>{multi ? dash : moneyCell(card.windows?.display?.value)}</span>
        <span className="text-right text-[14px] tabular-nums" style={cell}>{multi ? dash : moneyCell(card.sale?.display?.value, true)}</span>
        <span className="text-right text-[14px] tabular-nums" style={cell}>{multi ? dash : moneyCell(card.profitDisplay?.value, false, f.profit < 0)}</span>
      </div>
      {multi && <ScopeRows scopes={row.scopes} job={job} onSaved={onSaved} onOpenTracking={row.openSupplierSection} />}
      {row.expanded && row.fullJob && data && (
        <div id={`purchasing-row-${job.id}`} style={{ backgroundColor: '#FAF8F3', borderBottom: `1px solid ${RULE}`, padding: '10px 16px 16px' }}>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px]">
            <PurchasingRowTitle job={job} onSaved={onSaved} />
            <span className="inline-flex items-center gap-2"><span style={{ color: INK2 }}>Quote</span><QuoteCell card={card} onSaved={onSaved} /></span>
            <span className="flex-1" />
            <button type="button" onClick={onEdit} className="text-[14px] font-semibold" style={{ height: '36px', borderRadius: '9px', border: 'none', backgroundColor: '#0B3F3B', color: '#FFFFFF', padding: '0 14px', cursor: 'pointer' }}>Edit money</button>
          </div>
          <PurchasingJobWorkspace job={row.fullJob} data={data} section={row.section} onSection={row.setSection} onSaved={onSaved} />
        </div>
      )}
    </>
  );
}

// Phone and tablet: one row per job, the whole row a link to the job's Budget & Orders.
const BADGE = 'inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] px-2 text-[13px] font-semibold';
function PhoneRow({ card, today }) {
  const { job, refs } = card;
  const scopes = (card.scopes || []).length > 1 ? card.scopes : [];
  const f = cardFigures(card);
  const eta = scopes.length ? etaRange(scopes.map((s) => s.etaLabel), today) : etaShort(refs.etaLabel, today);
  const stage = card.paymentStage || '';
  const paid = stage === 'paid';
  const line2 = scopes.length ? `${scopes.length} ${card.brand ? `${card.brand} ` : ''}scopes` : [orderRef(card), refs.yaPo].filter(Boolean).join(' · ');
  return (
    <Link to={procurementPath(job.id, 'budgets')} className="flex flex-col gap-1.5" style={{ padding: '12px 16px', borderBottom: `1px solid ${RULE}`, color: INK, textDecoration: 'none' }}>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-[16px] font-semibold leading-snug" style={{ overflowWrap: 'anywhere' }}>{rowTitle(job)}</span>
        <span className="whitespace-nowrap text-[15px] font-bold tabular-nums">{money(f.sale)}</span>
      </span>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate" style={mono}>{line2 || '—'}</span>
        <span className="whitespace-nowrap text-[14px] tabular-nums" style={{ color: f.profit < 0 ? '#A43432' : INK2 }}>{money(f.profit)}</span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        <span className={BADGE} style={eta.late ? { backgroundColor: '#FCEDEC', color: '#A43432' } : { backgroundColor: '#F3EFE7', color: INK3 }}>{eta.text ? `ETA ${eta.text}` : 'No ETA'}</span>
        <span className={BADGE} style={paid ? { backgroundColor: '#E2EEEB', color: '#082F2C' } : stage ? { backgroundColor: '#FAF0DA', color: '#6F4E10' } : { backgroundColor: '#F3EFE7', color: INK3 }}>{paymentStage(stage)?.label || 'Not tracked'}</span>
      </span>
    </Link>
  );
}

export default function PurchasingTable({ cards, data, onEdit, onSaved, sort, onSort, today }) {
  return (
    <>
      <div role="table" aria-label="Purchasing jobs" className="hidden rounded-[12px] bg-white lg:block" style={{ ...VARS, border: '1px solid #B3A792', overflow: 'clip' }}>
        <div role="row" className={`items-center ${GRID}`} style={{ position: 'sticky', top: 0, zIndex: 5, minHeight: '36px', backgroundColor: '#E9E2D4', borderBottom: '2px solid #34403F' }}>
          {COLUMNS.map((c) => {
            const active = c.sort && sort?.key === c.sort;
            const text = <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: INK3 }}>{c.label}</span>;
            return (
              <span key={c.label} role="columnheader" title={c.title} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className={`${c.cls || ''} ${c.right ? 'text-right' : ''}`} style={{ ...cell, whiteSpace: 'nowrap' }}>
                {c.sort ? (
                  <button type="button" onClick={() => onSort(c.sort)} className={`inline-flex items-center gap-1 ${c.right ? 'flex-row-reverse' : ''}`} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    {text}<span aria-hidden="true" style={{ fontSize: '9px', color: INK3, visibility: active ? 'visible' : 'hidden' }}>{sort?.dir === 'asc' ? '▲' : '▼'}</span>
                  </button>
                ) : text}
              </span>
            );
          })}
        </div>
        {cards.map((card) => <Fragment key={card.job.id}><JobRows card={card} data={data} today={today} onEdit={() => onEdit(card)} onSaved={onSaved} /></Fragment>)}
      </div>
      <div className="overflow-hidden rounded-[12px] bg-white lg:hidden" style={{ border: '1px solid #B3A792' }}>
        {cards.map((card) => <PhoneRow key={card.job.id} card={card} today={today} />)}
      </div>
    </>
  );
}
