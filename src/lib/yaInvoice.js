// YA Windows & Doors customer invoice (Gabe, Oct 31), laid out like his Arena invoice
// YA-260916-01: header, Bill to / Project, payment schedule, numbered product lines,
// materials subtotal, labor and other charges, total, then wire / check / terms panels,
// an optional acceptance signature and attachments (W-9, certificate of insurance).
// One builder so every invoice reads the same. Pure: no React, no SDK.

const round = (n) => Math.round(n * 100) / 100;
const cents = (v) => Math.round(Number(v) * 100);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => String(v ?? '').trim();

export const INVOICE_TYPES = [
  { key: 'full', label: 'Full payment', kind: 'balance' },
  { key: 'half', label: 'Half down (50% deposit)', kind: 'deposit' },
  { key: 'final', label: 'Final balance', kind: 'balance' },
];
export const invoiceType = (key) => INVOICE_TYPES.find((t) => t.key === key) || INVOICE_TYPES[0];

// What can be added before printing. Defaults depend on the type; attachments need a file.
export const INVOICE_OPTIONS = [
  { key: 'wire', label: 'Wire / ACH bank details' },
  { key: 'ach_link', label: 'How to request an ACH payment link' },
  { key: 'check', label: 'Pay-by-check instructions' },
  { key: 'terms', label: 'Deposit and change terms' },
  { key: 'signature', label: 'Customer acceptance signature line' },
  { key: 'itemize', label: 'List each window or door from the quote' },
  { key: 'w9', label: 'Attach Form W-9' },
  { key: 'coi', label: 'Attach certificate of insurance' },
];
export function defaultOptions(type = 'full', { hasBank = false, hasQuoteLines = false, hasW9 = false, hasCoi = false } = {}) {
  return {
    wire: hasBank, ach_link: true, check: true,
    terms: type === 'half', signature: type === 'half',
    itemize: hasQuoteLines, w9: false && hasW9, coi: false && hasCoi,
  };
}

// The non-financial details on Gabe's Arena invoice. Bank routing and account numbers are
// never in code: Gabe types them into Payment details (AppSettings, admin only).
export const COMPANY_DEFAULTS = Object.freeze({
  invoice_company_name: 'Y A Windows Doors LLC',
  invoice_company_address: '1138 S 1300 W, Salt Lake City, UT 84104',
  invoice_checks_payable_to: 'Y A Windows Doors LLC',
  invoice_bank_name: 'Mountain America Credit Union',
  invoice_bank_address: '9800 S. Monroe St., Sandy, UT 84070',
  invoice_account_name: 'Y A Windows And Doors LLC',
  invoice_phone: '',
  invoice_email: '',
});
export const COMPANY_FIELDS = [...Object.keys(COMPANY_DEFAULTS), 'invoice_routing_number', 'invoice_account_number'];
export function companyDetails(settings = {}) {
  const out = {};
  for (const k of COMPANY_FIELDS) out[k] = text(settings?.[k]) || COMPANY_DEFAULTS[k] || '';
  return out;
}
export const hasBankDetails = (company = {}) => Boolean(text(company.invoice_routing_number) && text(company.invoice_account_number));

// YA-YYMMDD-NN, as on YA-260916-01: the date, then the day's next number.
export function nextInvoiceNumber(date, existing = []) {
  const [y, m, d] = String(date || '').split('-');
  if (!y || !m || !d) return '';
  const prefix = `YA-${y.slice(2)}${m}${d}-`;
  const used = existing.map((n) => String(n || '')).filter((n) => n.startsWith(prefix)).map((n) => Number(n.slice(prefix.length)) || 0);
  return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
}

// 47.5 x 119.5 → 47½ × 119½ (eighths).
const FRACTIONS = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' };
function inches(v) {
  const n = num(v);
  if (n == null || n <= 0) return '';
  const eighths = Math.round(n * 8);
  const whole = Math.floor(eighths / 8), part = eighths % 8;
  return `${whole || ''}${part ? FRACTIONS[part] : ''}` || '0';
}
export function sizeLabel(width, height) {
  const w = inches(width), h = inches(height);
  return w && h && !(Number(width) <= 1 && Number(height) <= 1) ? `${w} × ${h}` : '';
}

export function defaultBillTo(job = {}) {
  const builder = text(job.builder);
  const name = text(job.customer_name) || (builder && !/^cash/i.test(builder) ? builder : '') || text(job.canonical_name);
  return { name, attn: '', address: text(job.address) };
}

const liveQuoteBudgets = (job, budgets) => budgets.filter((b) => b.job_id === job.id && !b.deleted_at && b.budget_usage !== 'reference'
  && (num(b.inputs?.material_true_cost) != null || b.quote_number || b.quote));
const countedFirst = (rows) => [...rows].sort((a, b) => (a.budget_usage === 'draft') - (b.budget_usage === 'draft'));

export function defaultProject(job = {}, budgets = []) {
  const b = countedFirst(liveQuoteBudgets(job, budgets))[0];
  const brand = text(b?.manufacturer || b?.quote?.manufacturer || b?.vendor);
  const units = Number(b?.openings_qty || b?.quote?.openings_qty) || 0;
  const detail = b ? [brand && `${brand} windows and doors`, units ? `${units} units` : '', 'supply and install'].filter(Boolean).join(' · ') : '';
  return { title: text(job.canonical_name), detail, address: text(job.address) };
}

// Lines that add up to the customer total. A job with no vendor quote gets one Labor line
// for its typed total (split it by hand, e.g. labor + extra material). A quote job's sell is
// split by cost share: windows and doors, installation labor, install material / equipment.
// With `itemize`, the windows line becomes one line per quote item at sell prices; labor
// takes the leftover cents so the total stays exact.
export function defaultLines({ job = {}, budgets = [], sell = null, itemize = false } = {}) {
  const total = num(sell);
  const quoteBudgets = countedFirst(liveQuoteBudgets(job, budgets));
  if (!quoteBudgets.length) return [{ kind: 'charge', description: 'Labor', amount: total ?? 0 }];
  let material = 0, labor = 0, extra = 0;
  for (const b of quoteBudgets.filter((x) => x.budget_usage !== 'draft').length ? quoteBudgets.filter((x) => x.budget_usage !== 'draft') : quoteBudgets.slice(0, 1)) {
    const i = b.inputs || {};
    material += num(i.material_true_cost) || 0;
    labor += num(i.labor_cost_sub_pay) || 0;
    extra += (num(i.additional_install_material) || 0) + (num(i.additional_equipment) || 0);
  }
  const cost = material + labor + extra;
  if (total == null || !(cost > 0)) return [{ kind: 'charge', description: 'Windows and doors, supply and install', amount: total ?? 0 }];
  const share = (c) => round((total * c) / cost);
  const b = quoteBudgets[0];
  const brand = text(b.manufacturer || b.quote?.manufacturer || b.vendor);
  const quoteNo = text(b.quote_number || b.quote?.quote_number);
  const units = Number(b.openings_qty || b.quote?.openings_qty) || 0;
  const productTotal = share(material);
  let items = [];
  const quoteLines = (b.quote?.lines || []).filter((l) => num(l?.extended) > 0);
  if (itemize && quoteLines.length) {
    const sum = quoteLines.reduce((n, l) => n + Number(l.extended), 0);
    items = quoteLines.map((l) => {
      const qty = Math.max(1, Number(l.qty) || 1);
      const unit = round((Number(l.extended) * productTotal) / sum / qty);
      return { kind: 'item', description: text(l.description) || 'Window', size: sizeLabel(l.width_in, l.height_in), qty, unit, amount: round(unit * qty) };
    });
  } else if (material > 0) {
    items = [{ kind: 'item', description: [`${brand || 'Windows and doors'}${quoteNo ? `, quote ${quoteNo}` : ''}`, units ? `${units} units` : ''].filter(Boolean).join(' · '), size: '', qty: 1, unit: productTotal, amount: productTotal }];
  }
  const itemSum = round(items.reduce((n, l) => n + l.amount, 0));
  const extraAmount = extra > 0 ? share(extra) : 0;
  const charges = [];
  const laborAmount = round(total - itemSum - extraAmount);
  if (labor > 0 || laborAmount !== 0) charges.push({ kind: 'charge', description: 'Installation labor', amount: laborAmount });
  if (extraAmount) charges.push({ kind: 'charge', description: 'Install material and equipment', amount: extraAmount });
  return [...items, ...charges];
}

export function lineAmount(line = {}) {
  if (line.kind === 'item') return round((num(line.qty) ?? 0) * (num(line.unit) ?? 0));
  return round(num(line.amount) ?? 0);
}

export function invoiceTotals(lines = []) {
  const items = lines.filter((l) => l.kind === 'item');
  const charges = lines.filter((l) => l.kind !== 'item');
  const itemTotal = round(items.reduce((n, l) => n + lineAmount(l), 0));
  return {
    items: itemTotal,
    units: items.reduce((n, l) => n + (Number(l.qty) || 0), 0),
    charges: round(charges.reduce((n, l) => n + lineAmount(l), 0)),
    total: round(itemTotal + charges.reduce((n, l) => n + lineAmount(l), 0)),
  };
}

// The payment schedule block. Half down rounds up (as Request payment does); the final is
// what is left after the deposit received.
export function paymentSchedule(type = 'full', total = 0, received = 0) {
  const t = cents(total);
  const half = Math.round(t / 2);
  if (type === 'half') {
    return { due: half / 100, rows: [
      { label: 'Deposit · 50% due upon acceptance', note: 'Required before materials are ordered. Production and lead time begin once received.', amount: half / 100, status: 'due' },
      { label: 'Final balance · 50% due at project completion', note: 'Due upon completion of installation.', amount: (t - half) / 100, status: 'later' },
    ] };
  }
  if (type === 'final') {
    const got = Math.min(t, Math.max(0, cents(received)));
    return { due: (t - got) / 100, rows: [
      { label: 'Deposit received', note: '', amount: got / 100, status: 'received' },
      { label: 'Final balance · due upon completion', note: 'Due upon completion of installation.', amount: (t - got) / 100, status: 'due' },
    ] };
  }
  return { due: t / 100, rows: [] };
}

// Shown above Download; they never block it.
export function invoiceChecks({ lines = [], sell = null, type = 'full', received = 0, billTo = {} } = {}) {
  const out = [];
  const { total } = invoiceTotals(lines);
  if (!lines.length) out.push('Add at least one line');
  if (num(sell) != null && cents(total) !== cents(sell)) out.push(`Lines add up to $${total.toFixed(2)}; the job's customer total is $${Number(sell).toFixed(2)}`);
  if (!text(billTo.name)) out.push('Bill to is empty');
  if (lines.some((l) => !text(l.description))) out.push('A line has no description');
  if (type === 'final' && !(num(received) > 0)) out.push('No deposit is recorded, so the final balance is the full total');
  return out;
}
