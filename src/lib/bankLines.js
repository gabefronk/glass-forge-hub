// YA Windows & Doors' bank lines (Gabe, Oct 26): the QuickBooks bank-feed CSV for YA's account,
// read into BankTransactions so the Company overview can show real crew pay and overhead.
// Pure: no React, no SDK.
//  - Every line gets one category. Lines the Hub already counts elsewhere are left out of the
//    overview's profit (column ''): BFS labor payments (labor billed), customer payments (the
//    job's sale), supplier payments matched to a Hub order (Purchasing job cost), shop POs and
//    payments to Glass Forge (counted from its invoices).
//  - Everything else money out is a cost, sorted or not (Gabe: "plug it in" now, sort later).
//    other_cost is a line not sorted yet; it still counts.
//  - QuickBooks' own Match/Categorize guess is kept for reference but is often wrong (it calls
//    every Draft Withdrawal a bank fee), so only its Payroll / Insurance / Equipment guesses are used.

const round = (n) => Math.round(n * 100) / 100;
const cents = (n) => Math.round(Number(n) * 100);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

export const BANK_ACCOUNT = 'YA · Mountain America';

// Category -> label, the overview column it lands in ('' = left out of profit), and why.
export const BANK_CATEGORIES = [
  { key: 'labor_payment', label: 'BFS labor payment', column: '', side: 'in', note: 'Already counted as labor billed' },
  { key: 'customer_payment', label: 'Customer payment', column: '', side: 'in', note: "Already counted in the job's sale" },
  { key: 'other_income', label: 'Other income', column: 'otherIncome', side: 'in', note: 'Counted as income' },
  { key: 'job_cost', label: 'Supplier: Hub job order', column: '', side: 'out', note: 'Already counted in Purchasing job cost' },
  { key: 'shop', label: 'Shop PO', column: '', side: 'out', note: 'Already counted in Shop' },
  { key: 'glass_forge', label: 'Paid to Glass Forge', column: '', side: 'out', note: 'Already counted in Glass Forge (its invoices)' },
  { key: 'supplier', label: 'Supplier: no Hub order', column: 'otherCost', side: 'out', note: 'Counted in Other costs' },
  { key: 'crew_pay', label: 'Crew pay', column: 'crewPay', side: 'out', note: 'Counted in Crew pay' },
  { key: 'payroll', label: 'Payroll', column: 'overhead', side: 'out', note: 'Counted in Overhead' },
  { key: 'overhead', label: 'Overhead', column: 'overhead', side: 'out', note: 'Counted in Overhead' },
  { key: 'card', label: 'Amex card payment', column: 'otherCost', side: 'out', note: 'Counted in Other costs (what it bought is on the card statement)' },
  { key: 'loan', label: 'Loan payment', column: 'otherCost', side: 'out', note: 'Counted in Other costs (part may be principal)' },
  { key: 'other_cost', label: 'Not sorted yet', column: 'otherCost', side: 'out', note: 'Counted in Other costs' },
  { key: 'owner_draw', label: 'Owner draw', column: '', side: 'out', note: 'Not a cost' },
  { key: 'transfer', label: 'Transfer', column: '', side: 'out', note: 'Not income or a cost' },
];
const BY_KEY = new Map(BANK_CATEGORIES.map((c) => [c.key, c]));
export const bankCategory = (key) => BY_KEY.get(key) || BY_KEY.get('other_cost');

// RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF, a leading BOM.
export function parseCsv(text = '') {
  const s = String(text).replace(/^﻿/, '');
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

// "$1,506.49" / "(1,506.49)" / "-1506.49" -> number; blank -> null.
export function parseMoney(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.includes('-');
  const n = Number(s.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// "10/23/2026" or "2026-10-23" -> "2026-10-23"; anything else -> ''.
export function parseDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return '';
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// A bank export as lines: QuickBooks' bank-feed CSV (Date, Bank description, Spent, Received,
// From/To, Match/Categorize) or a plain bank CSV (Date, Description, then Amount, Debit/Credit
// or Withdrawal/Deposit). Throws when there is no Date column or no amount column.
export function parseBankExport(text) {
  const [head = [], ...body] = parseCsv(text);
  const cols = head.map((h) => h.trim().toLowerCase());
  const at = (...names) => cols.findIndex((c) => names.includes(c));
  const date = at('date', 'posted date', 'posting date', 'transaction date');
  const desc = at('bank description', 'description', 'memo', 'payee');
  const spent = at('spent', 'debit', 'withdrawal', 'withdrawals', 'money out');
  const received = at('received', 'credit', 'deposit', 'deposits', 'money in');
  const amount = at('amount');
  const fromTo = at('from/to', 'payee', 'name');
  const qb = at('match/categorize', 'category');
  if (date < 0 || (amount < 0 && spent < 0 && received < 0)) throw new Error('This file has no Date and amount columns. Export the bank feed from QuickBooks as CSV.');
  const lines = [];
  for (const r of body) {
    const posted = parseDate(r[date]);
    let value = amount >= 0 ? parseMoney(r[amount]) : null;
    if (value === null) {
      const out = spent >= 0 ? parseMoney(r[spent]) : null;
      const inn = received >= 0 ? parseMoney(r[received]) : null;
      value = out ? -Math.abs(out) : inn ? Math.abs(inn) : null;
    }
    if (!posted || value === null) continue;
    lines.push({
      posted_date: posted,
      description: desc >= 0 ? String(r[desc] || '').trim() : '',
      amount: round(value),
      from_to: fromTo >= 0 && fromTo !== desc ? String(r[fromTo] || '').trim() : '',
      qb_category: qb >= 0 ? String(r[qb] || '').trim() : '',
    });
  }
  return lines;
}

// account|date|amount|description|n, n counting identical lines that day in file order, so the
// two $1,950.00 drafts on Oct 19 are two lines and a re-import of the same file adds nothing.
export function withFingerprints(lines, account = BANK_ACCOUNT) {
  const seen = new Map();
  return lines.map((l) => {
    const base = `${account}|${l.posted_date}|${cents(l.amount)}|${String(l.description).toLowerCase()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...l, account, fingerprint: `${base}|${n}` };
  });
}

const dayMs = 86400000;
const daysBetween = (a, b) => Math.round((new Date(`${String(a).slice(0, 10)}T12:00:00Z`) - new Date(`${String(b).slice(0, 10)}T12:00:00Z`)) / dayMs);
// An order can be paid up to 150 days after it was raised, or a few days before it was keyed in.
const inWindow = (posted, created) => !created || (daysBetween(posted, created) <= 150 && daysBetween(posted, created) >= -10);
const SUPPLIERS = /builders\s*first|abc supply|amsco|fhc|frameless|bmc|pella|andersen|milgard|home depot|lowe'?s/i;

// One line's category and Hub match. ctx: purchaseOrders, vendorOrders, sales ([{ id, name, sale }]
// for Purchasing jobs), invoices (Invoices; the 'glass_forge' ones are matched), used (Set of
// order and invoice ids already matched to another bank line).
export function suggestBankLine(line, { purchaseOrders = [], vendorOrders = [], sales = [], invoices = [], used = new Set() } = {}) {
  const amt = num(line.amount);
  const desc = String(line.description || '');
  const qb = String(line.qb_category || '');
  const rule = (category, match_note) => ({ category, match: 'rule', match_note, job_id: '', purchase_order_id: '', vendor_order_id: '' });
  if (amt < 0) {
    const c = cents(-amt);
    // YA paying a Glass Forge invoice: exactly its amount, on or after the invoice date.
    const gf = invoices.find((i) => i.kind === 'glass_forge' && !i.voided_at && !used.has(i.id) && cents(i.amount) === c && daysBetween(line.posted_date, i.invoice_date) >= -5);
    if (gf) return { category: 'glass_forge', match: 'exact', match_note: `${gf.invoice_number} (${gf.service_month || ''})`, job_id: '', purchase_order_id: '', vendor_order_id: '', invoice_id: gf.id };
    if (/glass\s*forge/i.test(desc) || /glass\s*forge/i.test(line.from_to || '')) return rule('glass_forge', 'Glass Forge LLC (no invoice at this exact amount)');
    const vo = vendorOrders.find((o) => !used.has(o.id) && o.amount && cents(o.amount) === c && inWindow(line.posted_date, o.created_date));
    const poId = vo?.purchase_order_id;
    const po = poId ? purchaseOrders.find((p) => p.id === poId) : purchaseOrders.find((p) => !used.has(p.id) && p.status !== 'cancelled' && p.amount_dealer && cents(p.amount_dealer) === c && inWindow(line.posted_date, p.created_date));
    if (vo || po) {
      const shop = po?.purchase_type === 'shop';
      const jobId = vo?.job_id || po?.job_id || '';
      const what = [po?.po_number, vo ? `${vo.vendor || ''} ${vo.order_number || ''}`.trim() : po?.vendor, vo?.job_name || po?.job_name].filter(Boolean).join(' · ');
      return { category: shop ? 'shop' : jobId ? 'job_cost' : 'supplier', match: 'exact', match_note: what, job_id: shop ? '' : jobId, purchase_order_id: po?.id || '', vendor_order_id: vo?.id || '' };
    }
    if (/intuit|^quickbooks$/i.test(desc)) return rule('overhead', 'QuickBooks Payments fee');
    if (/payroll/i.test(qb) || /payroll/i.test(desc)) return rule('payroll', 'QuickBooks Payroll');
    if (/insurance/i.test(qb) || /insurance/i.test(desc)) return rule('overhead', 'Insurance');
    if (/equipment/i.test(qb)) return rule('overhead', 'Equipment rental');
    if (/american express|amex/i.test(desc)) return rule('card', 'Amex card payment');
    if (/^loan$/i.test(desc.trim()) || /interest expense/i.test(qb) || /withdrawal trans/i.test(desc)) return rule('loan', 'Loan payment');
    if (/tax|internal revenue/i.test(qb) || /internal revenue|tax\b/i.test(desc)) return rule('overhead', 'Taxes');
    if (/meals|office/i.test(qb)) return rule('overhead', qb.replace(/^.*:/, ''));
    if (SUPPLIERS.test(desc) || SUPPLIERS.test(line.from_to || '') || /cost of goods/i.test(qb)) return rule('supplier', 'Supplier with no Hub order at this amount');
    if (/draft withdrawal/i.test(desc) && -amt <= 3500) return rule('crew_pay', 'Draft up to $3,500 (payee not in the export)');
    if (/^check\b/i.test(desc.trim()) && -amt <= 3500) return rule('crew_pay', 'Check up to $3,500 (payee not in the export)');
    return rule('other_cost', 'Not sorted yet');
  }
  if (/other income/i.test(qb)) return rule('other_income', qb.replace(/^.*:/, ''));
  if (/intuit/i.test(desc)) {
    const c = cents(amt);
    const job = sales.find((j) => j.sale && (cents(j.sale) === c || Math.abs(cents(j.sale) / 2 - c) <= 0.5));
    if (job) return { category: 'customer_payment', match: 'exact', match_note: `${job.name}: ${cents(job.sale) === c ? 'full sale' : 'half of the sale'}`, job_id: job.id, purchase_order_id: '', vendor_order_id: '' };
    return rule('customer_payment', 'QuickBooks Payments deposit (customer not in the export)');
  }
  if (/^deposit( by( check)?)?$/i.test(desc.trim())) return rule('labor_payment', 'Deposit (BFS labor payment)');
  if (/\bmh\b|mhsoniq/i.test(desc)) return rule('customer_payment', `ACH customer payment${line.from_to ? ` from ${line.from_to}` : ''}`);
  return rule('other_income', 'Not sorted yet');
}

// New lines from an export, categorized, skipping fingerprints already stored.
export function planBankImport(text, { existing = [], account = BANK_ACCOUNT, ...ctx } = {}) {
  const parsed = withFingerprints(parseBankExport(text), account);
  const have = new Set(existing.map((e) => e.fingerprint).filter(Boolean));
  const used = new Set(existing.flatMap((e) => [e.vendor_order_id, e.purchase_order_id, e.invoice_id]).filter(Boolean));
  const fresh = [];
  for (const l of parsed) {
    if (have.has(l.fingerprint)) continue;
    const { invoice_id: invoiceId, ...s } = suggestBankLine(l, { ...ctx, used });
    for (const id of [s.vendor_order_id, s.purchase_order_id, invoiceId]) if (id) used.add(id);
    fresh.push({ ...l, ...s, ...(invoiceId ? { invoice_id: invoiceId } : {}) });
  }
  return { lines: fresh, skipped: parsed.length - fresh.length, total: parsed.length };
}

// The days the stored exports cover: each import batch spans its first to last line date (an
// export covers every day in between, even days with no lines).
export function bankDays(lines = []) {
  const spans = new Map();
  for (const l of lines) {
    if (!l.posted_date) continue;
    const key = l.import_batch || `line:${l.id || l.fingerprint || l.posted_date}`;
    const s = spans.get(key);
    spans.set(key, s ? { from: l.posted_date < s.from ? l.posted_date : s.from, to: l.posted_date > s.to ? l.posted_date : s.to } : { from: l.posted_date, to: l.posted_date });
  }
  const days = new Set();
  for (const { from, to } of spans.values()) {
    for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + dayMs)) days.add(d.toISOString().slice(0, 10));
  }
  return days;
}

const ZERO = { otherIncome: 0, crewPay: 0, overhead: 0, otherCost: 0 };
// A month of bank lines as the overview's columns (costs positive, like jobCost) plus cash totals.
// days: bankDays(...) of all lines, so the month knows how many of its days the exports cover.
export function bankMonth(lines = [], month, days = null) {
  const rows = lines.filter((l) => String(l.posted_date || '').slice(0, 7) === month);
  const f = { ...ZERO };
  for (const l of rows) {
    const col = bankCategory(l.category).column;
    if (!col) continue;
    f[col] += col === 'otherIncome' ? num(l.amount) : -num(l.amount);
  }
  const moneyIn = rows.reduce((n, l) => n + Math.max(0, num(l.amount)), 0);
  const moneyOut = rows.reduce((n, l) => n + Math.min(0, num(l.amount)), 0);
  const coveredDays = days ? [...days].filter((d) => d.startsWith(month)).length : 0;
  return {
    hasBank: rows.length > 0, lines: rows.length, coveredDays,
    otherIncome: round(f.otherIncome), crewPay: round(f.crewPay), overhead: round(f.overhead), otherCost: round(f.otherCost),
    moneyIn: round(moneyIn), moneyOut: round(moneyOut), net: round(moneyIn + moneyOut),
  };
}

// Which dates the stored lines cover: { first, last, months: ['2026-10'], count }.
export function bankCoverage(lines = []) {
  const dates = lines.map((l) => l.posted_date).filter(Boolean).sort();
  return { first: dates[0] || '', last: dates[dates.length - 1] || '', months: [...new Set(dates.map((d) => d.slice(0, 7)))], count: dates.length };
}

// Category x month totals for the Bank page (signed amounts), in BANK_CATEGORIES order.
export function bankByCategory(lines = []) {
  const months = bankCoverage(lines).months;
  const rows = BANK_CATEGORIES.map((c) => {
    const mine = lines.filter((l) => (BY_KEY.has(l.category) ? l.category : 'other_cost') === c.key);
    const byMonth = Object.fromEntries(months.map((m) => [m, round(mine.filter((l) => l.posted_date.slice(0, 7) === m).reduce((n, l) => n + num(l.amount), 0))]));
    return { ...c, count: mine.length, byMonth, total: round(mine.reduce((n, l) => n + num(l.amount), 0)) };
  }).filter((r) => r.count);
  return { months, rows };
}
