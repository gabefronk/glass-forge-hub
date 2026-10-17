// Parse a calendar-event note blob into structured blocks: supplier route,
// floor, delivery qty/date splits, contacts, OE/PO refs, labor, phones.
// Pure function over the raw note text - no data changes, no guessing: lines
// that match nothing are returned for review instead of being dropped.
// Staged per Gabriel 2026-10-17 ("that way the data is cleaned up when it
// comes in and ready to be organized through our hub").

const ROUTE_RE = /^([A-Z][A-Z0-9 &.]+?)\s+DEL\s+TO\s+([A-Z][A-Z0-9 &.]+)$/;
const FLOOR_RE = /^(\d+)F$/;
const QTY_RE = /^QT?Y?\.?\s*(\d+)\s*(?:\|\s*(?:here:?|deliver(?:ed|s)?\s*by:?)\s*(\d{1,2}\/\d{1,2}\/\d{4}))?/i;
const CONTACT_RE = /^([A-Z][A-Z' -]+?)\s*\/\s*([A-Z][A-Z' -]+)$/;
const OEPO_RE = /OE:\s*([\d][\d-]*)\s*\/\s*PO:\s*(\d+)/i;
const PO_RE = /\bPO:?\s*(\d{6,})\b/i;
const OE_RE = /\bOE:?\s*([\d]{5,}(?:-\d+)?)\b/i;
const LABOR_RE = /LABOR:\s*\$?([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*(\w+))?/i;
const PHONE_RE = /\(?(\d{3})\)?[-. ](\d{3})[-. ](\d{4})/;
const CALL_RE = /^CALL\s+(.+?)\s+(?:WITH|FOR|IF)/i;

function emptyBlock() {
  return { route: null, floor: null, deliveries: [], contacts: [], oe: null, po: null, labor: null, other: [] };
}

function blockComplete(b) {
  return (b.oe || b.po) && (b.deliveries.length > 0 || b.labor || b.floor);
}

export function parseEventNote(text) {
  const blocks = [];
  const review = [];
  const phones = [];
  let cur = null;
  const push = () => { if (cur && (cur.route || cur.deliveries.length || cur.oe || cur.po || cur.other.length)) blocks.push(cur); };

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const phoneMatch = line.match(PHONE_RE);
    if (phoneMatch) phones.push(`${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}`);

    const route = line.toUpperCase().match(ROUTE_RE);
    if (route) {
      // A route header after a block that already has refs/deliveries starts a new block.
      if (cur && (cur.oe || cur.po || cur.deliveries.length)) { push(); cur = null; }
      if (!cur) cur = emptyBlock();
      const from = route[1].trim(), to = route[2].trim();
      cur.route = cur.route ? `${cur.route} → ${to}` : `${from} → ${to}`;
      continue;
    }

    const floor = line.toUpperCase().match(FLOOR_RE);
    if (floor && cur) { cur.floor = `${floor[1]}F`; continue; }

    const qty = line.match(QTY_RE);
    if (qty && cur) { cur.deliveries.push({ qty: Number(qty[1]), date: qty[2] || null }); continue; }

    const oepo = line.match(OEPO_RE);
    if (oepo) {
      if (!cur) cur = emptyBlock();
      cur.oe = oepo[1]; cur.po = oepo[2];
      continue;
    }
    const poOnly = line.match(PO_RE);
    if (poOnly) { if (!cur) cur = emptyBlock(); if (!cur.po) { cur.po = poOnly[1]; continue; } }
    const oeOnly = line.match(OE_RE);
    if (oeOnly) { if (!cur) cur = emptyBlock(); if (!cur.oe) { cur.oe = oeOnly[1]; continue; } }

    const labor = line.match(LABOR_RE);
    if (labor) {
      if (!cur) cur = emptyBlock();
      cur.labor = { amount: Number(labor[1].replace(/,/g, "")), unit: labor[2] ? labor[2].toUpperCase() : null };
      continue;
    }

    const call = line.toUpperCase().match(CALL_RE);
    if (call) {
      if (!cur) cur = emptyBlock();
      cur.contacts.push(call[1].trim().replace(/\s+/g, " "));
      continue;
    }

    const contact = line.toUpperCase().match(CONTACT_RE);
    if (contact && !/\d/.test(line)) {
      if (!cur) cur = emptyBlock();
      cur.contacts.push(`${contact[1].trim()} / ${contact[2].trim()}`);
      continue;
    }

    // Nothing matched - keep the line visible for review instead of guessing.
    if (cur) cur.other.push(line); else review.push(line);
  }
  push();

  return {
    blocks: blocks.map((b) => ({ ...b, needsReview: !blockComplete(b) })),
    review,
    phones: [...new Set(phones)],
  };
}
