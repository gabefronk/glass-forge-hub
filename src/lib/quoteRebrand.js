// YA copy of a supplier quote (Gabe, Oct 31): the same pages, with everything that isn't
// Y A Windows & Doors covered (distributor names, addresses, phones, faxes, emails, sales
// reps, the supplier's logo block) and YA's details and logo written in its place. Every
// price is re-priced to sell: amounts are scaled by (product sell ÷ quote total), which keeps
// the quote's own math (lines → subtotal → tax → total) and lands the total on the sell.
// The manufacturer's product names (AMSCO Studio, Andersen 100 Series ...) stay: that is
// the product the customer is buying. Pure: no React, no PDF library. Coordinates are PDF
// points from the page's top-left; text items are { str, x, y, w, h }.

const round = (n) => Math.round(n * 100) / 100;
const MONEY = /\$\s?-?[\d,]+\.\d{2}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/;
// Distributors and dealers whose names must never reach the customer (manufacturers stay).
const OTHER_COMPANIES = /builders\s*first\s*source|\bBFS\b|lehi american|american\s*fork|ox glass|bonneville builders|abc supply|lehigh valley|po box 25178|\bfork\b$/i;

export const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amountOf = (s) => Number(String(s).replace(/[$,\s]/g, ''));

export function detectSupplier(pages = []) {
  const text = pages.slice(0, 2).flatMap((p) => p.items.map((i) => i.str)).join(' ');
  if (/Billing Information:/.test(text) && /(Dealer|Customer) (Quote|Price)/.test(text)) return 'amsco';
  if (/SOLD BY:/.test(text) || /Abbreviated Quote Report/.test(text)) return 'pqm';
  return 'generic';
}

// Scale every price on the quote to sell. `quoteTotal` is the quote's printed total (YA's cost
// with supplier tax); `productSell` is what the customer pays for this product.
export function priceFactor(quoteTotal, productSell) {
  const t = Number(quoteTotal), s = Number(productSell);
  return t > 0 && s > 0 ? s / t : null;
}
export function repriceText(str, factor) {
  return String(str).replace(MONEY, (m) => money(round(amountOf(m) * factor)));
}

const pad = (r, by = 1) => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });
const rectOf = (i) => ({ x: i.x, y: i.y, w: i.w, h: i.h });
const find = (items, re) => items.find((i) => re.test(i.str));
const lineOf = (items, item) => items.filter((i) => Math.abs(i.y - item.y) < 2);

// Rewrite an item in place: cover it and write the new text at the same spot and size.
const replaceItem = (item, text, extra = {}) => ({
  erase: pad(rectOf(item)),
  write: { text, x: extra.align === 'right' ? item.x + item.w : item.x, y: item.y, size: item.h * 0.92, bold: Boolean(extra.bold), align: extra.align || 'left' },
});

// YA's block (company, address, phone / email) written where the supplier's was.
function yaBlock(x, y, company, size = 8.5) {
  const lines = [company.invoice_company_name, company.invoice_company_address, [company.invoice_phone, company.invoice_email].filter(Boolean).join(' · ')].filter(Boolean);
  return lines.map((text, i) => ({ text, x, y: y + i * (size + 2.5), size, bold: i === 0, align: 'left' }));
}

// The plan for one page: rectangles to cover, text to write, where the YA logo goes.
export function pagePlan(page, { supplier, factor, company, job = {}, pageIndex = 0 }) {
  const items = page.items;
  const erase = [], write = [], logos = [];
  const done = new Set();
  const take = (item, text, extra) => { if (done.has(item)) return; done.add(item); const r = replaceItem(item, text, extra); erase.push(r.erase); if (text) write.push(r.write); };
  const cover = (item) => { if (done.has(item)) return; done.add(item); erase.push(pad(rectOf(item))); };
  const coverBox = (x1, y1, x2, y2) => { for (const i of items) if (i.x >= x1 - 1 && i.x + i.w <= x2 + 1 && i.y >= y1 - 1 && i.y + i.h <= y2 + 1) cover(i); };

  if (supplier === 'amsco') {
    // Header: the supplier logo block (logo, P:, F:) becomes the YA logo; "Dealer" goes.
    if (pageIndex === 0) {
      erase.push({ x: 34, y: 60, w: 250, h: 88 });
      for (const i of items) if (i.y < 105 && i.y > 85 && i.x > 115 && i.x < 230) done.add(i);
      logos.push({ x: 36, y: 66, w: 150, h: 76 });
      const billing = find(items, /^Billing Information:/), shipping = find(items, /^Shipping Information:/), comments = find(items, /^Order Comments:/);
      const nextTop = Math.min(...items.filter((i) => /^Line#/.test(i.str)).map((i) => i.y), page.height);
      if (billing) {
        const right = shipping ? shipping.x - 4 : billing.x + 185;
        coverBox(billing.x - 4, billing.y + billing.h + 1, right, nextTop - 2);
        write.push(...yaBlock(billing.x - 2, billing.y + billing.h + 3, company, 8));
      }
      if (shipping) {
        const right = comments ? comments.x - 4 : shipping.x + 185;
        coverBox(shipping.x - 4, shipping.y + shipping.h + 1, right, nextTop - 2);
        const ship = [job.canonical_name, job.address].filter(Boolean);
        ship.forEach((text, i) => write.push({ text, x: shipping.x - 2, y: shipping.y + shipping.h + 3 + i * 10.5, size: 8, bold: i === 0, align: 'left' }));
      }
    }
    for (const i of items) {
      if (/^Dealer Quote$/.test(i.str.trim())) take(i, 'Quote', { bold: true });
      else if (/^(Dealer|Customer) Price:$/.test(i.str.trim())) take(i, 'Price:', { bold: true });
      else if (/^Sales Rep:/.test(i.str)) { lineOf(items, i).filter((j) => j.x >= i.x && j.x < i.x + 120).forEach(cover); }
      else if (/^Quoted by:/.test(i.str)) { lineOf(items, i).filter((j) => j.x > i.x && j.x < i.x + 100).forEach((j) => take(j, j === lineOf(items, i).filter((k) => k.x > i.x && k.x < i.x + 100)[0] ? 'Y A Windows & Doors' : '')); }
    }
  }

  if (supplier === 'pqm') {
    const soldBy = find(items, /^SOLD BY:/), soldTo = find(items, /^SOLD TO:/);
    if (soldBy) {
      const title = find(items, /Quote Report/);
      const bottom = title ? title.y - 2 : soldBy.y + 80;
      coverBox(soldBy.x - 2, soldBy.y + soldBy.h + 1, soldTo ? soldTo.x - 4 : soldBy.x + 220, bottom);
      write.push(...yaBlock(soldBy.x, soldBy.y + soldBy.h + 4, company, 9));
      logos.push({ x: 37, y: soldBy.y - 4, w: 140, h: 71 });
    }
    if (soldTo) {
      coverBox(soldTo.x - 2, soldTo.y + soldTo.h + 1, soldTo.x + 180, soldTo.y + 80);
      [job.canonical_name, job.address].filter(Boolean).forEach((text, i) => write.push({ text, x: soldTo.x, y: soldTo.y + soldTo.h + 4 + i * 11.5, size: 9, bold: i === 0, align: 'left' }));
    }
    for (const i of items) if (/Thank you for choosing/i.test(i.str)) take(i, 'Thank you for choosing Y A Windows & Doors');
  }

  // Every supplier: other companies' names, emails, phones and faxes go; prices go to sell.
  for (const i of items) {
    if (done.has(i)) continue;
    if (EMAIL.test(i.str) || OTHER_COMPANIES.test(i.str.trim()) || (PHONE.test(i.str) && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(i.str))) { cover(i); continue; }
    if (/^(Fax|Phone|P|F):?\s*$/i.test(i.str.trim()) && pageIndex === 0 && i.y < page.height * 0.45) { cover(i); continue; }
    if (factor && MONEY.test(i.str)) { MONEY.lastIndex = 0; take(i, repriceText(i.str, factor), { align: /^\s*\$/.test(i.str) ? 'right' : 'left', bold: i.bold }); }
    MONEY.lastIndex = 0;
  }
  return { erase, write, logos };
}

export function rebrandPlan(pages, { factor, company, job }) {
  const supplier = detectSupplier(pages);
  return { supplier, pages: pages.map((p, pageIndex) => pagePlan(p, { supplier, factor, company, job, pageIndex })) };
}

// The product's sell price for one quote budget: its sell split by cost share, the same
// split the invoice uses (windows and doors vs installation labor and install material).
export function productSell(budget = {}) {
  const i = budget.inputs || {};
  const sell = Number(i.actual_total_sell) || 0;
  const material = Number(i.material_true_cost) || 0;
  const other = (Number(i.labor_cost_sub_pay) || 0) + (Number(i.additional_install_material) || 0) + (Number(i.additional_equipment) || 0);
  if (!(sell > 0) || !(material > 0)) return null;
  const product = round((sell * material) / (material + other));
  return { product, install: round(sell - product), sell };
}

// The quote's printed total: what the supplier quote adds up to (YA's cost with tax).
export function quoteTotal(budget = {}) {
  const q = budget.quote || {};
  const t = Number(q.customer_total) || Number(q.actual_total_sell) || Number(budget.inputs?.material_true_cost) || 0;
  return t > 0 ? t : null;
}

// Install guide file names → dropdown labels: "1F Standard Flat Wall Nail-on 405 NO Sill Pan (1).pdf"
// → "1F Standard Flat Wall Nail-on 405 NO Sill Pan".
export function guideLabel(name = '') {
  return String(name).replace(/\.pdf$/i, '').replace(/\s*\(\d+\)\s*$/, '').trim();
}
