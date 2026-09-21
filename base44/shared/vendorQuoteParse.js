// Deterministic parser for vendor quote text (pdftotext-style output), plus a
// normalizer for LLM-extracted quote JSON. Pure functions, no I/O.
//
// First supported format: AMSCO "Dealer Total Pricing" quote PDF - the exact
// layout Gabriel budgets from (quote 3517590, "BAXTER - GLASS"). Other vendors
// (Andersen, Pella, Milgard...) go through the LLM schema and normalizeVendorQuote;
// add deterministic parsers here as their layouts prove out.

const MONEY = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?)/;
const toMoney = (m) => (m ? Number(String(m[1] || m).replace(/[$,\s]/g, '')) : null);

function parseAmscoTotals(text) {
  // pdftotext column-izes the totals: labels ("Sub Total / Freight / Tax / TOTAL")
  // come first, then the money values in the same order. The customer block runs
  // from "Sub Total" to "Dealer Sub", the dealer block from "Dealer Sub" to EOF.
  const out = { customer: {}, dealer: {} };
  const moneyRe = /([0-9]{1,3}(?:,[0-9]{3})*\.\d{2})/g;
  const amounts = (block) => (block.match(moneyRe) || []).map((v) => Number(v.replace(/,/g, '')));

  const dealerIdx = text.search(/Dealer\s+Sub/i);
  const subIdx = text.search(/\n\s*Sub\s*Total/i);
  const custBlock = subIdx > -1 ? text.slice(subIdx, dealerIdx > -1 ? dealerIdx : undefined) : '';
  const dealerBlock = dealerIdx > -1 ? text.slice(dealerIdx) : '';

  const cust = amounts(custBlock);
  if (cust.length >= 2) {
    out.customer.sub_total = cust[0];
    out.customer.total = cust[cust.length - 1];
    if (cust.length >= 4) out.customer.tax = cust[cust.length - 2];
  }
  const deal = amounts(dealerBlock);
  if (deal.length >= 2) {
    out.dealer.sub_total = deal[0];
    out.dealer.total = deal[deal.length - 1];
  }
  return out;
}

// Parse pdftotext output of an AMSCO "Dealer Total Pricing" quote.
// Returns null when the layout is not recognized (caller falls back to LLM).
export function parseAmscoQuoteText(text) {
  if (!/amscowindows\.com|Dealer\s+Total\s+Pricing/i.test(text)) return null;

  const quoteNumber = (text.match(/QUOTE\s*#\s*\n?\s*(\d{5,})/i) || [])[1] || null;
  const quotedBy = (text.match(/QUOTED\s+BY\s*:?\s*\n?\s*([A-Za-z][A-Za-z .'-]{1,40})/i) || [])[1]?.trim() || null;
  const quoteName = (text.match(/Quote\s+Name\s*\n\s*([^\n]{2,80})/i) || [])[1]?.trim() || null;
  const billTo = (text.match(/BILL\s+TO\s*:\s*([^\n]{2,80})/i) || [])[1]?.trim() || null;
  const shipTo = (text.match(/SHIP\s+TO\s*:\s*([^\n]{2,80})/i) || [])[1]?.trim() || null;
  const dealerNumber = (text.match(/Dealer\s*#\s*\n?\s*(\d+)/i) || [])[1] || null;

  // Opening count: sum of per-line quantities. Each AMSCO line opens with
  // "100 - 1 Overall Unit:" and its quantity stands alone after the Rough
  // dimensions ("54.5625 X 43.25  3"). Take the dims+qty triple per block.
  let openings = 0;
  const blocks = text.split(/(?=\d+\s*-\s*\d+\s+Overall\s+Unit)/i);
  for (const b of blocks) {
    if (!/Overall\s+Unit/i.test(b)) continue;
    const m = b.match(/Rough:\s*[\s\S]{0,120}?(\d+(?:\.\d+)?)"?\s*[Xx]\s*(\d+(?:\.\d+)?)"?\s+(\d{1,3})\b/);
    if (m) openings += Number(m[3]) || 0;
  }

  const totals = parseAmscoTotals(text);
  if (!totals.dealer.sub_total && !totals.customer.total) return null;

  return {
    vendor: 'Amsco',
    manufacturer: 'Amsco',
    quote_number: quoteNumber,
    quote_name: quoteName,
    quoted_by: quotedBy,
    bill_to: billTo,
    ship_to: shipTo,
    dealer_number: dealerNumber,
    openings_qty: openings || null,
    material_true_cost: totals.dealer.sub_total,   // workbook C15
    actual_total_sell: totals.customer.total,      // workbook B28
    customer_sub_total: totals.customer.sub_total,
    customer_tax: totals.customer.tax,
    parse_source: 'amsco_text',
  };
}

// Normalize any extraction source (deterministic parse or LLM JSON) into the
// shape jobBudgetIngest and the JobBudgets entity store.
export function normalizeVendorQuote(raw = {}) {
  const clean = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
  const money = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const qty = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n < 10000 ? n : null;
  };
  return {
    vendor: clean(raw.vendor),
    manufacturer: clean(raw.manufacturer || raw.vendor),
    quote_number: clean(raw.quote_number),
    quote_name: clean(raw.quote_name),
    quoted_by: clean(raw.quoted_by),
    bill_to: clean(raw.bill_to),
    ship_to: clean(raw.ship_to),
    builder: clean(raw.builder || raw.bill_to),
    lot_or_address: clean(raw.lot_or_address),
    delivery_date: clean(raw.delivery_date),
    dealer_number: clean(raw.dealer_number),
    openings_qty: qty(raw.openings_qty),
    material_true_cost: money(raw.material_true_cost),
    actual_total_sell: money(raw.actual_total_sell),
    customer_sub_total: money(raw.customer_sub_total),
    customer_tax: money(raw.customer_tax),
    lines: Array.isArray(raw.lines) ? raw.lines.slice(0, 500) : [],
    parse_source: clean(raw.parse_source) || 'llm',
  };
}

// Job-match tokens: what we use to find the Hub job / Drive folder.
export function quoteMatchTokens(q) {
  const tokens = [];
  for (const v of [q.quote_name, q.builder, q.lot_or_address]) {
    if (!v) continue;
    for (const w of String(v).toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3 && !['the', 'and', 'glass', 'windows', 'window', 'doors', 'door', 'lot', 'home', 'homes', 'improvements', 'llc', 'inc'].includes(w)) tokens.push(w);
    }
  }
  return [...new Set(tokens)];
}
