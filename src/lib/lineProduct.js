// The Product cell of an Invoicing line (Gabe, Oct 24: "just show the product and leave
// all those other details in the job but in the drop down"). Pure. First match wins:
//  1. the job's supplier quote on file: brand + item type (+ quantity);
//  2. brand + item type read from the line's notes ("Amsco glass", "Milgard slider");
//  3. the work type alone ("Screens", "Glass", "Service", "Trip charge");
//  4. otherwise "—".
// Search still matches the full note text; this only decides what the cell shows.

const BRANDS = [
  ['Milgard', /\bmilgard\b/i],
  ['Amsco', /\bamsco\b/i],
  ['Pella', /\bpella\b/i],
  ['Andersen', /\bander[sz][eo]n\b/i],
  ['Jeld-Wen', /\bjeld[\s-]?wen\b/i],
  ['Windor', /\bwin[\s-]?door?\b/i],
  ['Nu Vista', /\bnu[\s-]?vista\b/i],
  ['Bonelli', /\bbonell?i\b/i],
  ['Marvin', /\bmarvin\b/i],
  ['La Cantina', /\bla[\s-]?cant[iy]a?na\b|\blacant[iy]a?na\b/i],
];

// Item types in priority order: a line about screens and hardware reads as screens.
const TYPES = [
  ['screens', /\bscreens?\b|\bscr(n|w)\b|\bsrw\b/i],
  ['slider', /\bslid(er|ing)\b|\bsgd\b|\bpatio\b|\bmulti[\s-]?slide\b|\bpd\b/i],
  ['door', /\bdoors?\b/i],
  ['glass', /\bglass\b|\bigu\b|\bdead\s?li(te|ght)\b/i],
  ['mull covers', /\bmull\s?(covers?|caps?)\b/i],
  ['hardware', /\bhardware\b|\bhandles?\b/i],
];

const WORK = [
  ['Screens', /\bscreens?\b|\bsrw\b/i],
  ['Glass', /\bglass\b|\bigu\b|\bglazing\b/i],
  ['Trip charge', /\btrip\s*charg/i],
  ['Hardware', /\bhardware\b|\bhandles?\b/i],
  ['Door', /\bdoors?\b/i],
  ['Service', /\bservice\b|\bwarrant|\bwty\b|\binvestigat|\badjust|\brepair|\bfix(ed)?\b/i],
];

const first = (list, text) => (list.find(([, re]) => re.test(text)) || [null])[0];

export function brandOf(text = '') {
  return first(BRANDS, String(text));
}

function qtyOf(text) {
  const m = String(text).match(/\bqty\.?\s*:?\s*(\d{1,4})\b/i);
  return m ? Number(m[1]) : null;
}

const withQty = (s, qty) => (qty ? `${s} ×${qty}` : s);

// quote: { brand, qty } for the line's job from its supplier quote on file, or null.
export function lineProduct(row = {}, quote = null) {
  const text = [row.note_text, row.line_description].filter(Boolean).join(' \n ');
  const type = first(TYPES, text);
  if (quote?.brand) return withQty(`${quote.brand} ${type || 'windows'}`, quote.qty);
  const brand = brandOf(text);
  if (brand && type) return `${brand} ${type}`;
  if (brand) return /\bwin(dows?)?\b|\bqty\b|\binstall/i.test(text) ? withQty(`${brand} windows`, qtyOf(text)) : brand;
  return first(WORK, text) || '—';
}

// The job's supplier quote on file, per job: brand from the quote's manufacturer (or
// vendor) and the openings it covers. Draft, reference and deleted quotes do not count.
export function quotesByJob(budgets = []) {
  const map = new Map();
  for (const b of budgets) {
    if (!b?.job_id || b.deleted_at || ['draft', 'reference'].includes(b.budget_usage)) continue;
    const brand = brandOf(`${b.manufacturer || ''} ${b.vendor || ''}`);
    if (!brand) continue;
    const prev = map.get(b.job_id);
    if (prev && prev.brand !== brand) continue;
    const qty = Number(b.openings_qty) || 0;
    map.set(b.job_id, { brand, qty: (prev?.qty || 0) + qty || null });
  }
  return map;
}

// Delivery routing phrases from the notes ("Milgard del to BFS", "BFS del to jobsite",
// "Amsco direct", "will call"), for the expanded panel.
export function deliveryRouting(row = {}) {
  const parts = [row.note_text, row.line_description].filter(Boolean).join('\n').split(/\s*[·|\n]\s*/);
  const hits = parts.filter((p) => /\bdel(iver(y|ed)?)?\b.*\bto\b|\bdirect\b|\bwill[\s-]?call\b|\bpick(ing)?\s?up\b/i.test(p) && p.length <= 80);
  return [...new Set(hits.map((p) => p.trim()))].slice(0, 3).join(' · ');
}
